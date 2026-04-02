// src/routes/api/punjab-rera-promoters/+server.js
//
// Punjab RERA promoter/builder data scraped from the project search page:
//   https://rera.punjab.gov.in/reraindex/publicview/projectinfo
//
// The site uses ASP.NET MVC with CAPTCHA protection. We use Puppeteer to:
//   1. Navigate to the project search page
//   2. Select a district, fill CAPTCHA via page interaction
//   3. Submit and extract promoter data from project rows
//   4. Fetch detail modals for each project (contains promoter info)
//
// Promoters are extracted FROM project rows:
//   - Each row has hidden fields: hdnProjectID, hdnPromoterID, hdnPromoterType
//   - Detail modal (ProjectViewDetails) contains full promoter + project info
//
// Persists via CompanyService.upsertCompanies() which creates:
//   Company records + Project records + ProjectCompany junction links

import puppeteer from 'puppeteer';
import { json } from '@sveltejs/kit';
import { createWorker } from 'tesseract.js';
import { CompanyService, ScrapeLogService } from '$lib/server/services/index.js';

const STATE = 'Punjab';
const SOURCE = 'punjab-rera-promoters';
const BASE_URL = 'https://rera.punjab.gov.in/reraindex';

const PUNJAB_DISTRICTS = [
	'Amritsar', 'Barnala', 'Bathinda', 'Chandigarh', 'Faridkot',
	'Fatehgarh Sahib', 'Fazilka', 'Firozpur', 'Gurdaspur', 'Hoshiarpur',
	'Jalandhar', 'Kapurthala', 'Ludhiana', 'Malerkotla', 'Mansa',
	'Moga', 'Muktsar', 'Pathankot', 'Patiala', 'Rupnagar',
	'Sahibzada Ajit Singh Nagar', 'Sangrur',
	'Shahid Bhagat Singh Nagar', 'Tarn Taran'
];

// Numeric option values from #Input_RegdProject_DistrictCode <select>
const PUNJAB_DISTRICT_CODES = {
	'Amritsar': '39',
	'Barnala': '79',
	'Bathinda': '84',
	'Chandigarh': '128',
	'Faridkot': '202',
	'Fatehgarh Sahib': '204',
	'Fazilka': '206',
	'Firozpur': '207',
	'Gurdaspur': '232',
	'Hoshiarpur': '248',
	'Jalandhar': '261',
	'Kapurthala': '300',
	'Ludhiana': '366',
	'Malerkotla': '2024',
	'Mansa': '386',
	'Moga': '393',
	'Muktsar': '399',
	'Pathankot': '453',
	'Patiala': '454',
	'Rupnagar': '501',
	'Sahibzada Ajit Singh Nagar': '507',
	'Sangrur': '514',
	'Shahid Bhagat Singh Nagar': '527',
	'Tarn Taran': '574'
};

/**
 * Preprocess the CAPTCHA image in-browser via Canvas (scale 4×, binarize),
 * then OCR the result with Tesseract.
 * Returns the recognized text, or null on failure.
 */
async function readCaptchaText(page) {
	// Wait for the CAPTCHA image to fully load
	await page.waitForFunction(
		() => { const img = document.querySelector('img.capcha-badge'); return img && img.complete && img.naturalWidth > 0; },
		{ timeout: 10000 }
	).catch(() => {});

	const captchaBase64 = await page.evaluate(() => {
		const img = document.querySelector('img.capcha-badge');
		if (!img || !img.complete || img.naturalWidth === 0) return null;

		const SCALE = 4;
		// Step 1: draw original at 1× to read pixels
		const src = document.createElement('canvas');
		src.width = img.naturalWidth;
		src.height = img.naturalHeight;
		src.getContext('2d').drawImage(img, 0, 0);

		// Step 2: binarize
		const ctx1 = src.getContext('2d');
		const id = ctx1.getImageData(0, 0, src.width, src.height);
		const d = id.data;
		for (let i = 0; i < d.length; i += 4) {
			const lum = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
			const v = lum < 140 ? 0 : 255;
			d[i] = d[i + 1] = d[i + 2] = v;
			d[i + 3] = 255;
		}
		ctx1.putImageData(id, 0, 0);

		// Step 3: scale up 4× with no smoothing for crisp edges
		const out = document.createElement('canvas');
		out.width = src.width * SCALE;
		out.height = src.height * SCALE;
		const ctx2 = out.getContext('2d');
		ctx2.imageSmoothingEnabled = false;
		ctx2.drawImage(src, 0, 0, out.width, out.height);

		return out.toDataURL('image/png').split(',')[1];
	});

	if (!captchaBase64) return null;

	try {
		const imgBuffer = Buffer.from(captchaBase64, 'base64');
		const worker = await createWorker('eng');
		await worker.setParameters({
			tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
			tessedit_pageseg_mode: '8' // single word / short string
		});
		const { data: { text } } = await worker.recognize(imgBuffer);
		await worker.terminate();
		const cleaned = text.trim().replace(/\s+/g, '').substring(0, 10);
		return cleaned.length >= 4 ? cleaned : null;
	} catch (err) {
		console.warn('[Punjab Promoters] Tesseract failed:', err.message);
		return null;
	}
}

/**
 * Read CAPTCHA, type it into the input. Returns true if a value was entered.
 */
async function attemptCaptchaSolve(page, captchaInputSelector) {
	const text = await readCaptchaText(page);
	if (text) {
		await page.type(captchaInputSelector, text);
		console.log(`[Punjab Promoters] CAPTCHA OCR result: "${text}"`);
		return true;
	}
	return false;
}

/**
 * Scrape projects from Punjab RERA using Puppeteer.
 * Returns array of { promoterName, promoterID, promoterType, projectName, registrationNo, district, validUpto, projectID }
 */
async function scrapeProjectsFromPage(page, district = '') {
	const results = [];

	try {
		// Navigate to project info page
		await page.goto(`${BASE_URL}/publicview/projectinfo`, {
			waitUntil: 'networkidle2',
			timeout: 30000
		});

		// Wait for form to load
		await page.waitForSelector('#ProjectPVform', { timeout: 15000 }).catch(() => {});

		// Select district if specified — use numeric code, not the display name
		if (district) {
			const districtCode = PUNJAB_DISTRICT_CODES[district];
			if (districtCode) {
				try {
					await page.select('#Input_RegdProject_DistrictCode', districtCode);
					await new Promise(r => setTimeout(r, 500));
				} catch {}
			}
		}

		// Solve CAPTCHA via OCR
		await attemptCaptchaSolve(page, '#Input_RegdProject_CaptchaText');

		// Submit the form via JavaScript (bypass client-side validation)
		const responsePromise = page.waitForResponse(
			res => res.url().includes('ProjectPVregdprojectInfo'),
			{ timeout: 20000 }
		).catch(() => null);

		await page.evaluate(() => {
			const form = document.querySelector('#ProjectPVform');
			if (form) {
				// Set the search option flag
				const flag = form.querySelector('[name="Input_SearchOptionTabFlag"]');
				if (flag) flag.value = '1';

				// Trigger AJAX submission directly
				const $ = window.jQuery || window.$;
				if ($) {
					$.ajax({
						type: 'POST',
						cache: false,
						url: $('body').attr('data-base-url') + 'PublicView/ProjectPVregdprojectInfo',
						data: $(form).serialize(),
						success: function(data) {
							$('#contentRegdProjectShowGrid').attr('style', 'display:none');
							$('#contentRegdProjectList').attr('style', 'display:block');
							$('#viewProjectPVList').html(data);
						}
					});
				}
			}
		});

		await responsePromise;
		await new Promise(r => setTimeout(r, 2000));

		// Check if results appeared
		const hasResults = await page.evaluate(() => {
			const table = document.querySelector('#dataTableSearchProject');
			if (!table) return false;
			const rows = table.querySelectorAll('tbody tr');
			return rows.length > 0;
		});

		if (!hasResults) {
			console.log(`[Punjab Promoters] No results found for district: ${district || 'All'} (CAPTCHA may have failed)`);
			return results;
		}

		// Extract all project rows with promoter data
		const pageData = await page.evaluate(() => {
			const rows = [];
			const table = document.querySelector('#dataTableSearchProject');
			if (!table) return rows;

			const trs = table.querySelectorAll('tbody tr');
			trs.forEach((tr) => {
				const tds = tr.querySelectorAll('td');
				if (tds.length < 5) return;

				const projectID = tr.querySelector('.hdnProjectID')?.value || '';
				const promoterID = tr.querySelector('.hdnPromoterID')?.value || '';
				const promoterType = tr.querySelector('.hdnPromoterType')?.value || '';

				rows.push({
					district: tds[0]?.innerText?.trim() || '',
					projectName: tds[1]?.innerText?.trim() || '',
					promoterName: tds[2]?.innerText?.trim() || '',
					registrationNo: tds[3]?.innerText?.trim() || '',
					validUpto: tds[4]?.innerText?.trim() || '',
					projectID,
					promoterID,
					promoterType
				});
			});

			return rows;
		});

		results.push(...pageData);
		console.log(`[Punjab Promoters] Scraped ${results.length} rows for district: ${district || 'All'}`);

	} catch (err) {
		console.error(`[Punjab Promoters] Scrape error for district ${district}:`, err.message);
	}

	return results;
}

/**
 * Fetch project detail modal via Puppeteer.
 * Returns full promoter + project info.
 */
async function fetchProjectDetail(page, projectID, promoterID, promoterType) {
	try {
		const detail = await page.evaluate(async (pID, prID, prType) => {
			const $ = window.jQuery || window.$;
			if (!$) return null;

			const baseUrl = $('body').attr('data-base-url');
			return new Promise((resolve) => {
				$.ajax({
					url: baseUrl + 'PublicView/ProjectViewDetails',
					dataType: 'HTML',
					type: 'GET',
					data: {
						inProject_ID: pID,
						inPromoter_ID: prID,
						inPromoterType: prType
					},
					success: function(response) {
						// Parse the detail HTML
						const parser = new DOMParser();
						const doc = parser.parseFromString(response, 'text/html');
						const result = { allFields: {}, tables: [] };

						// Extract key-value pairs from tables
						doc.querySelectorAll('table').forEach((table, tableIdx) => {
							const headers = [];
							table.querySelectorAll('thead th, tr:first-child th').forEach(th => {
								headers.push(th.innerText?.trim() || '');
							});

							const tableRows = [];
							table.querySelectorAll('tbody tr, tr').forEach(tr => {
								const cells = tr.querySelectorAll('td');
								if (cells.length === 2) {
									// Key-value pair
									const label = cells[0]?.innerText?.trim()?.replace(/:$/, '') || '';
									const value = cells[1]?.innerText?.trim() || '';
									if (label && value && label !== value) {
										result.allFields[label] = value;
									}
								} else if (cells.length > 2 && headers.length > 0) {
									const row = {};
									cells.forEach((cell, i) => {
										row[headers[i] || `col${i}`] = cell.innerText?.trim() || '';
									});
									tableRows.push(row);
								}
							});

							if (tableRows.length > 0) {
								result.tables.push({ headers, rows: tableRows });
							}
						});

						resolve(result);
					},
					error: function() { resolve(null); }
				});
			});
		}, projectID, promoterID, promoterType);

		return detail;
	} catch (err) {
		console.log(`[Punjab Detail] Failed for project ${projectID}:`, err.message);
		return null;
	}
}

export async function GET({ url }) {
	const refresh = url.searchParams.get('refresh') === 'true';
	const search = url.searchParams.get('search') || '';
	const district = url.searchParams.get('district') || '';
	const detailProjectId = url.searchParams.get('projectId') || '';
	const detailPromoterId = url.searchParams.get('promoterId') || '';
	const detailPromoterType = url.searchParams.get('promoterType') || '';

	// Return district list
	if (url.searchParams.get('action') === 'districts') {
		return json({
			success: true,
			data: PUNJAB_DISTRICTS.map(d => ({ name: d, code: d })).sort((a, b) => a.name.localeCompare(b.name))
		});
	}

	// Return cached DB data if not refreshing
	if (!refresh) {
		try {
			const { companies, total } = await CompanyService.getCompaniesByState(STATE, {
				search,
				role: 'promoter',
				take: 5000
			});
			if (companies.length > 0) {
				return json({ success: true, data: companies, total, cached: true });
			}
		} catch (dbErr) {
			console.warn('[Punjab Promoters] DB read failed:', dbErr.message);
		}
		return json({ success: true, data: [], total: 0, cached: true, empty: true });
	}

	// Check scrape lock
	if (await ScrapeLogService.isRunning(SOURCE, STATE)) {
		const { companies, total } = await CompanyService.getCompaniesByState(STATE, { search, role: 'promoter', take: 5000 });
		return json({ success: true, data: companies, total, cached: true, scraping: true });
	}

	const log = await ScrapeLogService.startScrapeLog(SOURCE, STATE);
	let browser;

	try {
		browser = await puppeteer.launch({
			headless: true,
			args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security']
		});

		const page = await browser.newPage();
		await page.setViewport({ width: 1280, height: 900 });

		let allRows = [];
		const districtsToScrape = district ? [district] : PUNJAB_DISTRICTS;

		for (const dist of districtsToScrape) {
			const rows = await scrapeProjectsFromPage(page, dist);
			allRows.push(...rows);

			// Small delay between districts
			if (districtsToScrape.length > 1) {
				await new Promise(r => setTimeout(r, 1000));
			}
		}

		// Deduplicate by promoterName
		const promoterMap = new Map();
		for (const row of allRows) {
			if (!row.promoterName) continue;
			const key = row.promoterName.toLowerCase().trim();
			if (!promoterMap.has(key)) {
				promoterMap.set(key, {
					promoterName: row.promoterName,
					promoterID: row.promoterID,
					promoterType: row.promoterType,
					district: row.district,
					projects: []
				});
			}
			promoterMap.get(key).projects.push({
				projectName: row.projectName,
				registrationNo: row.registrationNo,
				validUpto: row.validUpto,
				district: row.district,
				projectID: row.projectID
			});
		}

		console.log(`[Punjab Promoters] Found ${promoterMap.size} unique promoters from ${allRows.length} project rows`);

		// Persist promoters via CompanyService — this creates Company + Project + ProjectCompany links
		const promoterDataForUpsert = [];
		for (const [, pData] of promoterMap) {
			// For each promoter, create entries that include project data
			// CompanyService.upsertCompanies will create company AND linked projects
			if (pData.projects.length > 0) {
				for (const proj of pData.projects) {
					promoterDataForUpsert.push({
						promoterName: pData.promoterName,
						applicantType: pData.promoterType || 'Promoter',
						district: pData.district || proj.district,
						promoterID: pData.promoterID,
						// Project fields — CompanyService uses these to create project + junction link
						projectName: proj.projectName,
						projectRegNo: proj.registrationNo,
						validUntil: proj.validUpto,
						projectDistrict: proj.district
					});
				}
			} else {
				// Promoter without projects — just create the company record
				promoterDataForUpsert.push({
					promoterName: pData.promoterName,
					applicantType: pData.promoterType || 'Promoter',
					district: pData.district,
					promoterID: pData.promoterID
				});
			}
		}

		let upsertCount = 0;
		if (promoterDataForUpsert.length > 0) {
			try {
				upsertCount = await CompanyService.upsertCompanies(STATE, promoterDataForUpsert, {
					role: 'promoter'
				});
			} catch (dbErr) {
				console.warn('[Punjab Promoters] DB persist failed:', dbErr.message);
			}
		}

		await ScrapeLogService.completeScrapeLog(log.id, { totalItems: upsertCount });

		// Return fresh data from DB
		const { companies, total } = await CompanyService.getCompaniesByState(STATE, {
			search,
			role: 'promoter',
			take: 5000
		});

		return json({
			success: true,
			data: companies,
			total,
			scraped: allRows.length,
			uniquePromoters: promoterMap.size,
			upserted: upsertCount
		});

	} catch (error) {
		await ScrapeLogService.completeScrapeLog(log.id, { error: error.message });
		console.error('[Punjab Promoters] Scrape failed:', error.message);

		// Fallback to cached data
		try {
			const { companies, total } = await CompanyService.getCompaniesByState(STATE, {
				search,
				role: 'promoter',
				take: 5000
			});
			if (companies.length > 0) {
				return json({
					success: true,
					data: companies,
					total,
					cached: true,
					scrapeError: error.message
				});
			}
		} catch {}

		return json({ success: false, error: error.message }, { status: 500 });
	} finally {
		try { if (browser) await browser.close(); } catch {}
	}
}
