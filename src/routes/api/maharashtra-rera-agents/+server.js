// src/routes/api/maharashtra-rera-agents/+server.js
//
// Maharashtra RERA agent scraper — two-phase:
//
//   Phase 1 (fast)  — axios/cheerio paginates maharera.maharashtra.gov.in/agents-search-result
//                     No CAPTCHA required. Collects: agentId, name, certificateNo.
//
//   Phase 2 (full)  — Puppeteer visits maharerait.maharashtra.gov.in/agent/view/[id]
//                     CAPTCHA appears on first load; solved automatically via Tesseract OCR.
//                     After solving, the JS micro-frontend renders full agent detail.
//                     Subsequent pages in the same browser session usually skip CAPTCHA.
//
// GET ?action=list              → cached DB data
// GET ?action=scrape-list       → Phase 1 only (fast, no Puppeteer)
// GET ?action=scrape-details    → Phase 2 only (Puppeteer + CAPTCHA, slower)
// GET ?action=scrape-all        → Phase 1 then Phase 2
// GET ?detailLimit=N            → cap how many detail pages to fetch per run (default 200)
// GET ?search=X                 → filter cached results

import axios from 'axios';
import * as cheerio from 'cheerio';
import puppeteer from 'puppeteer';
import { createWorker } from 'tesseract.js';
import { json } from '@sveltejs/kit';
import { AgentService, ScrapeLogService } from '$lib/server/services/index.js';

const STATE = 'Maharashtra';
const SOURCE = 'maharashtra-rera-agents';
const LIST_URL  = 'https://maharera.maharashtra.gov.in/agents-search-result';
const DETAIL_BASE = 'https://maharerait.maharashtra.gov.in';

const HTTP_HEADERS = {
	'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
	'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
	'Accept-Language': 'en-US,en;q=0.9',
	'Referer': 'https://maharera.maharashtra.gov.in/'
};

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 1 — List scraping (axios/cheerio)
// ─────────────────────────────────────────────────────────────────────────────

async function fetchListPage(pageNum) {
	const url = `${LIST_URL}?page=${pageNum}`;
	const res = await axios.get(url, { timeout: 30000, headers: HTTP_HEADERS, validateStatus: s => s < 600 });
	if (!res.data || typeof res.data !== 'string') throw new Error(`HTTP ${res.status}`);

	const $ = cheerio.load(res.data);
	const agents = [];

	// Debug: log a snippet around any "page" text to understand the site's pagination format
	if (pageNum === 0) {
		const snippet = (res.data.match(/.{0,60}(page|pager|Pages|next).{0,60}/gi) || []).slice(0, 3).join(' | ');
		console.log(`[MH Agents] Pagination debug (page 0 snippet): ${snippet || '(none found)'}`);
	}

	// Find agents table — rows contain certificate numbers (A5xxxx)
	let tableEl = null;
	$('table').each((_, t) => {
		if (/A\d{10,}/.test($(t).text()) || /Certificate/i.test($(t).find('thead, tr:first-child').text())) {
			tableEl = t; return false;
		}
	});
	if (!tableEl) $('table').each((_, t) => { if ($(t).find('tbody tr').length > 0) { tableEl = t; return false; } });

	if (tableEl) {
		$(tableEl).find('tbody tr').each((_, tr) => {
			const tds = $(tr).find('td');
			if (tds.length < 3) return;
			const cells = tds.map((_, td) => $(td).text().trim()).get();
			const name   = cells[1] || '';
			const certNo = cells[2] || '';
			if (!name || /agent\s*name/i.test(name)) return;

			// Extract agent ID from "View Details" link href
			const viewHref = tds.map((_, td) => $(td).find('a[href*="/agent/view/"]').attr('href') || '').get().find(Boolean) || '';
			const idMatch  = viewHref.match(/\/agent\/view\/(\d+)/);
			const agentId  = idMatch ? idMatch[1] : '';

			agents.push({ agentId, name, certNo });
		});
	}

	return { agents };
}

async function scrapeAllListPages(maxPages = 0) {
	const { agents: first } = await fetchListPage(0);
	const all = [...first];
	if (first.length === 0) {
		console.log('[MH Agents] Page 1 returned 0 agents — check URL or site structure.');
		return all;
	}
	console.log(`[MH Agents] Page 1: ${first.length} agents`);

	// Paginate until the site returns an empty page (don't rely on total-page detection)
	let p = 1;
	while (maxPages === 0 || p < maxPages) {
		try {
			const { agents } = await fetchListPage(p);
			if (agents.length === 0) {
				console.log(`[MH Agents] Page ${p + 1} (url: ?page=${p}) empty — pagination complete.`);
				break;
			}
			all.push(...agents);
			console.log(`[MH Agents] Page ${p + 1} (url: ?page=${p}): +${agents.length} → ${all.length} total`);
			p++;
			if (p % 10 === 0) await new Promise(r => setTimeout(r, 800));
		} catch (e) {
			console.warn(`[MH Agents] Page ${p + 1} failed: ${e.message}`);
			p++; // skip and continue
		}
	}
	console.log(`[MH Agents] Phase 1 complete: ${all.length} agents`);
	return all;
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2 — Detail scraping (Puppeteer + CAPTCHA)
// ─────────────────────────────────────────────────────────────────────────────

// Selectors tried in order for CAPTCHA image and input
const CAPTCHA_IMG_SELS  = ['#CaptchaImage', 'img[id*="aptcha" i]', 'img[src*="captcha" i]', 'img[alt*="captcha" i]', '.captcha img', 'canvas[id*="aptcha" i]'];
const CAPTCHA_INPUT_SELS = ['#CaptchaInputText', 'input[id*="aptcha" i]', 'input[name*="captcha" i]', 'input[placeholder*="aptcha" i]'];
const CAPTCHA_BTN_SELS  = ['button[type="submit"]', 'input[type="submit"]', '#btnSubmit', '.btn-primary', 'button:contains("Submit")', 'button:contains("Verify")'];

async function firstSelector(page, sels, opts = {}) {
	for (const sel of sels) {
		try {
			const el = await page.$(sel);
			if (el) return el;
		} catch {}
	}
	return null;
}

async function solveCaptcha(page, label = 'MH Agents') {
	// Wait for CAPTCHA image
	let captchaEl = null;
	for (const sel of CAPTCHA_IMG_SELS) {
		try {
			captchaEl = await page.waitForSelector(sel, { visible: true, timeout: 5000 });
			if (captchaEl) break;
		} catch {}
	}
	if (!captchaEl) return false; // No CAPTCHA on this page

	// Preprocess in-browser: binarize + scale 4× then return base64
	const captchaBase64 = await page.evaluate((sels) => {
		let img = null;
		for (const sel of sels) { img = document.querySelector(sel); if (img) break; }
		if (!img) return null;

		const waitLoad = () => new Promise(res => {
			if (img.complete && img.naturalWidth > 0) return res();
			img.onload = res; img.onerror = res;
			setTimeout(res, 3000);
		});

		return waitLoad().then(() => {
			if (!img.naturalWidth) return null;
			const SCALE = 4;
			const src = document.createElement('canvas');
			src.width = img.naturalWidth; src.height = img.naturalHeight;
			src.getContext('2d').drawImage(img, 0, 0);

			// Binarize
			const ctx = src.getContext('2d');
			const id = ctx.getImageData(0, 0, src.width, src.height);
			for (let i = 0; i < id.data.length; i += 4) {
				const v = (id.data[i] * 0.299 + id.data[i+1] * 0.587 + id.data[i+2] * 0.114) < 140 ? 0 : 255;
				id.data[i] = id.data[i+1] = id.data[i+2] = v; id.data[i+3] = 255;
			}
			ctx.putImageData(id, 0, 0);

			const out = document.createElement('canvas');
			out.width = src.width * SCALE; out.height = src.height * SCALE;
			const ctx2 = out.getContext('2d');
			ctx2.imageSmoothingEnabled = false;
			ctx2.drawImage(src, 0, 0, out.width, out.height);
			return out.toDataURL('image/png').split(',')[1];
		});
	}, CAPTCHA_IMG_SELS);

	// Fallback: Puppeteer screenshot of element
	const imgBuffer = captchaBase64
		? Buffer.from(captchaBase64, 'base64')
		: await captchaEl.screenshot().catch(() => null);

	if (!imgBuffer) return false;

	let captchaText = '';
	try {
		const worker = await createWorker('eng');
		await worker.setParameters({
			tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
			tessedit_pageseg_mode: '8'
		});
		const { data: { text } } = await worker.recognize(imgBuffer);
		await worker.terminate();
		captchaText = text.trim().replace(/\s+/g, '').substring(0, 10);
	} catch (e) {
		console.warn(`[${label}] Tesseract failed:`, e.message);
		return false;
	}

	if (captchaText.length < 4) {
		console.warn(`[${label}] CAPTCHA OCR result too short: "${captchaText}"`);
		return false;
	}
	console.log(`[${label}] CAPTCHA OCR: "${captchaText}"`);

	// Type into CAPTCHA input
	let typed = false;
	for (const sel of CAPTCHA_INPUT_SELS) {
		try {
			const el = await page.$(sel);
			if (el) { await el.click({ clickCount: 3 }); await el.type(captchaText); typed = true; break; }
		} catch {}
	}
	if (!typed) return false;

	// Click submit
	const submitted = await page.evaluate((btns) => {
		for (const sel of btns) {
			const el = document.querySelector(sel);
			if (el) { el.click(); return true; }
		}
		// Fallback: submit the form
		const form = document.querySelector('form');
		if (form) { form.submit(); return true; }
		return false;
	}, CAPTCHA_BTN_SELS);

	if (!submitted) return false;

	// Wait for navigation / DOM update
	await Promise.race([
		page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }),
		new Promise(r => setTimeout(r, 8000))
	]).catch(() => {});

	await new Promise(r => setTimeout(r, 1500));
	return true;
}

async function waitForContent(page) {
	// Wait until enough text is visible (JS app has rendered)
	await page.waitForFunction(() => {
		const text = document.body?.innerText?.replace(/\s+/g, ' ')?.trim() || '';
		// Look for recognizable agent-detail text
		return text.length > 300 && (
			/certificate|registration|mobile|address|agent|applicant/i.test(text)
		);
	}, { timeout: 20000 }).catch(() => {});
	await new Promise(r => setTimeout(r, 1000));
}

async function extractAgentDetail(page) {
	return page.evaluate(() => {
		const clean = s => (s || '').replace(/[:\*]/g, '').replace(/\s+/g, ' ').trim();
		const data = {};

		// 2-column and 4-column table rows
		document.querySelectorAll('table tr').forEach(tr => {
			const cells = [...tr.querySelectorAll('td, th')];
			if (cells.length === 2) {
				const k = clean(cells[0].innerText); const v = clean(cells[1].innerText);
				if (k && v && k !== v) data[k] = v;
			} else if (cells.length === 4) {
				[[0,1],[2,3]].forEach(([ki,vi]) => {
					const k = clean(cells[ki].innerText); const v = clean(cells[vi].innerText);
					if (k && v && k !== v) data[k] = v;
				});
			}
		});

		// Definition lists
		document.querySelectorAll('dl').forEach(dl => {
			[...dl.querySelectorAll('dt')].forEach((dt, i) => {
				const dd = dl.querySelectorAll('dd')[i];
				if (dd) { const k = clean(dt.innerText); const v = clean(dd.innerText); if (k && v) data[k] = v; }
			});
		});

		// React/Angular label-value patterns
		const labelSelectors = [
			'[class*="label"]', '[class*="Label"]',
			'[class*="field-name"]', '[class*="key"]',
			'strong', 'b'
		];
		labelSelectors.forEach(sel => {
			document.querySelectorAll(sel).forEach(el => {
				const k = clean(el.innerText);
				if (!k || k.length > 60) return;
				const next = el.nextElementSibling || el.parentElement?.nextElementSibling;
				if (next && !data[k]) {
					const v = clean(next.innerText);
					if (v && v !== k) data[k] = v;
				}
			});
		});

		return data;
	});
}

function mapDetailToAgent(rawFields, basicInfo) {
	const find = (...keys) => {
		for (const k of keys) {
			const kl = k.toLowerCase();
			const match = Object.entries(rawFields).find(([fk]) => fk.toLowerCase().includes(kl));
			if (match?.[1]) return match[1];
		}
		return undefined;
	};

	const buildAddress = (...keys) => {
		const parts = [];
		for (const k of keys) {
			const kl = k.toLowerCase();
			const match = Object.entries(rawFields).find(([fk]) => fk.toLowerCase().includes(kl));
			if (match?.[1]) parts.push(match[1]);
		}
		return parts.filter(Boolean).join(', ') || undefined;
	};

	return {
		registrationNo:   find('certificate', 'cert no', 'registration no', 'reg. no') || basicInfo.certNo,
		name:             find('name', 'applicant', 'agent name') || basicInfo.name,
		firmType:         find('type', 'category', 'applicant type', 'firm type'),
		email:            find('email', 'e-mail', 'mail id'),
		mobile:           find('mobile', 'phone', 'contact no', 'cell'),
		fatherName:       find("father", "husband"),
		address:          buildAddress('address', 'residence', 'permanent'),
		businessAddress:  buildAddress('business', 'office', 'place of business'),
		registrationDate: find('registration date', 'issue date', 'reg date'),
		validUpto:        find('valid', 'expiry', 'validity'),
		district:         find('district'),
		area:             find('area', 'locality', 'sector', 'ward', 'village'),
		pinCode:          find('pincode', 'pin code', 'postal code', 'pin no'),
		status:           find('status') || 'Approved',
		rawData:          { agentId: basicInfo.agentId, detailUrl: `${DETAIL_BASE}/agent/view/${basicInfo.agentId}`, ...rawFields }
	};
}

async function scrapeDetailPages(agentBasics, detailLimit = 0) {
	const toScrape = detailLimit > 0 ? agentBasics.slice(0, detailLimit) : agentBasics;
	if (toScrape.length === 0) return [];

	console.log(`[MH Agents] Detail phase: scraping ${toScrape.length} agents with Puppeteer`);

	const browser = await puppeteer.launch({
		headless: true,
		args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security', '--disable-features=IsolateOrigins,site-per-process']
	});

	const page = await browser.newPage();
	await page.setViewport({ width: 1280, height: 900 });
	await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36');

	const detailed = [];
	let captchaSolvedOnce = false;

	for (let i = 0; i < toScrape.length; i++) {
		const basic = toScrape[i];
		if (!basic.agentId) {
			// No ID, use listing data only
			detailed.push({
				registrationNo:   basic.certNo,
				name:             basic.name,
				district:         '',
				firmType:         '',
				email:            '',
				mobile:           '',
				address:          '',
				registrationDate: '',
				validUpto:        '',
				status:           'Approved',
				rawData:          { agentId: '', detailUrl: '' }
			});
			continue;
		}

		try {
			const detailUrl = `${DETAIL_BASE}/agent/view/${basic.agentId}`;
			await page.goto(detailUrl, { waitUntil: 'networkidle2', timeout: 30000 });

			// Solve CAPTCHA if present (first page or if it reappears)
			const hadCaptcha = await solveCaptcha(page, 'MH Agents');
			if (hadCaptcha) captchaSolvedOnce = true;

			// Wait for JS app to render agent detail content
			await waitForContent(page);

			const rawFields = await extractAgentDetail(page);
			const agent     = mapDetailToAgent(rawFields, basic);
			detailed.push(agent);
			console.log(`[MH Agents] Detail ${i + 1}/${toScrape.length}: ${agent.name || basic.name} ✓`);

			// Polite delay between pages (shorter if session already established)
			await new Promise(r => setTimeout(r, captchaSolvedOnce ? 400 : 800));

		} catch (err) {
			console.warn(`[MH Agents] Detail failed for agent ${basic.agentId}:`, err.message);
			// Still add basic info
			detailed.push({
				registrationNo: basic.certNo, name: basic.name,
				district: '', firmType: '', email: '', mobile: '', address: '',
				registrationDate: '', validUpto: '', status: 'Approved',
				rawData: { agentId: basic.agentId }
			});
		}
	}

	try { await browser.close(); } catch {}
	return detailed;
}

// ─────────────────────────────────────────────────────────────────────────────
// Route handler
// ─────────────────────────────────────────────────────────────────────────────
export async function GET({ url }) {
	const action      = url.searchParams.get('action') || 'list';
	const search      = url.searchParams.get('search') || '';
	const maxPages    = parseInt(url.searchParams.get('maxPages') || '0', 10);
	const detailLimit = parseInt(url.searchParams.get('detailLimit') || '0', 10); // 0 = all

	// ── Cached ──
	if (action === 'list') {
		try {
			const { agents, total } = await AgentService.getAgentsByState(STATE, { search });
			if (agents.length > 0) return json({ success: true, data: agents, total, cached: true });
		} catch {}
		return json({ success: true, data: [], total: 0, cached: true, empty: true });
	}

	// ── Scrape lock check ──
	if (await ScrapeLogService.isRunning(SOURCE, STATE)) {
		const { agents, total } = await AgentService.getAgentsByState(STATE, { search });
		return json({ success: true, data: agents, total, cached: true, scraping: true });
	}

	const log = await ScrapeLogService.startScrapeLog(SOURCE, STATE);

	try {
		// Phase 1 — list
		let agentBasics = [];
		if (action === 'scrape-list' || action === 'scrape-all') {
			agentBasics = await scrapeAllListPages(maxPages);
			console.log(`[MH Agents] Phase 1 done: ${agentBasics.length} agents found`);

			// Quick upsert of basic data so results are visible immediately
			if (agentBasics.length > 0) {
				const basicPayload = agentBasics.map(a => ({
					registrationNo: a.certNo, name: a.name,
					district: '', firmType: '', email: '', mobile: '', address: '',
					registrationDate: '', validUpto: '', status: 'Approved',
					rawData: { agentId: a.agentId, detailUrl: `${DETAIL_BASE}/agent/view/${a.agentId}` }
				}));
				await AgentService.upsertAgents(STATE, basicPayload).catch(e => console.warn('[MH Agents] Basic upsert:', e.message));
			}

			if (action === 'scrape-list') {
				await ScrapeLogService.completeScrapeLog(log.id, { totalItems: agentBasics.length });
				const { agents, total } = await AgentService.getAgentsByState(STATE, { search });
				return json({ success: true, data: agents, total, scraped: agentBasics.length, phase: 'list-only' });
			}
		}

		// Phase 2 — details (Puppeteer + CAPTCHA) — runs in background, saves in batches
		if (action === 'scrape-details' || action === 'scrape-all') {
			if (action === 'scrape-details' && agentBasics.length === 0) {
				const { agents: dbAgents } = await AgentService.getAgentsByState(STATE, {});
				agentBasics = dbAgents.map(a => ({
					agentId: a.rawData?.agentId || '',
					name:    a.name,
					certNo:  a.registrationNo
				}));
			}

			const BATCH = 50;
			const toDetail = detailLimit > 0 ? agentBasics.slice(0, detailLimit) : agentBasics;
			console.log(`[MH Agents] Phase 2 background starting: ${toDetail.length} agents`);
			;(async () => {
				try {
					let done = 0;
					for (let i = 0; i < toDetail.length; i += BATCH) {
						const chunk = toDetail.slice(i, i + BATCH);
						const detailed = await scrapeDetailPages(chunk, 0);
						if (detailed.length > 0) {
							await AgentService.upsertAgents(STATE, detailed).catch(e => console.warn('[MH Agents] Batch upsert:', e.message));
						}
						done += chunk.length;
						console.log(`[MH Agents] Phase 2 progress: ${done}/${toDetail.length} agents detailed`);
					}
					console.log(`[MH Agents] Phase 2 complete: ${done} agents processed.`);
				} catch (e) {
					console.error('[MH Agents] Phase 2 background error:', e.message);
				}
			})();

			await ScrapeLogService.completeScrapeLog(log.id, { totalItems: agentBasics.length });
			const { agents, total } = await AgentService.getAgentsByState(STATE, { search });
			return json({
				success: true, data: agents, total,
				scraped: agentBasics.length, phase: 'details-background',
				message: `Phase 2 (CAPTCHA detail) started for ${toDetail.length} agents — refresh to see updates.`
			});
		}

		await ScrapeLogService.completeScrapeLog(log.id, { totalItems: 0 });
		return json({ success: false, error: 'Unknown action. Use scrape-list, scrape-details, or scrape-all.' }, { status: 400 });

	} catch (error) {
		await ScrapeLogService.completeScrapeLog(log.id, { error: error.message });
		console.error('[MH Agents] Scrape failed:', error.message);
		try {
			const { agents, total } = await AgentService.getAgentsByState(STATE, { search });
			if (agents.length > 0) return json({ success: true, data: agents, total, cached: true, scrapeError: error.message });
		} catch {}
		return json({ success: false, error: error.message }, { status: 500 });
	}
}
