// src/routes/api/punjab-rera-projects/+server.js
//
// Punjab RERA project data scraped from:
//   https://rera.punjab.gov.in/reraindex/publicview/projectinfo
//
// The site uses ASP.NET MVC with CAPTCHA protection.
// Uses Puppeteer to navigate, solve/submit CAPTCHA, and scrape project data.
//
// AJAX endpoints used:
//   POST PublicView/ProjectPVregdprojectInfo — search projects (returns HTML table)
//   GET  PublicView/ProjectViewDetails?inProject_ID=&inPromoter_ID=&inPromoterType= — project detail modal
//
// Persists via ProjectService.upsertProjects() which:
//   - Creates/updates Project records
//   - Links to Company (promoter) via ProjectCompany junction table by matching promoterName

import puppeteer from 'puppeteer';
import { json } from '@sveltejs/kit';
import { ProjectService, CompanyService, ScrapeLogService } from '$lib/server/services/index.js';

const STATE = 'Punjab';
const SOURCE = 'punjab-rera-projects';
const BASE_URL = 'https://rera.punjab.gov.in/reraindex';

const PUNJAB_DISTRICTS = [
	'Amritsar', 'Barnala', 'Bathinda', 'Chandigarh', 'Faridkot',
	'Fatehgarh Sahib', 'Fazilka', 'Firozpur', 'Gurdaspur', 'Hoshiarpur',
	'Jalandhar', 'Kapurthala', 'Ludhiana', 'Malerkotla', 'Mansa',
	'Moga', 'Muktsar', 'Pathankot', 'Patiala', 'Rupnagar',
	'Sahibzada Ajit Singh Nagar', 'Sangrur',
	'Shahid Bhagat Singh Nagar', 'Tarn Taran'
];

/**
 * Navigate to project search page, fill form, submit, and extract project rows.
 */
async function scrapeProjectsForDistrict(page, district = '') {
	const results = [];

	try {
		await page.goto(`${BASE_URL}/publicview/projectinfo`, {
			waitUntil: 'networkidle2',
			timeout: 30000
		});

		await page.waitForSelector('#ProjectPVform', { timeout: 15000 }).catch(() => {});

		// Select district if provided
		if (district) {
			try {
				await page.select('#Input_RegdProject_DistrictCode', district);
				await new Promise(r => setTimeout(r, 500));
			} catch {}
		}

		// Attempt CAPTCHA — try reading from hidden elements first
		let captchaSolved = false;
		try {
			const captchaText = await page.evaluate(() => {
				const hidden = document.querySelector('[name*="captcha_value"], [id*="captcha_value"], [name*="CaptchaValue"]');
				if (hidden) return hidden.value;
				const img = document.querySelector('img[src*="Cpacha"]');
				if (img && img.alt && img.alt.length >= 4) return img.alt;
				return null;
			});

			if (captchaText && captchaText.length >= 6) {
				await page.type('#Input_RegdProject_CaptchaText', captchaText);
				captchaSolved = true;
			}
		} catch {}

		if (!captchaSolved) {
			await page.type('#Input_RegdProject_CaptchaText', '123456');
		}

		// Submit via JavaScript (trigger the AJAX call directly)
		const responsePromise = page.waitForResponse(
			res => res.url().includes('ProjectPVregdprojectInfo'),
			{ timeout: 20000 }
		).catch(() => null);

		await page.evaluate(() => {
			const form = document.querySelector('#ProjectPVform');
			if (!form) return;

			const flag = form.querySelector('[name="Input_SearchOptionTabFlag"]');
			if (flag) flag.value = '1';

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
		});

		await responsePromise;
		await new Promise(r => setTimeout(r, 2000));

		// Check if results appeared
		const hasResults = await page.evaluate(() => {
			const table = document.querySelector('#dataTableSearchProject');
			if (!table) return false;
			return table.querySelectorAll('tbody tr').length > 0;
		});

		if (!hasResults) {
			console.log(`[Punjab Projects] No results for district: ${district || 'All'} (CAPTCHA may have failed)`);
			return results;
		}

		// Extract all rows from DataTable
		const rows = await page.evaluate(() => {
			const data = [];
			const table = document.querySelector('#dataTableSearchProject');
			if (!table) return data;

			table.querySelectorAll('tbody tr').forEach(tr => {
				const tds = tr.querySelectorAll('td');
				if (tds.length < 5) return;

				const projectID = tr.querySelector('.hdnProjectID')?.value || '';
				const promoterID = tr.querySelector('.hdnPromoterID')?.value || '';
				const promoterType = tr.querySelector('.hdnPromoterType')?.value || '';

				data.push({
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

			return data;
		});

		results.push(...rows);
		console.log(`[Punjab Projects] Scraped ${rows.length} projects for district: ${district || 'All'}`);

	} catch (err) {
		console.error(`[Punjab Projects] Error for district ${district}:`, err.message);
	}

	return results;
}

/**
 * Scrape a project detail modal via the AJAX endpoint.
 */
async function scrapeProjectDetail(page, projectID, promoterID, promoterType) {
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
						const parser = new DOMParser();
						const doc = parser.parseFromString(response, 'text/html');

						const result = {
							projectInfo: {},
							promoterInfo: {},
							locationInfo: {},
							financialInfo: {},
							propertyDetails: {},
							allFields: {},
							sourceUrl: `ProjectViewDetails?inProject_ID=${pID}`
						};

						// Extract key-value pairs
						doc.querySelectorAll('table tr').forEach(tr => {
							const cells = tr.querySelectorAll('td');
							if (cells.length >= 2) {
								const label = (cells[0]?.innerText?.trim() || '').replace(/:$/, '');
								const value = cells[1]?.innerText?.trim() || '';
								if (label && value && label !== value) {
									result.allFields[label] = value;

									const lk = label.toLowerCase();
									if (lk.includes('promoter') || lk.includes('builder') || lk.includes('applicant') || lk.includes('chairman') || lk.includes('director')) {
										result.promoterInfo[label] = value;
									} else if (lk.includes('district') || lk.includes('tehsil') || lk.includes('address') || lk.includes('location') || lk.includes('village') || lk.includes('pin') || lk.includes('area')) {
										result.locationInfo[label] = value;
									} else if (lk.includes('cost') || lk.includes('fee') || lk.includes('bank') || lk.includes('account') || lk.includes('amount') || lk.includes('ifsc')) {
										result.financialInfo[label] = value;
									} else {
										result.projectInfo[label] = value;
									}
								}
							}
						});

						// Extract data tables (property details, unit info, etc.)
						doc.querySelectorAll('table').forEach((table, idx) => {
							const headers = [];
							table.querySelectorAll('thead th, tr:first-child th').forEach(th => {
								headers.push(th.innerText?.trim() || '');
							});
							if (headers.length < 3) return;

							const caption = table.previousElementSibling?.innerText?.trim() || `Details ${idx + 1}`;
							const tableData = [];
							table.querySelectorAll('tbody tr').forEach(tr => {
								const row = {};
								tr.querySelectorAll('td').forEach((td, ci) => {
									row[headers[ci] || `col${ci}`] = td.innerText?.trim() || '';
								});
								if (Object.values(row).some(v => v)) tableData.push(row);
							});

							if (tableData.length > 0) {
								result.propertyDetails[caption] = tableData;
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
		console.log(`[Punjab Project Detail] Failed for ${projectID}:`, err.message);
		return null;
	}
}

export async function GET({ url }) {
	const action = url.searchParams.get('action') || 'list';
	const district = url.searchParams.get('district') || '';
	const refresh = url.searchParams.get('refresh') === 'true';
	const search = url.searchParams.get('search') || '';
	const detailProjectId = url.searchParams.get('projectId') || '';
	const detailPromoterId = url.searchParams.get('promoterId') || '';
	const detailPromoterType = url.searchParams.get('promoterType') || '';

	// Action: list districts
	if (action === 'districts') {
		return json({
			success: true,
			data: PUNJAB_DISTRICTS.map(d => ({ name: d, code: d })).sort((a, b) => a.name.localeCompare(b.name))
		});
	}

	// Action: get project detail
	if (action === 'details' && detailProjectId) {
		let browser;
		try {
			browser = await puppeteer.launch({
				headless: true,
				args: ['--no-sandbox', '--disable-setuid-sandbox']
			});
			const page = await browser.newPage();
			await page.setViewport({ width: 1280, height: 900 });
			await page.goto(`${BASE_URL}/publicview/projectinfo`, {
				waitUntil: 'networkidle2',
				timeout: 30000
			});

			const details = await scrapeProjectDetail(page, detailProjectId, detailPromoterId, detailPromoterType);

			if (details) {
				// Persist detail data and link to company
				const reraRegNo = details.allFields?.['Registration No.'] || details.allFields?.['RERA Reg. No.'] || `PB-${detailProjectId}`;
				const promoterName = details.allFields?.['Promoter Name'] || details.allFields?.['Builder Name'] || '';

				try {
					await ProjectService.upsertProjects(STATE, [{
						reraRegNo,
						projectName: details.allFields?.['Project Name'] || '',
						district: details.allFields?.['District'] || '',
						location: details.allFields?.['Area'] || details.allFields?.['Location'] || '',
						projectType: details.allFields?.['Project Type'] || '',
						constructionStatus: details.allFields?.['Status'] || '',
						promoterName
					}], { role: 'promoter' });

					await ProjectService.updateProjectDetails(STATE, reraRegNo, details).catch(() => {});
				} catch (persistErr) {
					console.warn('[Punjab Project Detail] Persist failed:', persistErr.message);
				}

				return json({ success: true, data: details });
			}
			return json({ success: false, error: 'Failed to fetch project details' }, { status: 404 });
		} catch (error) {
			return json({ success: false, error: error.message }, { status: 500 });
		} finally {
			try { if (browser) await browser.close(); } catch {}
		}
	}

	// Action: scrape all projects
	if (action === 'scrape-all' || (action === 'list' && refresh && !district)) {
		return await scrapeAllProjects(search);
	}

	// Action: list by district
	if (action === 'list' && district) {
		return await getProjectsByDistrict(district, search, refresh);
	}

	// Action: list all from DB
	if (action === 'list') {
		const { projects, total } = await ProjectService.getProjectsByState(STATE, { search, take: 5000 });
		return json({ success: true, data: projects, total, cached: true });
	}

	return json({
		success: false,
		error: 'Use ?action=districts, ?action=list&district=X, ?action=scrape-all&refresh=true, or ?action=details&projectId=X'
	}, { status: 400 });
}

async function scrapeAllProjects(search) {
	if (await ScrapeLogService.isRunning(SOURCE, STATE)) {
		const { projects, total } = await ProjectService.getProjectsByState(STATE, { search, take: 10000 });
		return json({ success: true, data: projects, total, cached: true, scraping: true });
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

		let allProjects = [];
		let totalPersisted = 0;

		for (const dist of PUNJAB_DISTRICTS) {
			const rows = await scrapeProjectsForDistrict(page, dist);

			// Persist each district batch immediately with company linking
			if (rows.length > 0) {
				try {
					const count = await ProjectService.upsertProjects(
						STATE,
						rows.map(p => ({
							reraRegNo: p.registrationNo || `PB-${dist}-${p.projectName?.substring(0, 30)}`.replace(/\s+/g, '-'),
							projectName: p.projectName,
							name: p.projectName,
							district: p.district || dist,
							location: p.district || dist,
							validUntil: p.validUpto,
							promoterName: p.promoterName, // Used by ProjectService to link to Company
							rawProjectID: p.projectID,
							rawPromoterID: p.promoterID,
							rawPromoterType: p.promoterType
						})),
						{ role: 'promoter' }
					);
					totalPersisted += count;
				} catch (dbErr) {
					console.warn(`[Punjab Projects] DB persist failed for ${dist}:`, dbErr.message);
				}
			}

			allProjects.push(...rows);
			console.log(`[Punjab Projects] ${dist}: ${rows.length} projects (running total: ${allProjects.length})`);

			// Delay between districts
			await new Promise(r => setTimeout(r, 1500));
		}

		await ScrapeLogService.completeScrapeLog(log.id, { totalItems: totalPersisted });
		console.log(`[Punjab Projects] Total: ${allProjects.length} scraped, ${totalPersisted} persisted`);

		const { projects: dbProjects, total } = await ProjectService.getProjectsByState(STATE, { search, take: 10000 });
		return json({ success: true, data: dbProjects, total, scraped: allProjects.length, persisted: totalPersisted });

	} catch (error) {
		await ScrapeLogService.completeScrapeLog(log.id, { error: error.message });
		console.error('[Punjab Projects] Scrape failed:', error.message);

		const { projects: dbProjects, total } = await ProjectService.getProjectsByState(STATE, { search, take: 10000 });
		if (dbProjects.length > 0) {
			return json({ success: true, data: dbProjects, total, cached: true, scrapeError: error.message });
		}
		return json({ success: false, error: error.message }, { status: 500 });
	} finally {
		try { if (browser) await browser.close(); } catch {}
	}
}

async function getProjectsByDistrict(districtName, search, forceRefresh) {
	// Try DB first
	if (!forceRefresh) {
		try {
			const { projects, total } = await ProjectService.getProjectsByState(STATE, {
				district: districtName,
				search,
				take: 5000
			});
			if (projects.length > 0) {
				return json({ success: true, data: projects, total, cached: true, district: districtName });
			}
		} catch {}
	}

	// Scrape district
	let browser;
	try {
		browser = await puppeteer.launch({
			headless: true,
			args: ['--no-sandbox', '--disable-setuid-sandbox']
		});

		const page = await browser.newPage();
		await page.setViewport({ width: 1280, height: 900 });

		const rows = await scrapeProjectsForDistrict(page, districtName);

		if (rows.length > 0) {
			try {
				await ProjectService.upsertProjects(
					STATE,
					rows.map(p => ({
						reraRegNo: p.registrationNo || `PB-${districtName}-${p.projectName?.substring(0, 30)}`.replace(/\s+/g, '-'),
						projectName: p.projectName,
						name: p.projectName,
						district: p.district || districtName,
						location: p.district || districtName,
						validUntil: p.validUpto,
						promoterName: p.promoterName
					})),
					{ role: 'promoter' }
				);
			} catch (dbErr) {
				console.warn('[Punjab Projects] DB persist failed:', dbErr.message);
			}
		}

		return json({ success: true, data: rows, total: rows.length, district: districtName });
	} catch (error) {
		// Fallback to DB
		try {
			const { projects, total } = await ProjectService.getProjectsByState(STATE, {
				district: districtName,
				search,
				take: 5000
			});
			if (projects.length > 0) {
				return json({ success: true, data: projects, total, cached: true, district: districtName });
			}
		} catch {}

		return json({ success: false, error: error.message }, { status: 500 });
	} finally {
		try { if (browser) await browser.close(); } catch {}
	}
}
