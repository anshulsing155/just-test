// src/routes/api/punjab-rera-promoters/+server.js
//
// Punjab RERA promoters — mirrors the agents scraper pattern exactly.
//
// Flow:
//   1. GET ?action=open-browser[&district=X]
//        Opens a visible Chrome window, navigates to the search page,
//        auto-selects district (if given). User fills CAPTCHA & submits.
//   2. GET ?action=check-ready
//        Returns { ready: true } when the results table has real data rows.
//        Poll this from the UI until ready.
//   3. GET ?refresh=true
//        Requires an active session. Reads all rows from the DataTable,
//        then clicks "View" for each row, navigates ALL modal tabs,
//        extracts full detail data, and persists to DB via CompanyService.
//   4. GET ?action=close-browser
//        Closes the browser and clears the session.
//   5. GET ?action=districts
//        Returns list of Punjab districts.
//   6. GET ?action=list[&search=X]
//        Returns cached DB data.

import puppeteer from 'puppeteer';
import { json } from '@sveltejs/kit';
import { CompanyService, ScrapeLogService } from '$lib/server/services/index.js';

const STATE    = 'Punjab';
const SOURCE   = 'punjab-rera-promoters';
const BASE_URL = 'https://rera.punjab.gov.in/reraindex';
const SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes

const PUNJAB_DISTRICTS = [
	'Amritsar', 'Barnala', 'Bathinda', 'Chandigarh', 'Faridkot',
	'Fatehgarh Sahib', 'Fazilka', 'Firozpur', 'Gurdaspur', 'Hoshiarpur',
	'Jalandhar', 'Kapurthala', 'Ludhiana', 'Malerkotla', 'Mansa',
	'Moga', 'Muktsar', 'Pathankot', 'Patiala', 'Rupnagar',
	'Sahibzada Ajit Singh Nagar', 'Sangrur',
	'Shahid Bhagat Singh Nagar', 'Tarn Taran'
];

const PUNJAB_DISTRICT_CODES = {
	'Amritsar': '39',       'Barnala': '79',          'Bathinda': '84',
	'Chandigarh': '128',    'Faridkot': '202',         'Fatehgarh Sahib': '204',
	'Fazilka': '206',       'Firozpur': '207',          'Gurdaspur': '232',
	'Hoshiarpur': '248',    'Jalandhar': '261',         'Kapurthala': '300',
	'Ludhiana': '366',      'Malerkotla': '2024',       'Mansa': '386',
	'Moga': '393',          'Muktsar': '399',           'Pathankot': '453',
	'Patiala': '454',       'Rupnagar': '501',          'Sahibzada Ajit Singh Nagar': '507',
	'Sangrur': '514',       'Shahid Bhagat Singh Nagar': '527', 'Tarn Taran': '574'
};

// ─────────────────────────────────────────────────────────────────────────────
// Module-level browser session (persists between requests)
// ─────────────────────────────────────────────────────────────────────────────

// Use process (true Node.js global, survives Vite HMR/SSR module isolation)
// Stores { wsEndpoint, createdAt } — browser object is reconnected per-request
const _store = process;

function getWsEndpoint()        { return _store.__pbPromotersWs   || null; }
function setWsEndpoint(ws)      { _store.__pbPromotersWs = ws; }
function getCreatedAt()         { return _store.__pbPromotersTs   || 0; }
function setCreatedAt(ts)       { _store.__pbPromotersTs = ts; }

async function closeSession() {
	const ws = getWsEndpoint();
	if (ws) {
		try {
			const b = await puppeteer.connect({ browserWSEndpoint: ws });
			await b.close();
		} catch {}
	}
	setWsEndpoint(null);
	setCreatedAt(0);
}

async function openSession(district = '') {
	await closeSession();

	const browser = await puppeteer.launch({
		headless: false,
		defaultViewport: null,
		args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized']
	});

	// Save the WS endpoint — this is a plain string that survives HMR
	setWsEndpoint(browser.wsEndpoint());
	setCreatedAt(Date.now());

	const page = await browser.newPage();
	await page.goto(`${BASE_URL}/publicview/projectinfo`, {
		waitUntil: 'networkidle2',
		timeout:   30000
	});
	await page.waitForSelector('#ProjectPVform', { timeout: 15000 }).catch(() => {});

	if (district && PUNJAB_DISTRICT_CODES[district]) {
		await page.select('#Input_RegdProject_DistrictCode', PUNJAB_DISTRICT_CODES[district]).catch(() => {});
		await new Promise(r => setTimeout(r, 400));
		console.log(`[Punjab Promoters] Browser opened — district "${district}" selected. Fill CAPTCHA and submit.`);
	} else {
		console.log(`[Punjab Promoters] Browser opened. Select district, fill CAPTCHA, and submit.`);
	}

	await page.bringToFront();
}

// Reconnect to the already-open browser and return { browser, page }
async function reconnect() {
	const ws = getWsEndpoint();
	if (!ws) return null;
	try {
		const browser = await puppeteer.connect({ browserWSEndpoint: ws });
		const pages = await browser.pages();
		const page = pages.find(p => p.url().includes('rera.punjab.gov.in')) || pages[pages.length - 1];
		return { browser, page };
	} catch (e) {
		console.warn('[Punjab Promoters] Reconnect failed:', e.message);
		setWsEndpoint(null);
		return null;
	}
}

function isSessionValid() {
	const ws = getWsEndpoint();
	const ts = getCreatedAt();
	return !!ws && ts > 0 && Date.now() - ts < SESSION_TTL_MS;
}

async function isTableReady(page) {
	return page.evaluate(() => {
		const tables = [
			document.querySelector('#dataTableSearchProject'),
			document.querySelector('#viewProjectPVList table'),
			document.querySelector('#contentRegdProjectList table')
		];
		for (const table of tables) {
			if (!table) continue;
			const hasRealRow = [...table.querySelectorAll('tbody tr')]
				.some(tr => tr.querySelectorAll('td').length >= 4);
			if (hasRealRow) return true;
		}
		return false;
	}).catch(() => false);
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal extractor — handles tabs + key-value tables + data tables
// ─────────────────────────────────────────────────────────────────────────────

const MODAL_EXTRACTOR = `
(function extractModal() {
	const modal = document.querySelector('#myModal .modal-content') ||
	              document.querySelector('#myModal') ||
	              document.querySelector('.modal.in .modal-content') ||
	              document.querySelector('.modal-content');
	if (!modal) return null;

	const clean    = s => (s || '').replace(/[:\\*]/g, '').trim();
	const cleanVal = s => (s || '').replace(/\\s+/g, ' ').trim();

	const result = { flat: {}, sections: {}, tables: [] };

	function extractFromContainer(container, sectionLabel) {
		const sec = sectionLabel || 'General';
		if (!result.sections[sec]) result.sections[sec] = {};

		const seen = new WeakSet();
		container.querySelectorAll('table').forEach(table => {
			if (seen.has(table)) return;
			seen.add(table);
			if (table.closest('table')) return;

			const thead   = table.querySelector('thead');
			const headers = thead
				? [...thead.querySelectorAll('th')].map(th => cleanVal(th.textContent)).filter(Boolean)
				: [];

			if (headers.length >= 2) {
				const rows = [];
				table.querySelectorAll('tbody tr').forEach(tr => {
					const cells = [...tr.querySelectorAll('td')];
					if (cells.every(c => !cleanVal(c.textContent) || cleanVal(c.textContent) === '--')) return;
					const row = {};
					headers.forEach((h, i) => { row[h] = cleanVal(cells[i]?.textContent || ''); });
					rows.push(row);
				});
				if (rows.length > 0) result.tables.push({ section: sec, headers, rows });
			} else {
				table.querySelectorAll('tr').forEach(tr => {
					const cells = [...tr.querySelectorAll('td, th')];
					if (cells.length === 2) {
						const k = clean(cells[0].textContent);
						const v = cleanVal(cells[1].textContent);
						if (k) { result.sections[sec][k] = v; result.flat[k] = v; }
					} else if (cells.length === 4) {
						[[0,1],[2,3]].forEach(([ki, vi]) => {
							const k = clean(cells[ki].textContent);
							const v = cleanVal(cells[vi].textContent);
							if (k) { result.sections[sec][k] = v; result.flat[k] = v; }
						});
					}
				});
			}
		});
	}

	const panes = [...modal.querySelectorAll('.tab-content .tab-pane')];
	if (panes.length > 0) {
		panes.forEach(pane => {
			const paneId  = pane.id;
			const tabLink = paneId
				? modal.querySelector('a[href="#' + paneId + '"], a[data-target="#' + paneId + '"], a[data-bs-target="#' + paneId + '"]')
				: null;
			const tabName = cleanVal(tabLink?.textContent || paneId || 'Tab');
			extractFromContainer(pane, tabName);
		});
	} else {
		const body = modal.querySelector('.modal-body') || modal;
		extractFromContainer(body, 'General');
	}

	return result;
})()
`;

// ─────────────────────────────────────────────────────────────────────────────
// Row scraping helpers
// ─────────────────────────────────────────────────────────────────────────────

async function scrapeBasicRows(page) {
	// Expand DataTable — try DataTable API first, then fall back to the length <select>
	await page.evaluate(() => {
		const $ = window.jQuery || window.$;
		if (!$) return;
		try {
			const dt = $('#dataTableSearchProject').DataTable();
			dt.page.len(-1).draw();
		} catch {
			try {
				const sel = document.querySelector('#dataTableSearchProject_length select');
				if (sel) {
					if (![...sel.options].some(o => o.value === '-1')) {
						const opt = document.createElement('option');
						opt.value = '-1'; opt.text = 'All';
						sel.appendChild(opt);
					}
					sel.value = '-1';
					sel.dispatchEvent(new Event('change', { bubbles: true }));
				}
			} catch {}
		}
	});
	await new Promise(r => setTimeout(r, 3000));

	return page.evaluate(() => {
		let tbody = null;
		for (const sel of [
			'#dataTableSearchProject tbody',
			'#viewProjectPVList table tbody',
			'#contentRegdProjectList table tbody'
		]) {
			const el = document.querySelector(sel);
			if (el && el.querySelectorAll('tr').length > 0) { tbody = el; break; }
		}
		if (!tbody) return [];

		let hasSno = false;
		const firstReal = [...tbody.querySelectorAll('tr')].find(tr => tr.querySelectorAll('td').length >= 5);
		if (firstReal) {
			const firstText = firstReal.querySelectorAll('td')[0]?.innerText?.trim();
			hasSno = /^\d+$/.test(firstText);
		}

		const rows = [];
		tbody.querySelectorAll('tr').forEach((tr, idx) => {
			const tds = tr.querySelectorAll('td');
			const minCols = hasSno ? 6 : 5;
			if (tds.length < minCols) return;

			const off = hasSno ? 1 : 0;
			rows.push({
				_rowIndex:      idx,
				district:       tds[off]?.innerText?.trim()     || '',
				projectName:    tds[off + 1]?.innerText?.trim() || '',
				promoterName:   tds[off + 2]?.innerText?.trim() || '',
				registrationNo: tds[off + 3]?.innerText?.trim() || '',
				validUpto:      tds[off + 4]?.innerText?.trim() || '',
				projectID:      tr.querySelector('.hdnProjectID')?.value   || '',
				promoterID:     tr.querySelector('.hdnPromoterID')?.value   || '',
				promoterType:   tr.querySelector('.hdnPromoterType')?.value || '',
				hasViewBtn:     !!(tds[tds.length - 1]?.querySelector('a'))
			});
		});
		return rows;
	});
}

async function scrapeRowDetail(page, rowIndex) {
	try {
		const clicked = await page.evaluate((idx) => {
			const rows = document.querySelectorAll('#dataTableSearchProject tbody tr');
			const row  = rows[idx];
			if (!row) return false;
			const btn = row.querySelector('a#modalOpenerButton') || row.querySelector('a');
			if (!btn) return false;
			btn.click();
			return true;
		}, rowIndex);

		if (!clicked) return null;

		// Wait until #myModal .modal-body has real AJAX content
		await page.waitForFunction(() => {
			const body = document.querySelector('#myModal .modal-body');
			return body && body.innerHTML.trim().length > 50;
		}, { timeout: 20000 });

		await new Promise(r => setTimeout(r, 600));

		// Click through all tabs in #myModal
		const tabCount = await page.evaluate(() => {
			return document.querySelectorAll('#myModal .nav-tabs li a, #myModal .nav-tabs .nav-link').length;
		});

		if (tabCount > 1) {
			for (let t = 0; t < tabCount; t++) {
				await page.evaluate((idx) => {
					const tabs = [...document.querySelectorAll('#myModal .nav-tabs li a, #myModal .nav-tabs .nav-link')];
					if (tabs[idx]) tabs[idx].click();
				}, t);
				await new Promise(r => setTimeout(r, 500));
			}
		}

		const detail = await page.evaluate(new Function(`return ${MODAL_EXTRACTOR}`));

		await page.evaluate(() => {
			const $ = window.jQuery || window.$;
			if ($) { $('#myModal').modal('hide'); return; }
			const btn = document.querySelector('#myModal [data-dismiss="modal"], #myModal .close');
			if (btn) btn.click();
		});

		await page.waitForFunction(() => {
			const m = document.querySelector('#myModal');
			return !m || !m.classList.contains('in') || m.style.display === 'none';
		}, { timeout: 8000 }).catch(() => {});

		await new Promise(r => setTimeout(r, 300));
		return detail;

	} catch (err) {
		console.warn(`[Punjab Promoters] Detail failed for row ${rowIndex}:`, err.message);
		await page.evaluate(() => {
			const $ = window.jQuery || window.$;
			if ($) { try { $('#myModal').modal('hide'); } catch {} }
		}).catch(() => {});
		await new Promise(r => setTimeout(r, 500));
		return null;
	}
}

function mapDetailToPromoter(detail, basic) {
	if (!detail) return {};
	const f = detail.flat || {};

	const find = (...keys) => {
		for (const k of keys) {
			const kl = k.toLowerCase();
			const exact = Object.entries(f).find(([fk]) => fk.toLowerCase() === kl);
			if (exact?.[1]) return String(exact[1]);
			const partial = Object.entries(f).find(([fk]) => fk.toLowerCase().includes(kl));
			if (partial?.[1]) return String(partial[1]);
		}
		return undefined;
	};

	return {
		promoterName:  find('promoter name', 'builder name', 'applicant name', 'name') || basic.promoterName,
		applicantType: find('applicant type', 'type', 'promoter type')                  || basic.promoterType || 'Promoter',
		district:      find('district')                                                 || basic.district,
		email:         find('email', 'e-mail'),
		mobile:        find('mobile', 'phone', 'contact'),
		address:       find('address', 'permanent address', 'registered address'),
		pan:           find('pan', 'pan no', 'pan number'),
		aadhaar:       find('aadhaar', 'aadhar'),
		rawData:       { ...basic, detail }
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// Route handler
// ─────────────────────────────────────────────────────────────────────────────

export async function GET({ url }) {
	const action   = url.searchParams.get('action')   || '';
	const district = url.searchParams.get('district') || '';
	const refresh  = url.searchParams.get('refresh')  === 'true';
	const search   = url.searchParams.get('search')   || '';

	if (action === 'districts') {
		return json({
			success: true,
			data: PUNJAB_DISTRICTS.map(d => ({ name: d, code: d })).sort((a, b) => a.name.localeCompare(b.name))
		});
	}

	if (action === 'open-browser') {
		try {
			await openSession(district);
			return json({ success: true, district: district || 'all' });
		} catch (err) {
			await closeSession();
			return json({ success: false, error: err.message }, { status: 500 });
		}
	}

	if (action === 'check-ready') {
		if (!isSessionValid()) return json({ ready: false, sessionExpired: true });
		const conn = await reconnect();
		const ready = conn ? await isTableReady(conn.page) : false;
		return json({ ready });
	}

	if (action === 'close-browser') {
		await closeSession();
		return json({ success: true });
	}

	if (!refresh) {
		try {
			const { companies, total } = await CompanyService.getCompaniesByState(STATE, {
				search, role: 'promoter', take: 5000
			});
			if (companies.length > 0) return json({ success: true, data: companies, total, cached: true });
		} catch (dbErr) {
			console.warn('[Punjab Promoters] DB read failed:', dbErr.message);
		}
		return json({ success: true, data: [], total: 0, cached: true, empty: true });
	}

	if (!isSessionValid()) {
		return json({
			success: false,
			error: 'Browser session not found — click "Open Browser", fill the CAPTCHA, then click "Scrape Now".'
		}, { status: 400 });
	}

	const conn = await reconnect();
	if (!conn) {
		return json({
			success: false,
			error: 'Could not reconnect to browser — the window may have been closed. Open the browser again.'
		}, { status: 400 });
	}
	const { browser: connBrowser, page } = conn;

	if (await ScrapeLogService.isRunning(SOURCE, STATE)) {
		const { companies, total } = await CompanyService.getCompaniesByState(STATE, { search, role: 'promoter', take: 5000 });
		return json({ success: true, data: companies, total, cached: true, scraping: true });
	}

	const log = await ScrapeLogService.startScrapeLog(SOURCE, STATE);

	try {
		// Wait up to 60s for the table to have real rows
		console.log('[Punjab Promoters] Waiting for results table...');
		await page.waitForFunction(() => {
			const selectors = [
				'#dataTableSearchProject',
				'#viewProjectPVList table',
				'#contentRegdProjectList table'
			];
			for (const sel of selectors) {
				const t = document.querySelector(sel);
				if (t && [...t.querySelectorAll('tbody tr')].some(tr => tr.querySelectorAll('td').length >= 4)) return true;
			}
			return false;
		}, { timeout: 60000 }).catch(() => {
			console.warn('[Punjab Promoters] Table wait timed out — proceeding anyway');
		});

		const basicRows = await scrapeBasicRows(page);
		console.log(`[Punjab Promoters] ${basicRows.length} rows found — scraping detail modals...`);

		const fullPromoters = [];
		for (let i = 0; i < basicRows.length; i++) {
			const basic = basicRows[i];
			console.log(`[Punjab Promoters] Detail ${i + 1}/${basicRows.length}: ${basic.promoterName}`);

			let mapped = {};
			if (basic.hasViewBtn) {
				const detail = await scrapeRowDetail(page, i);
				mapped = mapDetailToPromoter(detail, basic);
			}

			fullPromoters.push({
				promoterName:    mapped.promoterName  || basic.promoterName,
				applicantType:   mapped.applicantType || basic.promoterType || 'Promoter',
				district:        mapped.district      || basic.district,
				email:           mapped.email,
				mobile:          mapped.mobile,
				address:         mapped.address,
				pan:             mapped.pan,
				promoterID:      basic.promoterID,
				// Project linkage
				projectName:     basic.projectName,
				projectRegNo:    basic.registrationNo,
				validUntil:      basic.validUpto,
				projectDistrict: basic.district,
				rawData:         mapped.rawData || basic
			});
		}

		let upsertCount = 0;
		if (fullPromoters.length > 0) {
			try {
				upsertCount = await CompanyService.upsertCompanies(STATE, fullPromoters, { role: 'promoter' });
			} catch (dbErr) {
				console.warn('[Punjab Promoters] DB upsert failed:', dbErr.message);
			}
		}

		await ScrapeLogService.completeScrapeLog(log.id, { totalItems: upsertCount });
		console.log(`[Punjab Promoters] Done — ${basicRows.length} scraped, ${upsertCount} saved`);

		await closeSession();

		const { companies, total } = await CompanyService.getCompaniesByState(STATE, {
			search, role: 'promoter', take: 5000
		});
		return json({
			success: true, data: companies, total,
			scraped: basicRows.length, upserted: upsertCount
		});

	} catch (error) {
		await ScrapeLogService.completeScrapeLog(log.id, { error: error.message });
		console.error('[Punjab Promoters] Scrape failed:', error.message);

		try {
			const { companies, total } = await CompanyService.getCompaniesByState(STATE, {
				search, role: 'promoter', take: 5000
			});
			if (companies.length > 0) {
				return json({ success: true, data: companies, total, cached: true, scrapeError: error.message });
			}
		} catch {}
		return json({ success: false, error: error.message }, { status: 500 });
	}
}
