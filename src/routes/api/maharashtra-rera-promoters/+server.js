// src/routes/api/maharashtra-rera-promoters/+server.js
//
// Maharashtra RERA promoter scraper — two-phase:
//
//   Phase 1 (fast)  — axios/cheerio paginates maharera.maharashtra.gov.in/projects-search-result
//                     Extracts promoter names from project cards. No CAPTCHA.
//
//   Phase 2 (full)  — Puppeteer visits each project detail page on maharerait.maharashtra.gov.in
//                     Solves CAPTCHA with Tesseract. Extracts full promoter info from the detail.
//
// GET ?action=districts                    → list MH districts
// GET (no params)                          → cached DB data
// GET ?refresh=true[&district=X]          → Phase 1 only (fast)
// GET ?action=scrape-details&refresh=true → Phase 2: Puppeteer detail for promoters in DB
// GET ?action=scrape-all&refresh=true     → Phase 1 + Phase 2
// GET ?detailLimit=N                      → cap detail pages per run (default 200)

import axios from 'axios';
import * as cheerio from 'cheerio';
import puppeteer from 'puppeteer';
import { createWorker } from 'tesseract.js';
import { json } from '@sveltejs/kit';
import { CompanyService, ScrapeLogService } from '$lib/server/services/index.js';

const STATE       = 'Maharashtra';
const SOURCE      = 'maharashtra-rera-promoters';
const LIST_URL    = 'https://maharera.maharashtra.gov.in/projects-search-result';
const DETAIL_BASE = 'https://maharerait.maharashtra.gov.in';

const MH_DISTRICTS = [
	'Ahmednagar','Akola','Amravati','Aurangabad','Beed','Bhandara','Buldhana','Chandrapur',
	'Dhule','Gadchiroli','Gondia','Hingoli','Jalgaon','Jalna','Kolhapur','Latur',
	'Mumbai City','Mumbai Suburban','Nagpur','Nanded','Nandurbar','Nashik','Osmanabad',
	'Palghar','Parbhani','Pune','Raigad','Ratnagiri','Sangli','Satara',
	'Sindhudurg','Solapur','Thane','Wardha','Washim','Yavatmal'
];

const HTTP_HEADERS = {
	'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
	'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
	'Accept-Language': 'en-US,en;q=0.9',
	'Referer': 'https://maharera.maharashtra.gov.in/'
};

const CAPTCHA_IMG_SELS   = ['#CaptchaImage','img[id*="aptcha" i]','img[src*="captcha" i]','img[alt*="captcha" i]','.captcha img'];
const CAPTCHA_INPUT_SELS = ['#CaptchaInputText','input[id*="aptcha" i]','input[name*="captcha" i]','input[placeholder*="aptcha" i]'];
const CAPTCHA_BTN_SELS   = ['button[type="submit"]','input[type="submit"]','#btnSubmit','.btn-primary'];

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 1 — Listing scrape
// ─────────────────────────────────────────────────────────────────────────────

async function fetchProjectListPage(pageNum, district = '') {
	let url = `${LIST_URL}?project_state=27&page=${pageNum}`;
	if (district) url += `&project_district=${encodeURIComponent(district)}`;

	const res = await axios.get(url, { timeout: 30000, headers: HTTP_HEADERS, validateStatus: s => s < 600 });
	if (!res.data || typeof res.data !== 'string') throw new Error(`HTTP ${res.status}`);

	const $ = cheerio.load(res.data);
	const projects = [];

	// Debug: log pagination snippet on page 0
	if (pageNum === 0) {
		const snippet = (res.data.match(/.{0,60}(page|pager|Pages|next).{0,60}/gi) || []).slice(0, 3).join(' | ');
		console.log(`[MH Promoters] Pagination debug (page 0 snippet): ${snippet || '(none found)'}`);
	}

	const seen = new Set();
	$('a[href*="/public/project/view/"]').not('[href*="isOriginal"]').each((_, link) => {
		const href    = $(link).attr('href') || '';
		const idMatch = href.match(/\/public\/project\/view\/(\d+)/);
		const pid     = idMatch ? idMatch[1] : '';
		if (!pid || seen.has(pid)) return;
		seen.add(pid);

		let container = $(link).parent();
		for (let d = 0; d < 12; d++) {
			if (container.find('h4').length > 0 || container.is('body')) break;
			container = container.parent();
		}

		const projectName = container.find('h4').first().text().replace(/\*+/g, '').trim();

		const SKIP = /^(State|MAHARASHTRA|Pincode|District|Certificate|Extension|Last Modified|N\/A|#\s*P\d+)/i;
		let promoterName = '';
		container.find('p, span').each((_, el) => {
			if (promoterName) return;
			const t = $(el).text().trim();
			if (t && t.length > 2 && !SKIP.test(t) && !/#\s*P\d+/.test(t) && t !== projectName) promoterName = t;
		});

		const location = container.find('li a[href*="google.com/maps/search"]').first().text().trim()
			|| container.find('li').first().text().trim();

		let districtVal = district, pincode = '';
		const paras = container.find('p').toArray();
		for (let i = 0; i < paras.length - 1; i++) {
			const label = $(paras[i]).text().trim();
			const value = $(paras[i + 1]).text().trim();
			if (/^District$/i.test(label)) districtVal = value;
			else if (/^Pincode$/i.test(label)) pincode = value;
		}

		const detailUrl = href.startsWith('http') ? href : `${DETAIL_BASE}${href}`;
		projects.push({ projectId: pid, projectName, promoterName, location, district: districtVal, pincode, detailUrl });
	});

	// Fallback: table rows
	if (projects.length === 0) {
		$('table tbody tr').each((_, tr) => {
			const tds = $(tr).find('td');
			if (tds.length < 3) return;
			const cells = tds.map((_, td) => $(td).text().trim()).get();
			const href  = $(tds.last()).find('a').attr('href') || '';
			const im    = href.match(/\/project\/view\/(\d+)/);
			const pid   = im ? im[1] : '';
			projects.push({ projectId: pid, projectName: cells[1]||cells[0]||'', promoterName: cells[2]||'', location: cells[3]||'', district: district||cells[4]||'', pincode: '', detailUrl: href });
		});
	}

	return { projects };
}

async function scrapeAllListPages(district = '', maxPages = 0) {
	const { projects: first } = await fetchProjectListPage(0, district);
	const all = [...first];
	if (first.length === 0) {
		console.log(`[MH Promoters] Page 1 returned 0 rows${district ? ` (${district})` : ''} — check URL or site structure.`);
		return all;
	}
	console.log(`[MH Promoters] Page 1: ${first.length} project rows`);

	// Paginate until the site returns an empty page (don't rely on total-page detection)
	let p = 1, consecutiveFails = 0;
	const MAX_CONSECUTIVE_FAILS = 5;
	while (maxPages === 0 || p < maxPages) {
		try {
			const { projects } = await fetchProjectListPage(p, district);
			consecutiveFails = 0; // reset on success
			if (projects.length === 0) {
				console.log(`[MH Promoters] Page ${p + 1} empty — pagination complete.`);
				break;
			}
			all.push(...projects);
			console.log(`[MH Promoters] Page ${p + 1}: +${projects.length} → ${all.length} total`);
			p++;
			if (p % 10 === 0) await new Promise(r => setTimeout(r, 800));
		} catch (e) {
			consecutiveFails++;
			console.warn(`[MH Promoters] Page ${p + 1} failed (${consecutiveFails}/${MAX_CONSECUTIVE_FAILS}): ${e.message}`);
			if (consecutiveFails >= MAX_CONSECUTIVE_FAILS) {
				console.warn(`[MH Promoters] ${MAX_CONSECUTIVE_FAILS} consecutive failures — stopping pagination.`);
				break;
			}
			p++;
			await new Promise(r => setTimeout(r, 1000 * consecutiveFails)); // back-off
		}
	}
	console.log(`[MH Promoters] Phase 1 complete: ${all.length} project rows`);
	return all;
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2 — Puppeteer detail scraping
// ─────────────────────────────────────────────────────────────────────────────

async function solveCaptcha(page, label = 'MH Promoters') {
	let captchaEl = null;
	for (const sel of CAPTCHA_IMG_SELS) {
		try { captchaEl = await page.waitForSelector(sel, { visible: true, timeout: 5000 }); if (captchaEl) break; } catch {}
	}
	if (!captchaEl) return false;

	const captchaBase64 = await page.evaluate((sels) => {
		let img = null;
		for (const s of sels) { img = document.querySelector(s); if (img) break; }
		if (!img) return null;
		return new Promise(res => {
			const run = () => {
				if (!img.naturalWidth) return res(null);
				const SCALE = 4;
				const src = document.createElement('canvas');
				src.width = img.naturalWidth; src.height = img.naturalHeight;
				src.getContext('2d').drawImage(img, 0, 0);
				const ctx = src.getContext('2d');
				const id = ctx.getImageData(0, 0, src.width, src.height);
				for (let i = 0; i < id.data.length; i += 4) {
					const v = (id.data[i]*0.299 + id.data[i+1]*0.587 + id.data[i+2]*0.114) < 140 ? 0 : 255;
					id.data[i] = id.data[i+1] = id.data[i+2] = v; id.data[i+3] = 255;
				}
				ctx.putImageData(id, 0, 0);
				const out = document.createElement('canvas');
				out.width = src.width * SCALE; out.height = src.height * SCALE;
				const ctx2 = out.getContext('2d');
				ctx2.imageSmoothingEnabled = false;
				ctx2.drawImage(src, 0, 0, out.width, out.height);
				res(out.toDataURL('image/png').split(',')[1]);
			};
			if (img.complete && img.naturalWidth > 0) run();
			else { img.onload = run; img.onerror = () => res(null); setTimeout(() => res(null), 5000); }
		});
	}, CAPTCHA_IMG_SELS);

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
	} catch (e) { console.warn(`[${label}] Tesseract:`, e.message); return false; }

	if (captchaText.length < 4) return false;
	console.log(`[${label}] CAPTCHA OCR: "${captchaText}"`);

	let typed = false;
	for (const sel of CAPTCHA_INPUT_SELS) {
		try {
			const el = await page.$(sel);
			if (el) { await el.click({ clickCount: 3 }); await el.type(captchaText); typed = true; break; }
		} catch {}
	}
	if (!typed) return false;

	await page.evaluate((btns) => {
		for (const s of btns) { const el = document.querySelector(s); if (el) { el.click(); return; } }
		document.querySelector('form')?.submit();
	}, CAPTCHA_BTN_SELS);

	await Promise.race([
		page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }),
		new Promise(r => setTimeout(r, 8000))
	]).catch(() => {});
	await new Promise(r => setTimeout(r, 1500));
	return true;
}

async function waitForContent(page) {
	await page.waitForFunction(() => {
		const t = document.body?.innerText?.replace(/\s+/g, ' ').trim() || '';
		return t.length > 300 && /promoter|project|address|mobile|email|district|registration/i.test(t);
	}, { timeout: 20000 }).catch(() => {});
	await new Promise(r => setTimeout(r, 1000));
}

async function extractPromoterFromProjectDetail(page) {
	return page.evaluate(() => {
		const clean = s => (s || '').replace(/[:\*]/g, '').replace(/\s+/g, ' ').trim();
		const data = {};

		// Table key-value extraction
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

		// DL/DT/DD
		document.querySelectorAll('dl dt').forEach((dt, i) => {
			const dd = dt.closest('dl')?.querySelectorAll('dd')[i];
			if (dd) { const k = clean(dt.innerText); const v = clean(dd.innerText); if (k && v) data[k] = v; }
		});

		// Label patterns
		['[class*="label"]','[class*="Label"]','strong','b'].forEach(sel => {
			document.querySelectorAll(sel).forEach(el => {
				const k = clean(el.innerText);
				if (!k || k.length > 60) return;
				const next = el.nextElementSibling || el.parentElement?.nextElementSibling;
				if (next && !data[k]) { const v = clean(next.innerText); if (v && v !== k) data[k] = v; }
			});
		});

		return data;
	});
}

function mapDetailToPromoter(rawFields, basic) {
	const find = (...keys) => {
		for (const k of keys) {
			const kl = k.toLowerCase();
			const m = Object.entries(rawFields).find(([fk]) => fk.toLowerCase().includes(kl));
			if (m?.[1]) return m[1];
		}
	};
	return {
		promoterName:  find('promoter name', 'name of promoter', 'applicant name', 'developer', 'builder') || basic.promoterName,
		applicantType: find('type', 'applicant type', 'promoter type', 'category') || 'Promoter',
		district:      find('district') || basic.district,
		address:       find('address', 'permanent address', 'office address'),
		mobile:        find('mobile', 'phone', 'contact no', 'cell'),
		email:         find('email', 'e-mail', 'mail id'),
		pan:           find('pan'),
		gstin:         find('gst', 'gstin'),
		projectName:   find('project name', 'name of project') || basic.projectName,
		projectRegNo:  find('registration no', 'rera no', 'reg. no') || (basic.projectId ? `P${basic.projectId}` : ''),
		projectDistrict: find('district') || basic.district,
		rawData:       { projectId: basic.projectId, detailUrl: basic.detailUrl, fullDetail: rawFields }
	};
}

async function scrapePromoterDetails(projectBasics, detailLimit = 0) {
	const filtered = projectBasics.filter(p => p.projectId && p.promoterName);
	const toScrape = detailLimit > 0 ? filtered.slice(0, detailLimit) : filtered;
	if (toScrape.length === 0) return [];
	console.log(`[MH Promoters] Detail phase: ${toScrape.length} project pages via Puppeteer`);

	const browser = await puppeteer.launch({
		headless: true,
		args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security']
	});
	const page = await browser.newPage();
	await page.setViewport({ width: 1280, height: 900 });
	await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36');

	const promotersDetailed = [];
	let captchaSolvedOnce = false;

	for (let i = 0; i < toScrape.length; i++) {
		const basic = toScrape[i];
		try {
			const detailUrl = basic.detailUrl || `${DETAIL_BASE}/public/project/view/${basic.projectId}`;
			await page.goto(detailUrl, { waitUntil: 'networkidle2', timeout: 30000 });

			const hadCaptcha = await solveCaptcha(page, 'MH Promoters');
			if (hadCaptcha) captchaSolvedOnce = true;

			await waitForContent(page);
			const rawFields = await extractPromoterFromProjectDetail(page);
			promotersDetailed.push(mapDetailToPromoter(rawFields, basic));
			console.log(`[MH Promoters] Detail ${i + 1}/${toScrape.length}: ${basic.promoterName || basic.projectId} ✓`);
			await new Promise(r => setTimeout(r, captchaSolvedOnce ? 400 : 800));
		} catch (err) {
			console.warn(`[MH Promoters] Detail failed for project ${basic.projectId}:`, err.message);
			promotersDetailed.push(mapDetailToPromoter({}, basic));
		}
	}

	try { await browser.close(); } catch {}
	return promotersDetailed;
}

// ─────────────────────────────────────────────────────────────────────────────
// Route handler
// ─────────────────────────────────────────────────────────────────────────────
export async function GET({ url }) {
	const action      = url.searchParams.get('action') || '';
	const refresh     = url.searchParams.get('refresh') === 'true';
	const search      = url.searchParams.get('search') || '';
	const district    = url.searchParams.get('district') || '';
	const maxPages    = parseInt(url.searchParams.get('maxPages') || '0', 10);
	const detailLimit = parseInt(url.searchParams.get('detailLimit') || '0', 10); // 0 = all

	if (action === 'districts') {
		return json({ success: true, data: MH_DISTRICTS.map(d => ({ name: d, code: d })).sort((a, b) => a.name.localeCompare(b.name)) });
	}

	// Cached read
	if (!refresh && action !== 'scrape-details' && action !== 'scrape-all') {
		try {
			const { companies, total } = await CompanyService.getCompaniesByState(STATE, { search, role: 'promoter', take: 5000 });
			if (companies.length > 0) return json({ success: true, data: companies, total, cached: true });
		} catch {}
		return json({ success: true, data: [], total: 0, cached: true, empty: true });
	}

	if (await ScrapeLogService.isRunning(SOURCE, STATE)) {
		const { companies, total } = await CompanyService.getCompaniesByState(STATE, { search, role: 'promoter', take: 5000 });
		return json({ success: true, data: companies, total, cached: true, scraping: true });
	}

	const log = await ScrapeLogService.startScrapeLog(SOURCE, STATE);

	// ── Helper: fire Phase 2 in background (batched, saves to DB every 50 records) ──
	const startPhase2Background = (projectBatch) => {
		const BATCH = 50;
		const toDetail = detailLimit > 0 ? projectBatch.slice(0, detailLimit) : projectBatch;
		console.log(`[MH Promoters] Phase 2 background starting: ${toDetail.length} project pages`);
		;(async () => {
			try {
				let done = 0;
				for (let i = 0; i < toDetail.length; i += BATCH) {
					const chunk = toDetail.slice(i, i + BATCH);
					const detailed = await scrapePromoterDetails(chunk, 0);
					if (detailed.length > 0) {
						const payload = detailed.map(p => ({
							promoterName: p.promoterName, applicantType: p.applicantType,
							district: p.district, address: p.address, mobile: p.mobile,
							email: p.email, pan: p.pan, gstin: p.gstin,
							projectName: p.projectName, projectRegNo: p.projectRegNo, projectDistrict: p.projectDistrict
						}));
						await CompanyService.upsertCompanies(STATE, payload, { role: 'promoter' }).catch(e => console.warn('[MH Promoters] Batch upsert:', e.message));
					}
					done += chunk.length;
					console.log(`[MH Promoters] Phase 2 progress: ${done}/${toDetail.length} project pages detailed`);
				}
				console.log(`[MH Promoters] Phase 2 complete: ${done} projects processed.`);
			} catch (e) {
				console.error('[MH Promoters] Phase 2 background error:', e.message);
			}
		})();
	};

	try {
		let projectBasics = [];

		// Phase 1 — list scrape
		if (!action || action === 'scrape-all' || refresh) {
			projectBasics = await scrapeAllListPages(district, maxPages);
			console.log(`[MH Promoters] Phase 1: ${projectBasics.length} project rows`);

			// Deduplicate and quick-persist promoters
			const promoterMap = new Map();
			for (const proj of projectBasics) {
				if (!proj.promoterName) continue;
				const key = proj.promoterName.toLowerCase().trim();
				if (!promoterMap.has(key)) promoterMap.set(key, { ...proj, projects: [] });
				promoterMap.get(key).projects.push({ projectName: proj.projectName, registrationNo: proj.projectId ? `P${proj.projectId}` : '', district: proj.district, projectID: proj.projectId });
			}
			console.log(`[MH Promoters] ${promoterMap.size} unique promoters`);

			const basicPayload = [];
			for (const [, pData] of promoterMap) {
				for (const proj of pData.projects) {
					basicPayload.push({
						promoterName:    pData.promoterName,
						applicantType:   'Promoter',
						district:        pData.district || proj.district,
						projectName:     proj.projectName,
						projectRegNo:    proj.registrationNo,
						projectDistrict: proj.district
					});
				}
			}
			if (basicPayload.length > 0) {
				await CompanyService.upsertCompanies(STATE, basicPayload, { role: 'promoter' }).catch(e => console.warn('[MH Promoters] Basic upsert:', e.message));
			}

			await ScrapeLogService.completeScrapeLog(log.id, { totalItems: promoterMap.size });
			const { companies: p1Companies, total: p1Total } = await CompanyService.getCompaniesByState(STATE, { search, role: 'promoter', take: 5000 });

			if (action !== 'scrape-all') {
				return json({ success: true, data: p1Companies, total: p1Total, uniquePromoters: promoterMap.size, scraped: projectBasics.length, phase: 'list-only' });
			}

			// scrape-all: Phase 2 fires in background, return Phase 1 data now
			startPhase2Background(projectBasics);
			return json({ success: true, data: p1Companies, total: p1Total, uniquePromoters: promoterMap.size, scraped: projectBasics.length, phase: 'list-complete-details-background', message: `Phase 1 done: ${promoterMap.size} promoters saved. Phase 2 (CAPTCHA detail) running in background — refresh to see updates.` });
		}

		// Phase 2 only (scrape-details) — load project list from DB then start background
		if (action === 'scrape-details') {
			const { companies: dbPromoters } = await CompanyService.getCompaniesByState(STATE, { role: 'promoter', take: 10000 });
			// Reconstruct project list from DB records
			projectBasics = dbPromoters
				.filter(p => p.rawData?.projectId || p.rawData?.detailUrl)
				.map(p => ({
					projectId:    p.rawData?.projectId || '',
					projectName:  p.rawData?.projectName || p.name || '',
					promoterName: p.name || '',
					district:     p.district || '',
					detailUrl:    p.rawData?.detailUrl || ''
				}));
			if (projectBasics.length === 0) {
				// Fallback: re-run Phase 1 quickly
				projectBasics = await scrapeAllListPages(district, Math.min(maxPages || 0, 50));
			}
			await ScrapeLogService.completeScrapeLog(log.id, { totalItems: 0 });
			startPhase2Background(projectBasics);
			const { companies, total } = await CompanyService.getCompaniesByState(STATE, { search, role: 'promoter', take: 5000 });
			return json({ success: true, data: companies, total, phase: 'details-background', message: `Phase 2 (CAPTCHA detail) started for ${projectBasics.length} projects — refresh to see updates.` });
		}

	} catch (error) {
		await ScrapeLogService.completeScrapeLog(log.id, { error: error.message });
		console.error('[MH Promoters] Scrape failed:', error.message);
		try {
			const { companies, total } = await CompanyService.getCompaniesByState(STATE, { search, role: 'promoter', take: 5000 });
			if (companies.length > 0) return json({ success: true, data: companies, total, cached: true, scrapeError: error.message });
		} catch {}
		return json({ success: false, error: error.message }, { status: 500 });
	}
}
