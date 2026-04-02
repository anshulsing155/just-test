import puppeteer from 'puppeteer';
import { AgentService } from '$lib/server/services/index.js';
import { json } from '@sveltejs/kit';

const STATE = 'Punjab';
const BASE_URL = 'https://rera.punjab.gov.in/reraindex';
const SESSION_TTL_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// Module-level session
// ---------------------------------------------------------------------------
let captchaSession: { browser: any; page: any; createdAt: number } | null = null;

async function closeSession() {
	if (captchaSession) {
		try { await captchaSession.browser.close(); } catch {}
		captchaSession = null;
	}
}

async function openSession(headless: boolean) {
	await closeSession();
	const browser = await puppeteer.launch({
		headless,
		args: headless ? ['--no-sandbox', '--disable-setuid-sandbox'] : [],
		defaultViewport: headless ? { width: 1280, height: 800 } : null
	});
	const page = await browser.newPage();
	if (headless) await page.setViewport({ width: 1280, height: 800 });
	await page.goto(`${BASE_URL}/publicview/agentinfo`, { waitUntil: 'networkidle2', timeout: 30000 });
	captchaSession = { browser, page, createdAt: Date.now() };
	return captchaSession;
}

function isSessionValid() {
	return captchaSession !== null && Date.now() - captchaSession.createdAt < SESSION_TTL_MS;
}

async function isTableReady(page: any): Promise<boolean> {
	return page.evaluate(() => {
		const t = document.querySelector('#dataTablePartialViewSearchRegdAgent');
		return !!(t && t.querySelectorAll('tbody tr').length > 0);
	}).catch(() => false);
}

// ---------------------------------------------------------------------------
// Dynamic modal content extractor
// Handles any combination of:
//   • 2-column key-value rows  (label | value)
//   • 4-column key-value rows  (label | value | label | value)
//   • Headed multi-row tables  (thead + tbody → array of row objects)
// Returns { sections, tables, flat }
// ---------------------------------------------------------------------------
const MODAL_EXTRACTOR = `
(function extractModal() {
	// Bootstrap 3 uses .modal.in; Bootstrap 4/5 uses .modal.show
	const modal =
		document.querySelector('.modal.in .modal-body') ||
		document.querySelector('.modal.show .modal-body') ||
		document.querySelector('.modal[style*="display: block"] .modal-body') ||
		document.querySelector('.modal[style*="display:block"] .modal-body') ||
		document.querySelector('.modal-body');
	if (!modal) return null;

	const clean   = (s) => (s || '').replace(/[:\\*]/g, '').trim();
	const cleanVal = (s) => (s || '').replace(/\\[at\\]/g, '@').replace(/\\s+/g, ' ').trim();

	const result = { sections: {}, tables: [], flat: {} };
	let section = 'General';

	// Walk every element in document order (depth-first via querySelectorAll('*'))
	// Track current section heading; process TABLE nodes in-place.
	const seen = new WeakSet();

	modal.querySelectorAll('*').forEach(el => {
		// Section headings
		if (/^H[1-6]$/.test(el.tagName) ||
			el.classList.contains('panel-heading') ||
			el.classList.contains('card-header') ||
			(el.tagName === 'DIV' && el.classList.contains('section-title'))) {
			const text = cleanVal(el.textContent);
			if (text) section = text;
			return;
		}

		if (el.tagName !== 'TABLE' || seen.has(el)) return;
		seen.add(el);

		// Skip nested tables (already captured by parent)
		if (el.closest('table')) return;

		if (!result.sections[section]) result.sections[section] = {};

		const thead = el.querySelector('thead');
		const headers = thead
			? [...thead.querySelectorAll('th')].map(th => cleanVal(th.textContent)).filter(Boolean)
			: [];

		if (headers.length >= 2) {
			// ── Multi-row data table ──
			const rows = [];
			el.querySelectorAll('tbody tr').forEach(tr => {
				const cells = [...tr.querySelectorAll('td')];
				// Skip placeholder rows (all dashes or empty)
				if (cells.every(c => !cleanVal(c.textContent) || cleanVal(c.textContent) === '--')) return;
				const row = {};
				headers.forEach((h, i) => { row[h] = cleanVal(cells[i]?.textContent || ''); });
				rows.push(row);
			});
			if (rows.length > 0) result.tables.push({ section, headers, rows });
			return;
		}

		// ── Key-value table ──
		el.querySelectorAll('tr').forEach(tr => {
			const cells = [...tr.querySelectorAll('td')];
			if (cells.length === 2) {
				const k = clean(cells[0].textContent);
				const v = cleanVal(cells[1].textContent);
				if (k) { result.sections[section][k] = v; result.flat[k] = v; }
			} else if (cells.length === 4) {
				const k1 = clean(cells[0].textContent);
				const v1 = cleanVal(cells[1].textContent);
				const k2 = clean(cells[2].textContent);
				const v2 = cleanVal(cells[3].textContent);
				if (k1) { result.sections[section][k1] = v1; result.flat[k1] = v1; }
				if (k2) { result.sections[section][k2] = v2; result.flat[k2] = v2; }
			}
		});
	});

	return result;
})()
`;

// ---------------------------------------------------------------------------
// Map the dynamically extracted modal data → Agent schema fields
// ---------------------------------------------------------------------------
function mapDetailToSchema(detail: any): Record<string, any> {
	if (!detail) return {};
	const f = detail.flat || {};
	const secs = detail.sections || {};

	// Helper: search across all sections for a key (case-insensitive partial match)
	const find = (...keys: string[]) => {
		for (const k of keys) {
			const kl = k.toLowerCase();
			// Exact flat match first
			const direct = Object.entries(f).find(([fk]) => fk.toLowerCase() === kl);
			if (direct?.[1]) return String(direct[1]);
			// Partial match
			const partial = Object.entries(f).find(([fk]) => fk.toLowerCase().includes(kl));
			if (partial?.[1]) return String(partial[1]);
		}
		return undefined;
	};

	// Build address string from a section
	const buildAddr = (secKey: string) => {
		const s = Object.entries(secs).find(([k]) => k.toLowerCase().includes(secKey.toLowerCase()))?.[1] as Record<string, string> | undefined;
		if (!s) return undefined;
		return [s['Address Line-1'], s['Address Line-2'], s['District'], s['State/UT'], s['Pin Code']]
			.filter(Boolean).join(', ') || undefined;
	};

	return {
		reraRegNo:        find('RERA Number', 'Registration Number', 'Reg. No', 'RERA No'),
		validUpto:        find('Registration Valid Upto', 'Valid Upto', 'Valid Till', 'Validity'),
		name:             find('Name', 'Agent Name', 'Applicant Name'),
		firmType:         find('Agent Type', 'Type', 'Firm Type', 'Applicant Type'),
		fatherName:       find("Father's Name", 'Father Name', 'Husband Name'),
		email:            find('E-Mail Address', 'Email Address', 'Email', 'E-Mail'),
		mobile:           find('Mobile Number', 'Mobile', 'Phone', 'Contact'),
		address:          buildAddr('Permanent Address') || buildAddr('Address'),
		businessAddress:  buildAddr('Place of Business') || buildAddr('Business Address'),
		otherStateRegs:   detail.tables?.find((t: any) =>
			t.section?.toLowerCase().includes('other state') ||
			t.section?.toLowerCase().includes('registration detail'))?.rows || [],
		rawDetail:        detail
	};
}

// ---------------------------------------------------------------------------
// Scrape all rows from the DataTable (basic data only — fast pass)
// ---------------------------------------------------------------------------
async function scrapeBasicRows(page: any): Promise<any[]> {
	// Show all rows at once
	await page.evaluate(() => {
		const $ = (window as any).jQuery || (window as any).$;
		if (!$) return;
		try { ($('#dataTablePartialViewSearchRegdAgent') as any).DataTable().page.len(-1).draw(); } catch {}
	});
	await new Promise(r => setTimeout(r, 1500));

	return page.evaluate(() => {
		const rows: any[] = [];
		document.querySelectorAll('#dataTablePartialViewSearchRegdAgent tbody tr').forEach((tr, idx) => {
			const tds = tr.querySelectorAll('td');
			if (tds.length < 5) return;
			rows.push({
				_rowIndex: idx,
				name:               tds[1]?.textContent?.trim() || '',
				district:           tds[2]?.textContent?.trim() || '',
				registrationNumber: tds[3]?.textContent?.trim() || '',
				issueDate:          tds[4]?.textContent?.trim() || '',
				validUpto:          tds[5]?.textContent?.trim() || '',
				hasViewBtn:         !!tds[tds.length - 1]?.querySelector('a')
			});
		});
		return rows;
	});
}

// ---------------------------------------------------------------------------
// Click the View button for a row, extract detail from the modal, close it.
// ---------------------------------------------------------------------------
async function scrapeRowDetail(page: any, rowIndex: number): Promise<any | null> {
	try {
		// Re-query to avoid stale handles
		const clicked = await page.evaluate((idx: number) => {
			const rows = document.querySelectorAll('#dataTablePartialViewSearchRegdAgent tbody tr');
			const row = rows[idx];
			if (!row) return false;
			const btn = row.querySelector('td:last-child a, td a');
			if (!btn) return false;
			(btn as HTMLElement).click();
			return true;
		}, rowIndex);

		if (!clicked) return null;

		// Wait for modal content to appear (Bootstrap 3 uses .modal.in, not .modal.show)
		await page.waitForSelector(
			'.modal.in .modal-body table, .modal.show .modal-body table, .modal[style*="display: block"] .modal-body table',
			{ visible: true, timeout: 15000 }
		);

		await new Promise(r => setTimeout(r, 600));

		// Extract all content dynamically
		const detail = await page.evaluate(new Function(`return ${MODAL_EXTRACTOR}`) as any);

		// Close modal — Bootstrap 3 or 4/5
		await page.evaluate(() => {
			const $ = (window as any).jQuery || (window as any).$;
			// Prefer jQuery .modal('hide') since the site uses Bootstrap via jQuery
			if ($) {
				$('.modal.in, .modal.show').modal('hide');
				return;
			}
			const closeBtn =
				document.querySelector('.modal.in .modal-footer .btn') ||
				document.querySelector('.modal.show .modal-footer .btn') ||
				document.querySelector('.modal .close') ||
				document.querySelector('.modal [data-dismiss="modal"]') ||
				document.querySelector('.modal [data-bs-dismiss="modal"]');
			if (closeBtn) (closeBtn as HTMLElement).click();
		});

		// Wait for modal to hide
		await page.waitForFunction(() => {
			return !document.querySelector('.modal.in') &&
				!document.querySelector('.modal.show') &&
				!document.querySelector('.modal[style*="display: block"]') &&
				!document.querySelector('.modal[style*="display:block"]');
		}, { timeout: 8000 }).catch(() => {});

		await new Promise(r => setTimeout(r, 300));
		return detail;

	} catch (err: any) {
		console.warn(`[Punjab Agents] Detail scrape failed for row ${rowIndex}:`, err.message);
		// Force-close any open modal before continuing
		await page.evaluate(() => {
			const $ = (window as any).jQuery || (window as any).$;
			if ($) { $('.modal.in, .modal.show').modal('hide'); }
		}).catch(() => {});
		await new Promise(r => setTimeout(r, 500));
		return null;
	}
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------
export async function GET({ url }) {
	const action  = url.searchParams.get('action') || '';
	const refresh = url.searchParams.get('refresh') === 'true';
	const search  = url.searchParams.get('search') || '';

	if (action === 'open-browser') {
		try {
			await openSession(false);
			return json({ success: true });
		} catch (err: any) {
			await closeSession();
			return json({ success: false, error: err.message }, { status: 500 });
		}
	}

	if (action === 'check-ready') {
		if (!isSessionValid()) return json({ ready: false, sessionExpired: true });
		const ready = await isTableReady(captchaSession!.page);
		return json({ ready });
	}

	if (action === 'close-browser') {
		await closeSession();
		return json({ success: true });
	}

	if (!refresh) {
		try {
			const { agents, total } = await AgentService.getAgentsByState(STATE, { search });
			if (agents.length > 0) return json({ success: true, data: agents, total, cached: true });
		} catch (dbErr: any) {
			console.warn('[Punjab Agents] DB read failed:', dbErr.message);
		}
		return json({ success: true, data: [], total: 0, cached: true, empty: true });
	}

	// ── Scrape ──
	if (!isSessionValid()) {
		return json({ success: false, error: 'No active browser session. Click "Open Browser" first, fill the CAPTCHA, then click "Scrape Now".' }, { status: 400 });
	}

	const page = captchaSession!.page;

	try {
		if (!await isTableReady(page)) {
			return json({ success: false, error: 'Results table not visible yet. Fill the CAPTCHA in the browser window first.' }, { status: 400 });
		}

		// Pass 1: scrape basic row data
		const basicRows = await scrapeBasicRows(page);
		console.log(`[Punjab Agents] Found ${basicRows.length} rows — scraping details...`);

		// Pass 2: click View for each row, extract full details
		const fullAgents: any[] = [];
		for (let i = 0; i < basicRows.length; i++) {
			const basic = basicRows[i];
			console.log(`[Punjab Agents] Detail ${i + 1}/${basicRows.length}: ${basic.registrationNumber}`);

			let mapped: Record<string, any> = {};
			if (basic.hasViewBtn) {
				const detail = await scrapeRowDetail(page, i);
				mapped = mapDetailToSchema(detail);
			}

			fullAgents.push({
				registrationNo:   mapped.reraRegNo   || basic.registrationNumber,
				name:             mapped.name         || basic.name,
				district:         basic.district,
				firmType:         mapped.firmType,
				fatherName:       mapped.fatherName,
				email:            mapped.email,
				mobile:           mapped.mobile,
				address:          mapped.address,
				registrationDate: basic.issueDate,
				validUpto:        mapped.validUpto    || basic.validUpto,
				status:           'Approved',
				// Store business address + other state regs in partners field (Json)
				// and everything in rawData
				partners:         mapped.otherStateRegs?.length > 0 ? mapped.otherStateRegs : null,
				rawData: {
					...basic,
					...mapped,
					businessAddress:  mapped.businessAddress,
					otherStateRegs:   mapped.otherStateRegs,
					fullDetail:       mapped.rawDetail
				}
			});
		}

		let upsertCount = 0;
		if (fullAgents.length > 0) {
			try { upsertCount = await AgentService.upsertAgents(STATE, fullAgents); }
			catch (dbErr: any) { console.warn('[Punjab Agents] DB upsert failed:', dbErr.message); }
		}

		await closeSession();

		const { agents: allAgents, total } = await AgentService.getAgentsByState(STATE, { search });
		return json({ success: true, data: allAgents, total, scraped: basicRows.length, upserted: upsertCount });

	} catch (error: any) {
		console.error('[Punjab Agents] Scrape failed:', error.message);
		try {
			const { agents: cached, total } = await AgentService.getAgentsByState(STATE, { search });
			if (cached.length > 0) return json({ success: true, data: cached, total, cached: true, scrapeError: error.message });
		} catch {}
		return json({ success: false, error: error.message }, { status: 500 });
	}
}
