// src/routes/api/telangana-rera-projects/+server.js
//
// Telangana RERA (RERAIT) project scraper — browser-session pattern
//
// View Details on RERAIT POSTs a hidden form (ID field) — direct URL navigation
// returns the blank search form. goBack() after POST either shows a
// "Confirm Resubmission" dialog or wipes the results. Fix: set form.target=_blank
// before each click so the detail opens in a NEW TAB; results page stays intact.
//
// GET ?action=open-browser            → opens Chrome on RERAIT search page
// GET ?action=check-ready             → polls for results table
// GET ?action=scrape-status           → current progress (rows done/total)
// GET ?refresh=true                   → full scrape (all DT pages + all details)
// GET ?refresh=true&limit=N           → scrape first N rows only
// GET ?action=close-browser           → closes browser
// GET (default)                       → returns cached DB data

import puppeteer from 'puppeteer';
import { json } from '@sveltejs/kit';
import { ProjectService, ScrapeLogService } from '$lib/server/services/index.js';

const STATE       = 'Telangana';
const SOURCE      = 'telangana-rera-projects';
const SEARCH_URL  = 'https://rerait.telangana.gov.in/SearchList/Search';
const SESSION_TTL = 30 * 60 * 1000; // 30 min

// ─────────────────────────────────────────────────────────────────────────────
// Session helpers (stored on process to survive Vite HMR)
// ─────────────────────────────────────────────────────────────────────────────

const _g     = process;
const getWs  = ()   => _g.__tgProjWs   || null;
const setWs  = ws   => { _g.__tgProjWs   = ws; };
const getTs  = ()   => _g.__tgProjTs   || 0;
const setTs  = ts   => { _g.__tgProjTs   = ts; };
const getProg = ()  => _g.__tgProjProg || { done: 0, total: 0, running: false };
const setProg = p   => { _g.__tgProjProg = p; };

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
	await page.bringToFront();
	console.log('[TG Projects] Browser opened — fill search criteria and submit.');
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
	} catch (e) { console.warn('[TG Projects] Reconnect failed:', e.message); setWs(null); return null; }
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
// Returns flat array with _projectId, _onclick per row.
// ─────────────────────────────────────────────────────────────────────────────

async function scrapeAllBasicRows(page) {
	// RERAIT pagination is NOT DataTables. The site uses server-side form
	// submission: pagination buttons have a `data-pg="N"` attribute, and
	// clicking one sets #pageTraverse and submits #frmSearchList (full POST).
	// We must do the same and wait for navigation.

	// Discover the highest page number from the data-pg buttons present on page 1
	const maxPage = await page.evaluate(() => {
		const buttons = [...document.querySelectorAll('[data-pg]')];
		const nums = buttons
			.map(b => parseInt(b.getAttribute('data-pg'), 10))
			.filter(n => !isNaN(n) && n > 0);
		return nums.length ? Math.max(...nums) : 1;
	}).catch(() => 1);

	console.log(`[TG Projects] Pagination reports ${maxPage} page(s)`);

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

			let onclick = '', projectId = '';
			tds.forEach(td => {
				td.querySelectorAll('a,button,input[type=button]').forEach(el => {
					if (projectId) return;
					const oc   = el.getAttribute('onclick') || '';
					const href = el.getAttribute('href')   || '';
					const txt  = trim(el.innerText || el.value || '').toLowerCase();
					if (!/view|detail/i.test(txt) && !oc && !href) return;
					const ocM = oc.match(/\((\d+)/);
					if (ocM) { onclick = oc; projectId = ocM[1]; return; }
					const hM = href.match(/[\/=](\d{4,})\b/);
					if (hM && !/^(javascript|#)/i.test(href)) { projectId = hM[1]; return; }
					if (!onclick && oc) onclick = oc;
				});
			});

			const cells = tds.map(td => trim(td.innerText));
			const row   = { _rowIdx: rowIdx, _dtPage: 0, _onclick: onclick, _projectId: projectId };

			if (headers.length > 0) {
				headers.forEach((h, i) => { if (h) row[h] = cells[i] || ''; });
			} else {
				row['Sr No']              = cells[0] || '';
				row['Project Name']       = cells[1] || '';
				row['Promoter Name']      = cells[2] || '';
				row['Last Modified Date'] = cells[4] || cells[3] || '';
			}
			if (!row['Promoter Name'] && row['Promoter']) row['Promoter Name'] = row['Promoter'];
			if (!row['Project Name']  && row['Name'])     row['Project Name']  = row['Name'];
			result.push(row);
		});
		return result;
	});

	const allRows = [];
	const seenIds = new Set();
	let currentPage = 1;
	let knownMaxPage = maxPage; // may grow as we discover more pages

	while (true) {
		const rows = await extractRows();

		let added = 0;
		for (const row of rows) {
			const key = row._projectId || `${row['Project Name']}||${row['Sr No']}`;
			if (!seenIds.has(key)) { seenIds.add(key); row._dtPage = currentPage - 1; allRows.push(row); added++; }
		}
		console.log(`[TG Projects] Page ${currentPage}: +${added} new → ${allRows.length} total`);

		// Re-discover max page on each load — pagination buttons may show
		// "1 2 3 ... N" and N can grow as we move forward
		const observedMax = await page.evaluate(() => {
			const buttons = [...document.querySelectorAll('[data-pg]')];
			const nums = buttons
				.map(b => parseInt(b.getAttribute('data-pg'), 10))
				.filter(n => !isNaN(n) && n > 0);
			return nums.length ? Math.max(...nums) : 1;
		}).catch(() => knownMaxPage);
		if (observedMax > knownMaxPage) knownMaxPage = observedMax;

		if (currentPage >= knownMaxPage) {
			console.log(`[TG Projects] Reached last page (${knownMaxPage}) — done`);
			break;
		}

		// Submit form to navigate to the next page (matches the site's own click handler)
		const nextPage = currentPage + 1;
		console.log(`[TG Projects] Submitting form for page ${nextPage}/${knownMaxPage}`);

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
			console.warn(`[TG Projects] Navigation to page ${nextPage} failed: ${e.message}`);
			break;
		}

		// Wait for the results table to be present after navigation
		await page.waitForFunction(() => {
			for (const t of document.querySelectorAll('table'))
				if ([...t.querySelectorAll('tbody tr')].some(tr => tr.querySelectorAll('td').length >= 3)) return true;
			return false;
		}, { timeout: 30000 }).catch(() => console.warn(`[TG Projects] Table not found after page ${nextPage} load`));

		currentPage = nextPage;
		if (currentPage > 5000) break; // hard safety cap
	}

	return allRows;
}

// ─────────────────────────────────────────────────────────────────────────────
// Detail extractor — IIFE string, evaluated via page.evaluate(string).
// DO NOT wrap in new Function('return\n...') — ASI silently returns undefined.
//
// RERAIT structure (confirmed):
//   .x_panel > .x_title > h2   ← section name
//   .x_panel > .x_content
//     .row > .form-group
//       .col-md-3 > <label>    ← key
//       .col-md-3              ← plain text value (no <input>)
// ─────────────────────────────────────────────────────────────────────────────

const DETAIL_EXTRACTOR = `(function extractRerait() {
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
// Open detail in new tab (POST stays valid), extract, close tab
// ─────────────────────────────────────────────────────────────────────────────

async function scrapeRowDetail(browser, page, basicRow) {
	const projName  = basicRow['Project Name'] || basicRow['Name'] || '';
	const srNo      = basicRow['Sr No'] || '';
	const projectId = basicRow._projectId || '';
	const onclick   = basicRow._onclick   || '';

	try {
		// Target _blank so POST result opens in new tab
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

		const clicked = await page.evaluate((name, sr, pid, oc) => {
			const trim = s => (s || '').replace(/\s+/g, ' ').trim();
			for (const table of document.querySelectorAll('table')) {
				for (const tr of table.querySelectorAll('tbody tr')) {
					const tds = [...tr.querySelectorAll('td')];
					const rowTxt = trim(tr.innerText);
					const matchName = name && rowTxt.includes(name);
					const matchSr   = sr   && trim(tds[0]?.innerText || '') === sr;
					if (!matchName && !matchSr) continue;
					for (const el of tr.querySelectorAll('a,button,input[type=button]')) {
						const t  = trim(el.innerText || el.value || '').toLowerCase();
						const oc2 = el.getAttribute('onclick') || '';
						if (/view|detail/i.test(t) || oc2) { el.click(); return { ok: true, via: 'button' }; }
					}
				}
			}
			if (pid) {
				for (const fn of ['ViewApplicationDetail','ViewDetail','ViewProject','viewDetail','openDetail']) {
					if (typeof window[fn] === 'function') { window[fn](+pid); return { ok: true, via: fn }; }
				}
				try { if (oc) { eval(oc); return { ok: true, via: 'eval' }; } } catch {}
				const idInput = document.getElementById('ID');
				const form    = document.getElementById('frmSearchList');
				if (idInput && form) { idInput.value = pid; form.submit(); return { ok: true, via: 'form' }; }
			}
			return { ok: false };
		}, projName, srNo, projectId, onclick);

		// Reset target immediately after click
		await page.evaluate(() => { const f = document.getElementById('frmSearchList'); if (f) f.target = ''; }).catch(() => {});

		if (!clicked?.ok) {
			console.warn(`[TG Projects]   ↳ Could not click for "${projName}"`);
			return null;
		}

		const detailPage = await newTabPromise;
		await detailPage.waitForNavigation({ waitUntil: 'networkidle2', timeout: 25000 }).catch(() => {});

		const isDetail = await detailPage.waitForFunction(() => {
			const t = document.body?.innerText || '';
			return t.length > 400 && /General Information|Promoter Information|Project Information|Land Details|Building Details/i.test(t);
		}, { timeout: 15000 }).then(() => true).catch(() => false);

		if (!isDetail) {
			console.warn(`[TG Projects]   ↳ Not a detail page (${detailPage.url()})`);
			await detailPage.close().catch(() => {});
			return null;
		}

		await new Promise(r => setTimeout(r, 300));
		const detail = await detailPage.evaluate(DETAIL_EXTRACTOR).catch(e => {
			console.warn(`[TG Projects]   ↳ evaluate error: ${e.message}`);
			return null;
		});

		const fields = Object.values(detail?.sections || {}).reduce((n, s) => n + Object.keys(s).length, 0);
		console.log(`[TG Projects]   → ${Object.keys(detail?.sections || {}).length} sections, ${fields} fields, ${(detail?.tables || []).length} tables`);

		await detailPage.close().catch(() => {});
		return detail;

	} catch (err) {
		console.warn(`[TG Projects] Detail error "${projName}": ${err.message}`);
		await page.evaluate(() => { const f = document.getElementById('frmSearchList'); if (f) f.target = ''; }).catch(() => {});
		return null;
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Map extracted detail + basic row → DB project shape
// ─────────────────────────────────────────────────────────────────────────────

function mapToProject(detail, basicRow) {
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

	const projectName  = find('project name','name of project')       || rowGet('Project Name','Name');
	const promoterName = find('promoter name','applicant name','builder name') || rowGet('Promoter Name','Promoter');
	const reraRegNo    = find('application no','registration no','rera no','reg no','certificate no')
	                  || rowGet('Registration No','Reg No','Application No');
	const district     = find('district') || '';
	const projectType  = find('project type','type of project','type') || '';
	const status       = find('project status','status','construction status') || '';
	const completion   = find('proposed date of completion','completion date','valid upto','date of completion') || '';
	const location     = find('locality','area','street','address','village','mandal') || district;

	return {
		reraRegNo:          reraRegNo    || `TG-${basicRow._rowIdx ?? Date.now()}`,
		projectName:        projectName  || '(Unknown)',
		name:               projectName  || '(Unknown)',
		promoterName:       promoterName || '',
		district,
		location,
		projectType,
		constructionStatus: status,
		validUntil:         completion,
		rawData: {
			basicRow,
			lastModified: rowGet('Last Modified Date','Last Modified'),
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
			return json({ success: true, message: 'Browser opened. Fill search, submit, then Check Ready.' });
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
			const { projects, total } = await ProjectService.getProjectsByState(STATE, { search, take: 10000 });
			return json({ success: true, data: projects, total, cached: true });
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
		const { projects, total } = await ProjectService.getProjectsByState(STATE, { search, take: 10000 });
		return json({ success: true, data: projects, total, cached: true, scraping: true, progress: prog });
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
			}, { timeout: 60000 }).catch(() => console.warn('[TG Projects] Table wait timed-out'));

			// Phase 1 — collect all rows across all DT pages
			const allRows = await scrapeAllBasicRows(page);
			console.log(`[TG Projects] Phase 1 complete: ${allRows.length} rows`);

			const toProcess = limitP > 0 ? allRows.slice(0, limitP) : allRows;
			setProg({ done: 0, total: toProcess.length, running: true });

			// Phase 2 — detail pages; batch-save every 20 rows
			const BATCH = 20;
			let batchBuf = [];

			const flush = async () => {
				if (batchBuf.length === 0) return;
				const payload = batchBuf.map(({ detail, row }) => mapToProject(detail, row));
				try { await ProjectService.upsertProjects(STATE, payload, { role: 'promoter' }); }
				catch (e) { console.warn('[TG Projects] Batch upsert failed:', e.message); }
				batchBuf = [];
			};

			for (let i = 0; i < toProcess.length; i++) {
				const row = toProcess[i];
				console.log(`[TG Projects] Detail ${i + 1}/${toProcess.length}: "${row['Project Name'] || row._rowIdx}"`);
				const detail = await scrapeRowDetail(browser, page, row);
				batchBuf.push({ detail, row });
				setProg({ done: i + 1, total: toProcess.length, running: true });

				if (batchBuf.length >= BATCH) await flush();
				// Small pause every 10 to avoid hammering
				if ((i + 1) % 10 === 0) await new Promise(r => setTimeout(r, 400));
			}
			await flush();

			setProg({ done: toProcess.length, total: toProcess.length, running: false });
			await ScrapeLogService.completeScrapeLog(log.id, { totalItems: toProcess.length });
			console.log(`[TG Projects] Done — ${toProcess.length} projects processed`);
			await closeSession();

		} catch (err) {
			setProg({ ...getProg(), running: false, error: err.message });
			await ScrapeLogService.completeScrapeLog(log.id, { error: err.message });
			console.error('[TG Projects] Background scrape error:', err.message);
		}
	})();

	// Respond immediately with current DB data + progress
	await new Promise(r => setTimeout(r, 800)); // brief wait for Phase 1 to at least start
	const { projects: db, total } = await ProjectService.getProjectsByState(STATE, { search, take: 10000 }).catch(() => ({ projects: [], total: 0 }));
	return json({
		success: true, data: db, total, scraping: true,
		message: `Scraping started for ${limitP > 0 ? limitP : 'all'} rows. Poll ?action=scrape-status for progress.`
	});
}
