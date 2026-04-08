// src/routes/api/telangana-rera-agents/+server.js
//
// Telangana RERA (RERAIT) agent scraper — browser-session pattern
//
// RERAIT search page has radio buttons for listing type:
//   Projects  → <input id="Project" name="Type" value="Project">
//   Agents    → <input id="Agent"   name="Type" value="Agent">
//
// This scraper selects the "Agent" radio before submitting.
// View Details still POSTs a hidden form — same new-tab trick as projects.
//
// GET ?action=open-browser   → opens Chrome on RERAIT search page with Agent radio pre-selected
// GET ?action=check-ready    → polls for results table
// GET ?action=scrape-status  → current progress { done, total, running }
// GET ?refresh=true          → full scrape (all DT pages + all details)
// GET ?refresh=true&limit=N  → scrape first N rows only
// GET ?action=close-browser  → closes browser
// GET (default)              → returns cached DB data

import puppeteer from 'puppeteer';
import { json } from '@sveltejs/kit';
import { AgentService, ScrapeLogService } from '$lib/server/services/index.js';

const STATE       = 'Telangana';
const SOURCE      = 'telangana-rera-agents';
const SEARCH_URL  = 'https://rerait.telangana.gov.in/SearchList/Search';
const SESSION_TTL = 30 * 60 * 1000; // 30 min

// ─────────────────────────────────────────────────────────────────────────────
// Session helpers (stored on process to survive Vite HMR)
// ─────────────────────────────────────────────────────────────────────────────

const _g      = process;
const getWs   = ()  => _g.__tgAgentWs   || null;
const setWs   = ws  => { _g.__tgAgentWs   = ws; };
const getTs   = ()  => _g.__tgAgentTs   || 0;
const setTs   = ts  => { _g.__tgAgentTs   = ts; };
const getProg = ()  => _g.__tgAgentProg || { done: 0, total: 0, running: false };
const setProg = p   => { _g.__tgAgentProg = p; };

async function closeSession() {
	const ws = getWs();
	if (ws) { try { const b = await puppeteer.connect({ browserWSEndpoint: ws }); await b.close(); } catch {} }
	setWs(null); setTs(0);
}

async function openSession() {
	await closeSession();
	const browser = await puppeteer.launch({
		headless: false,
		defaultViewport: null,
		args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized']
	});
	setWs(browser.wsEndpoint());
	setTs(Date.now());
	const page = await browser.newPage();
	await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36');
	await page.goto(SEARCH_URL, { waitUntil: 'networkidle2', timeout: 30000 });

	// Pre-select the "Agent" radio button so the user only needs to hit Submit
	await page.evaluate(() => {
		const agentRadio = document.getElementById('Agent') ||
			[...document.querySelectorAll('input[type=radio]')].find(r => r.value === 'Agent');
		if (agentRadio) { agentRadio.checked = true; agentRadio.dispatchEvent(new Event('change', { bubbles: true })); }
	}).catch(() => {});

	await page.bringToFront();
	console.log('[TG Agents] Browser opened — "Agent" radio pre-selected. Submit form, then Check Ready.');
}

function isSessionValid() { return !!getWs() && (Date.now() - getTs()) < SESSION_TTL; }

async function reconnect() {
	const ws = getWs();
	if (!ws) return null;
	try {
		const browser = await puppeteer.connect({ browserWSEndpoint: ws });
		const pages   = await browser.pages();
		const page    = pages.find(p => p.url().includes('rerait.telangana.gov.in')) || pages[pages.length - 1];
		return { browser, page };
	} catch (e) { console.warn('[TG Agents] Reconnect failed:', e.message); setWs(null); return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Table readiness check
// ─────────────────────────────────────────────────────────────────────────────

async function isTableReady(page) {
	return page.evaluate(() => {
		for (const t of document.querySelectorAll('table'))
			if ([...t.querySelectorAll('tbody tr')].some(tr => tr.querySelectorAll('td').length >= 3))
				return true;
		return false;
	}).catch(() => false);
}

// ─────────────────────────────────────────────────────────────────────────────
// Try to increase DataTable page size using only options the server supports.
// Avoid injecting a fake "-1" option — server-side tables ignore it and it
// corrupts pagination state, leaving only the default 10 rows visible.
// ─────────────────────────────────────────────────────────────────────────────

async function expandDataTable(page) {
	await page.evaluate(() => {
		const $ = window.jQuery || window.$;
		if ($) {
			try {
				$('table').each(function() {
					try {
						const dt = $(this).DataTable();
						// Only set larger page size if it exists as a real option
						const sel = document.querySelector('select[name$="_length"]');
						if (!sel) return;
						const largest = [...sel.options]
							.map(o => parseInt(o.value, 10))
							.filter(v => !isNaN(v) && v > 0)
							.sort((a, b) => b - a)[0];
						if (largest && largest > (dt.page.len() || 10)) {
							dt.page.len(largest).draw();
						}
					} catch {}
				});
			} catch {}
		}
		// Fallback: use the select element directly with its largest real numeric option
		document.querySelectorAll('select[name$="_length"]').forEach(sel => {
			const largest = [...sel.options]
				.map(o => parseInt(o.value, 10))
				.filter(v => !isNaN(v) && v > 0)
				.sort((a, b) => b - a)[0];
			if (largest && String(largest) !== sel.value) {
				sel.value = String(largest);
				sel.dispatchEvent(new Event('change', { bubbles: true }));
			}
		});
	}).catch(() => {});
	await new Promise(r => setTimeout(r, 2500));
}

// ─────────────────────────────────────────────────────────────────────────────
// Scrape ALL basic rows across ALL DataTable pages
// Returns flat array with _agentId, _onclick per row.
// ─────────────────────────────────────────────────────────────────────────────

async function scrapeAllBasicRows(page) {
	// RERAIT pagination is NOT DataTables. The site uses server-side form
	// submission: pagination buttons have a `data-pg="N"` attribute, and
	// clicking one sets #pageTraverse and submits #frmSearchList (full POST).
	// We must do the same and wait for navigation.

	const maxPage = await page.evaluate(() => {
		const buttons = [...document.querySelectorAll('[data-pg]')];
		const nums = buttons
			.map(b => parseInt(b.getAttribute('data-pg'), 10))
			.filter(n => !isNaN(n) && n > 0);
		return nums.length ? Math.max(...nums) : 1;
	}).catch(() => 1);

	console.log(`[TG Agents] Pagination reports ${maxPage} page(s)`);

	const extractRows = () => page.evaluate(() => {
		const trim = s => (s || '').replace(/\s+/g, ' ').trim();
		let best = null, bestN = 0;
		document.querySelectorAll('table').forEach(t => {
			const n = t.querySelectorAll('tbody tr').length;
			if (n > bestN) { bestN = n; best = t; }
		});
		if (!best || bestN === 0) return [];

		const thead   = best.querySelector('thead');
		const headers = thead
			? [...thead.querySelectorAll('th,td')].map(th => trim(th.innerText))
			: [];

		const result = [];
		best.querySelectorAll('tbody tr').forEach((tr, rowIdx) => {
			const tds = [...tr.querySelectorAll('td')];
			if (tds.length < 2) return;

			let onclick = '', agentId = '';
			tds.forEach(td => {
				td.querySelectorAll('a,button,input[type=button]').forEach(el => {
					if (agentId) return;
					const oc   = el.getAttribute('onclick') || '';
					const href = el.getAttribute('href')   || '';
					const txt  = trim(el.innerText || el.value || '').toLowerCase();
					if (!/view|detail/i.test(txt) && !oc && !href) return;
					const ocM = oc.match(/\((\d+)/);
					if (ocM) { onclick = oc; agentId = ocM[1]; return; }
					const hM = href.match(/[\/=](\d{4,})\b/);
					if (hM && !/^(javascript|#)/i.test(href)) { agentId = hM[1]; return; }
					if (!onclick && oc) onclick = oc;
				});
			});

			const cells = tds.map(td => trim(td.innerText));
			const row   = { _rowIdx: rowIdx, _dtPage: 0, _onclick: onclick, _agentId: agentId };

			if (headers.length > 0) {
				headers.forEach((h, i) => { if (h) row[h] = cells[i] || ''; });
			} else {
				row['Sr No']      = cells[0] || '';
				row['Agent Name'] = cells[1] || '';
				row['Cert No']    = cells[2] || '';
				row['Valid Upto'] = cells[3] || '';
			}
			if (!row['Agent Name'] && row['Name']) row['Agent Name'] = row['Name'];
			result.push(row);
		});
		return result;
	});

	const allRows = [];
	const seenIds = new Set();
	let currentPage = 1;
	let knownMaxPage = maxPage;

	while (true) {
		const rows = await extractRows();

		let added = 0;
		for (const row of rows) {
			const key = row._agentId || `${row['Agent Name']}||${row['Sr No']}`;
			if (!seenIds.has(key)) { seenIds.add(key); row._dtPage = currentPage - 1; allRows.push(row); added++; }
		}
		console.log(`[TG Agents] Page ${currentPage}: +${added} new → ${allRows.length} total`);

		// Re-discover max page on each load (it may grow as we walk forward)
		const observedMax = await page.evaluate(() => {
			const buttons = [...document.querySelectorAll('[data-pg]')];
			const nums = buttons
				.map(b => parseInt(b.getAttribute('data-pg'), 10))
				.filter(n => !isNaN(n) && n > 0);
			return nums.length ? Math.max(...nums) : 1;
		}).catch(() => knownMaxPage);
		if (observedMax > knownMaxPage) knownMaxPage = observedMax;

		if (currentPage >= knownMaxPage) {
			console.log(`[TG Agents] Reached last page (${knownMaxPage}) — done`);
			break;
		}

		const nextPage = currentPage + 1;
		console.log(`[TG Agents] Submitting form for page ${nextPage}/${knownMaxPage}`);

		try {
			await Promise.all([
				page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }),
				page.evaluate(targetPage => {
					const inp = document.getElementById('pageTraverse');
					if (inp) inp.value = String(targetPage);
					const form = document.getElementById('frmSearchList');
					if (form) {
						form.target = ''; // critical: clear any _blank from prior detail clicks
						form.submit();
					}
				}, nextPage)
			]);
		} catch (e) {
			console.warn(`[TG Agents] Navigation to page ${nextPage} failed: ${e.message}`);
			break;
		}

		await page.waitForFunction(() => {
			for (const t of document.querySelectorAll('table'))
				if ([...t.querySelectorAll('tbody tr')].some(tr => tr.querySelectorAll('td').length >= 3)) return true;
			return false;
		}, { timeout: 30000 }).catch(() => console.warn(`[TG Agents] Table not found after page ${nextPage} load`));

		currentPage = nextPage;
		if (currentPage > 5000) break;
	}

	return allRows;
}

// ─────────────────────────────────────────────────────────────────────────────
// Detail extractor — ES5 IIFE, passed directly as string to page.evaluate().
// Same structure as projects: .x_panel > .x_title > h2 + .x_content sections.
// ─────────────────────────────────────────────────────────────────────────────

const DETAIL_EXTRACTOR = `(function extractReraitAgent() {
	var trim   = function(s) { return (s || '').replace(/\\s+/g,' ').trim(); };
	var cleanK = function(s) { return s.replace(/[*:]+$/,'').replace(/^[*:]+/,'').trim(); };
	var result = { sections:{}, tables:[] };

	function set(sec, k, v) {
		k = cleanK(k);
		if (!k || !v || k === v || k.length > 120) return;
		if (!result.sections[sec]) result.sections[sec] = {};
		if (!result.sections[sec][k]) result.sections[sec][k] = v;
	}

	function colVal(el) {
		if (!el) return '';
		var inp = el.querySelector('input:not([type=hidden]):not([type=checkbox]):not([type=radio]),select,textarea');
		if (inp) {
			if (inp.tagName === 'SELECT')
				return trim((inp.options[inp.selectedIndex] && inp.options[inp.selectedIndex].text) || inp.value || '');
			return trim(inp.value || inp.getAttribute('value') || inp.innerText || '');
		}
		return trim(el.innerText);
	}

	function processFG(fg, sec) {
		var cols = [].slice.call(fg.children).filter(function(c){ return c.className && /col-/i.test(c.className); });
		for (var i = 0; i + 1 < cols.length; i += 2) {
			var lbl = cols[i].querySelector('label,strong,b') || cols[i];
			var k   = trim(lbl.innerText);
			if (!k || k.length > 120) continue;
			set(sec, k, colVal(cols[i+1]));
		}
	}

	function processTable(table, sec) {
		var anc = table.parentElement;
		while (anc) { if (anc.tagName === 'TABLE') return; anc = anc.parentElement; }
		var thead   = table.querySelector('thead');
		var headers = thead
			? [].slice.call(thead.querySelectorAll('th,td')).map(function(h){ return trim(h.innerText); }).filter(Boolean)
			: [];
		var bodyRows = [].slice.call(table.querySelectorAll('tbody tr,tr'))
			.filter(function(tr){ return !tr.closest('thead') && tr.querySelectorAll('td').length > 0; });
		if (headers.length >= 2) {
			var rows = [];
			bodyRows.forEach(function(tr) {
				var cells = [].slice.call(tr.querySelectorAll('td'));
				if (cells.every(function(c){ return !trim(c.innerText); })) return;
				var row = {};
				headers.forEach(function(h,idx){ row[h] = colVal(cells[idx]); });
				rows.push(row);
			});
			if (rows.length) result.tables.push({ section:sec, headers:headers, rows:rows });
		} else {
			bodyRows.forEach(function(tr) {
				var cells = [].slice.call(tr.querySelectorAll('td,th'));
				if (cells.length >= 2) set(sec, trim(cells[0].innerText), colVal(cells[1]));
				if (cells.length >= 4) set(sec, trim(cells[2].innerText), colVal(cells[3]));
			});
		}
	}

	[].slice.call(document.querySelectorAll('.x_panel')).forEach(function(panel) {
		var hEl = panel.querySelector('.x_title h1,.x_title h2,.x_title h3,.x_title h4');
		var sec = hEl ? trim(hEl.innerText) : 'General';
		var content = panel.querySelector('.x_content');
		if (!content) return;
		[].slice.call(content.querySelectorAll('.form-group')).forEach(function(fg){ processFG(fg, sec); });
		[].slice.call(content.querySelectorAll('table')).forEach(function(t){ processTable(t, sec); });
	});

	var total = Object.keys(result.sections).reduce(function(n,k){ return n + Object.keys(result.sections[k]).length; }, 0);
	if (total === 0) {
		var root = document.querySelector('.container-print,.container,body') || document.body;
		[].slice.call(root.querySelectorAll('.form-group')).forEach(function(fg){ processFG(fg, 'General'); });
		[].slice.call(root.querySelectorAll('table')).forEach(function(t){ processTable(t, 'General'); });
	}
	return result;
})()`;

// ─────────────────────────────────────────────────────────────────────────────
// Open detail in new tab, extract, close tab
// ─────────────────────────────────────────────────────────────────────────────

async function scrapeRowDetail(browser, page, basicRow) {
	const agentName = basicRow['Agent Name'] || basicRow['Name'] || '';
	const srNo      = basicRow['Sr No'] || '';
	const agentId   = basicRow._agentId || '';
	const onclick   = basicRow._onclick  || '';

	try {
		await page.evaluate(() => {
			const f = document.getElementById('frmSearchList');
			if (f) f.target = '_blank';
		}).catch(() => {});

		const newTabPromise = new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error('new-tab timeout')), 20000);
			browser.once('targetcreated', async target => {
				clearTimeout(timer);
				try { resolve(await target.page()); } catch (e) { reject(e); }
			});
		});

		const clicked = await page.evaluate((name, sr, aid, oc) => {
			const trim = s => (s || '').replace(/\s+/g, ' ').trim();
			for (const table of document.querySelectorAll('table')) {
				for (const tr of table.querySelectorAll('tbody tr')) {
					const tds    = [...tr.querySelectorAll('td')];
					const rowTxt = trim(tr.innerText);
					const matchName = name && rowTxt.includes(name);
					const matchSr   = sr   && trim(tds[0]?.innerText || '') === sr;
					if (!matchName && !matchSr) continue;
					for (const el of tr.querySelectorAll('a,button,input[type=button]')) {
						const t   = trim(el.innerText || el.value || '').toLowerCase();
						const oc2 = el.getAttribute('onclick') || '';
						if (/view|detail/i.test(t) || oc2) { el.click(); return { ok: true, via: 'button' }; }
					}
				}
			}
			if (aid) {
				for (const fn of ['ViewApplicationDetail','ViewDetail','ViewAgent','viewDetail','openDetail']) {
					if (typeof window[fn] === 'function') { window[fn](+aid); return { ok: true, via: fn }; }
				}
				try { if (oc) { eval(oc); return { ok: true, via: 'eval' }; } } catch {}
				const idInput = document.getElementById('ID');
				const form    = document.getElementById('frmSearchList');
				if (idInput && form) { idInput.value = aid; form.submit(); return { ok: true, via: 'form' }; }
			}
			return { ok: false };
		}, agentName, srNo, agentId, onclick);

		await page.evaluate(() => { const f = document.getElementById('frmSearchList'); if (f) f.target = ''; }).catch(() => {});

		if (!clicked?.ok) {
			console.warn(`[TG Agents]   ↳ Could not click for "${agentName}"`);
			return null;
		}

		const detailPage = await newTabPromise;
		await detailPage.waitForNavigation({ waitUntil: 'networkidle2', timeout: 25000 }).catch(() => {});

		const isDetail = await detailPage.waitForFunction(() => {
			const t = document.body?.innerText || '';
			return t.length > 200;
		}, { timeout: 15000 }).then(() => true).catch(() => false);

		if (!isDetail) {
			console.warn(`[TG Agents]   ↳ Not a detail page (${detailPage.url()})`);
			await detailPage.close().catch(() => {});
			return null;
		}

		await new Promise(r => setTimeout(r, 300));
		const detail = await detailPage.evaluate(DETAIL_EXTRACTOR).catch(e => {
			console.warn(`[TG Agents]   ↳ evaluate error: ${e.message}`);
			return null;
		});

		const fields = Object.values(detail?.sections || {}).reduce((n, s) => n + Object.keys(s).length, 0);
		console.log(`[TG Agents]   → ${Object.keys(detail?.sections || {}).length} sections, ${fields} fields, ${(detail?.tables || []).length} tables`);

		await detailPage.close().catch(() => {});
		return detail;

	} catch (err) {
		console.warn(`[TG Agents] Detail error "${agentName}": ${err.message}`);
		await page.evaluate(() => { const f = document.getElementById('frmSearchList'); if (f) f.target = ''; }).catch(() => {});
		return null;
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Map extracted detail + basic row → DB agent shape
// ─────────────────────────────────────────────────────────────────────────────

function mapToAgent(detail, basicRow) {
	const flat = {};
	if (detail?.sections) {
		Object.values(detail.sections).forEach(sec =>
			Object.entries(sec).forEach(([k, v]) => { flat[k.toLowerCase().trim()] = v; })
		);
	}
	const find = (...terms) => {
		for (const t of terms) {
			const tl = t.toLowerCase();
			if (flat[tl]) return flat[tl];
			const hit = Object.entries(flat).find(([k]) => k.includes(tl));
			if (hit?.[1]) return hit[1];
		}
	};
	const rowGet = (...keys) => {
		for (const k of keys) {
			if (basicRow[k] && basicRow[k] !== 'View Details') return basicRow[k];
			const hit = Object.entries(basicRow).find(([rk]) => rk.toLowerCase() === k.toLowerCase());
			if (hit?.[1] && hit[1] !== 'View Details') return hit[1];
		}
		return '';
	};

	const agentName   = find('agent name','applicant name','name of agent','name') || rowGet('Agent Name','Name');
	const certNo      = find('certificate no','registration no','cert no','rera no','reg no','application no')
	                 || rowGet('Cert No','Certificate No','Registration No');
	const district    = find('district') || '';
	const area        = find('area','locality','sector','ward','village','mandal') || '';
	const pinCode     = find('pincode','pin code','postal code','pin no') || '';
	const validUpto   = find('valid upto','validity','valid till','certificate validity','registration validity')
	                 || rowGet('Valid Upto','Valid Till');
	const regDate     = find('registration date','reg date','certificate date','issue date') || '';
	const agentType   = find('type','agent type','category') || '';
	const mobile      = find('mobile','phone','contact') || '';
	const email       = find('email','e-mail') || '';
	const address     = find('address','locality','area') || district;

	return {
		reraRegNo:   certNo    || `TG-AGT-${basicRow._rowIdx ?? Date.now()}`,
		name:        agentName || '(Unknown)',
		agentName:   agentName || '(Unknown)',
		district,
		area,
		pinCode,
		validUntil:  validUpto  || '',
		regDate,
		agentType,
		mobile,
		email,
		address,
		rawData: {
			basicRow,
			detail: detail ? { sections: detail.sections, tables: detail.tables } : null
		}
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// Route handler
// ─────────────────────────────────────────────────────────────────────────────

export async function GET({ url }) {
	const action  = url.searchParams.get('action')  || '';
	const refresh = url.searchParams.get('refresh') === 'true';
	const search  = url.searchParams.get('search')  || '';
	const limitP  = parseInt(url.searchParams.get('limit') || '0', 10);

	if (action === 'open-browser') {
		try {
			await openSession();
			return json({ success: true, message: 'Browser opened with Agent radio pre-selected. Submit form, then Check Ready.' });
		} catch (err) {
			await closeSession();
			return json({ success: false, error: err.message }, { status: 500 });
		}
	}

	if (action === 'check-ready') {
		if (!isSessionValid()) return json({ ready: false, sessionExpired: true });
		const conn  = await reconnect();
		const ready = conn ? await isTableReady(conn.page) : false;
		return json({ ready });
	}

	if (action === 'scrape-status') {
		return json({ success: true, progress: getProg() });
	}

	if (action === 'close-browser') {
		await closeSession();
		return json({ success: true });
	}

	// Cached list
	if (!refresh) {
		try {
			const { agents, total } = await AgentService.getAgentsByState(STATE, { search, take: 10000 });
			return json({ success: true, data: agents, total, cached: true });
		} catch {
			return json({ success: true, data: [], total: 0, cached: true, empty: true });
		}
	}

	// Scrape
	if (!isSessionValid())
		return json({ success: false, error: 'No active session — open browser, submit search, then Scrape Now.' }, { status: 400 });

	const conn = await reconnect();
	if (!conn)
		return json({ success: false, error: 'Browser window closed — open it again.' }, { status: 400 });

	const { browser, page } = conn;

	if (await ScrapeLogService.isRunning(SOURCE, STATE)) {
		const prog = getProg();
		const { agents, total } = await AgentService.getAgentsByState(STATE, { search, take: 10000 }).catch(() => ({ agents: [], total: 0 }));
		return json({ success: true, data: agents, total, cached: true, scraping: true, progress: prog });
	}

	const log = await ScrapeLogService.startScrapeLog(SOURCE, STATE);
	setProg({ done: 0, total: 0, running: true });

	// Run in background so the browser UI stays responsive
	;(async () => {
		try {
			await page.waitForFunction(() => {
				for (const t of document.querySelectorAll('table'))
					if ([...t.querySelectorAll('tbody tr')].some(tr => tr.querySelectorAll('td').length >= 3)) return true;
				return false;
			}, { timeout: 60000 }).catch(() => console.warn('[TG Agents] Table wait timed-out'));

			// Phase 1 — collect all rows across all DT pages
			const allRows = await scrapeAllBasicRows(page);
			console.log(`[TG Agents] Phase 1 complete: ${allRows.length} rows`);

			const toProcess = limitP > 0 ? allRows.slice(0, limitP) : allRows;
			setProg({ done: 0, total: toProcess.length, running: true });

			// Phase 2 — detail pages; batch-save every 20 rows
			const BATCH = 20;
			let batchBuf = [];

			const flush = async () => {
				if (batchBuf.length === 0) return;
				const payload = batchBuf.map(({ detail, row }) => mapToAgent(detail, row));
				try { await AgentService.upsertAgents(STATE, payload); }
				catch (e) { console.warn('[TG Agents] Batch upsert failed:', e.message); }
				batchBuf = [];
			};

			for (let i = 0; i < toProcess.length; i++) {
				const row = toProcess[i];
				console.log(`[TG Agents] Detail ${i + 1}/${toProcess.length}: "${row['Agent Name'] || row._rowIdx}"`);
				const detail = await scrapeRowDetail(browser, page, row);
				batchBuf.push({ detail, row });
				setProg({ done: i + 1, total: toProcess.length, running: true });

				if (batchBuf.length >= BATCH) await flush();
				if ((i + 1) % 10 === 0) await new Promise(r => setTimeout(r, 400));
			}
			await flush();

			setProg({ done: toProcess.length, total: toProcess.length, running: false });
			await ScrapeLogService.completeScrapeLog(log.id, { totalItems: toProcess.length });
			console.log(`[TG Agents] Done — ${toProcess.length} agents processed`);
			await closeSession();

		} catch (err) {
			setProg({ ...getProg(), running: false, error: err.message });
			await ScrapeLogService.completeScrapeLog(log.id, { error: err.message });
			console.error('[TG Agents] Background scrape error:', err.message);
		}
	})();

	// Respond immediately with current DB data + progress
	await new Promise(r => setTimeout(r, 800));
	const { agents: db, total } = await AgentService.getAgentsByState(STATE, { search, take: 10000 }).catch(() => ({ agents: [], total: 0 }));
	return json({
		success: true, data: db, total, scraping: true,
		message: `Scraping started for ${limitP > 0 ? limitP : 'all'} rows. Poll ?action=scrape-status for progress.`
	});
}
