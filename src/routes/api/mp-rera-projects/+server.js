// src/routes/api/mp-rera-projects/+server.js
//
// MP RERA loads project data via AJAX from:
//   https://www.rera.mp.gov.in/project-all-loop.php?show={n}&pagenum={p}&search_txt={q}&search_dist={distCode}&search_tehs={tehsId}&project_type_id={t}
//
// Response is raw HTML containing a table with columns:
//   S.No. | Project Name | Promoter Name | District - Area | Status | View (detail link)
//
// Detail links: view_project_details.php?id=<base64_encoded_id>
// Total records: ~8,149

import axios from 'axios';
import * as cheerio from 'cheerio';
import { json } from '@sveltejs/kit';
import https from 'https';
import { CompanyService, ProjectService, ScrapeLogService } from '$lib/server/services/index.js';

const BASE_URL = 'https://www.rera.mp.gov.in';
const PROJECT_LOOP_URL = `${BASE_URL}/project-all-loop.php`;
const PROJECT_DETAIL_URL = `${BASE_URL}/view_project_details.php`;

const STATE = 'MP';
const SOURCE = 'mp-rera-projects';

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const HEADERS = {
	'User-Agent':
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36',
	Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
	'Accept-Language': 'en-US,en;q=0.9',
	Referer: `${BASE_URL}/all-projects/`
};

// MP district codes for the project filter dropdown
const MP_DISTRICTS = {
	'Agar Malwa': 501,
	'Alirajpur': 465,
	'Anuppur': 461,
	'Ashoknagar': 459,
	'Balaghat': 457,
	'Barwani': 441,
	'Betul': 447,
	'Bhind': 420,
	'Bhopal': 444,
	'Burhanpur': 467,
	'Chhatarpur': 425,
	'Chhindwara': 455,
	'Damoh': 428,
	'Datia': 422,
	'Dewas': 437,
	'Dhar': 438,
	'Dindori': 453,
	'Guna': 458,
	'Gwalior': 421,
	'Harda': 448,
	'Indore': 439,
	'Jabalpur': 451,
	'Jhabua': 464,
	'Katni': 450,
	'Khandwa': 466,
	'Khargone': 440,
	'Maihar': 784,
	'Mandla': 454,
	'Mandsaur': 433,
	'Mauganj': 766,
	'Morena': 419,
	'Narmadapuram': 449,
	'Narsinghpur': 452,
	'Neemuch': 432,
	'Niwari': 722,
	'Pandhurna': 785,
	'Panna': 426,
	'Raisen': 446,
	'Rajgarh': 442,
	'Ratlam': 434,
	'Rewa': 430,
	'Sagar': 427,
	'Satna': 429,
	'Sehore': 445,
	'Seoni': 456,
	'Shahdol': 460,
	'Shajapur': 436,
	'Sheopur': 418,
	'Shivpuri': 423,
	'Sidhi': 462,
	'Singrauli': 463,
	'Tikamgarh': 424,
	'Ujjain': 435,
	'Umaria': 431,
	'Vidisha': 443
};

/**
 * Extract a stable ID from the detail URL's base64 `id` parameter.
 * e.g., view_project_details.php?id=TUNQLzI2LzYzNDU= → "MP-TUNQLzI2LzYzNDU="
 */
function extractProjectId(detailUrl) {
	if (!detailUrl) return '';
	try {
		const urlObj = new URL(detailUrl);
		const id = urlObj.searchParams.get('id');
		if (id) return `MP-P-${id}`;
	} catch {
		// Fallback: extract id= param manually
		const match = detailUrl.match(/[?&]id=([^&]+)/);
		if (match) return `MP-P-${match[1]}`;
	}
	return '';
}

async function fetchHtml(url) {
	const response = await axios.get(url, {
		httpsAgent,
		timeout: 30000,
		validateStatus: (status) => status < 600,
		headers: HEADERS
	});
	if (!response.data || typeof response.data !== 'string') {
		throw new Error(`Failed to fetch: HTTP ${response.status}`);
	}
	return response.data;
}

/**
 * Fetch a page of projects from the AJAX endpoint.
 * @param {number} pageSize - records per page
 * @param {number} pageNum - page number (1-based)
 * @param {object} filters - { searchText, districtCode, tehsilId, projectTypeId }
 */
async function fetchProjectPage(pageSize = 200, pageNum = 1, filters = {}) {
	const { searchText = '', districtCode = '', tehsilId = '', projectTypeId = '' } = filters;

	const url =
		`${PROJECT_LOOP_URL}?show=${pageSize}&pagenum=${pageNum}` +
		`&search_txt=${encodeURIComponent(searchText)}` +
		`&search_dist=${encodeURIComponent(districtCode)}` +
		`&search_tehs=${encodeURIComponent(tehsilId)}` +
		`&project_type_id=${encodeURIComponent(projectTypeId)}`;

	console.log(`[MP RERA Projects] Fetching page ${pageNum}: ${url}`);

	const html = await fetchHtml(url);
	const $ = cheerio.load(html);

	const projects = [];

	// Extract total records
	let totalRecords = 0;
	const totalText = $('.total_rec, .total-records').text() || $('body').text();
	const totalMatch = totalText.match(/Total\s*Records?\s*[:\-]?\s*([\d,]+)/i);
	if (totalMatch) {
		totalRecords = parseInt(totalMatch[1].replace(/,/g, ''), 10);
	}

	// Parse table rows
	// Columns: S.No. | Project Name | Promoter Name | District - Area | Status | View
	const rows = $('table#example tbody tr, table tbody tr, table tr').filter((_, row) => {
		return $(row).find('td').length >= 5;
	});

	console.log(`[MP RERA Projects] Found ${rows.length} rows, total records: ${totalRecords}`);

	rows.each((idx, row) => {
		const cells = $(row).find('td');
		if (cells.length < 5) return;

		const sno = $(cells[0]).text().trim();
		if (!sno || isNaN(parseInt(sno.replace('.', '')))) return;

		const projectName = $(cells[1]).text().trim();
		const promoterName = $(cells[2]).text().trim();

		// District - Area column (e.g., "Jabalpur - Jabalpur" or "Indore - Indore")
		const districtArea = $(cells[3]).text().trim().replace(/\u00a0/g, ' ');
		let district = '';
		let area = '';
		if (districtArea.includes('-')) {
			const parts = districtArea.split('-').map((p) => p.trim());
			district = parts[0] || '';
			area = parts[1] || '';
		} else {
			district = districtArea;
		}

		const constructionStatus = $(cells[4]).text().trim();

		// Detail link from the View column
		let detailUrl = '';
		if (cells.length > 5) {
			const detailLink = $(cells[5]).find('a[href*="view_project_details"]').first();
			if (detailLink.length) {
				const href = detailLink.attr('href') || '';
				detailUrl = href.startsWith('http') ? href : `${BASE_URL}/${href.replace(/^\//, '')}`;
			}
		}
		// Fallback: try finding link anywhere in the row
		if (!detailUrl) {
			const anyLink = $(row).find('a[href*="view_project"]').first();
			if (anyLink.length) {
				const href = anyLink.attr('href') || '';
				detailUrl = href.startsWith('http') ? href : `${BASE_URL}/${href.replace(/^\//, '')}`;
			}
		}

		const project = {
			projectName,
			promoterName,
			district,
			location: area || district,
			constructionStatus,
			detailUrl
		};

		if (projectName || promoterName) {
			projects.push(project);
		}
	});

	return { rows: projects, totalRecords };
}

/**
 * Scrape project detail page.
 */
async function scrapeProjectDetail(detailUrl) {
	try {
		const html = await fetchHtml(detailUrl);
		const $ = cheerio.load(html);

		const details = {
			projectInfo: {},
			promoterInfo: {},
			locationInfo: {},
			financialInfo: {},
			propertyDetails: {},
			sections: {},
			allFields: {},
			sourceUrl: detailUrl
		};

		// Extract key-value pairs from tables
		$('table tr').each((_, row) => {
			const cells = $(row).find('td, th');
			if (cells.length >= 2) {
				const label = $(cells[0]).text().trim().replace(/:$/, '');
				const value = $(cells[1]).text().trim();
				if (label && value && label !== value) {
					details.allFields[label] = value;

					const lk = label.toLowerCase();
					if (lk.includes('promoter') || lk.includes('builder') || lk.includes('applicant') || lk.includes('chairman') || lk.includes('director')) {
						details.promoterInfo[label] = value;
					} else if (lk.includes('district') || lk.includes('tehsil') || lk.includes('address') || lk.includes('location') || lk.includes('village') || lk.includes('pin') || lk.includes('area')) {
						details.locationInfo[label] = value;
					} else if (lk.includes('cost') || lk.includes('fee') || lk.includes('bank') || lk.includes('account') || lk.includes('amount') || lk.includes('ifsc')) {
						details.financialInfo[label] = value;
					} else {
						details.projectInfo[label] = value;
					}
				}
			}
		});

		// Extract data tables (property details, unit info, etc.)
		$('table').each((tableIdx, table) => {
			const headers = [];
			$(table).find('thead th, tr:first-child th').each((__, th) => {
				headers.push($(th).text().trim());
			});
			if (headers.length < 3) return;

			const caption = $(table).prev('h3, h4, h5').text().trim() || `Details ${tableIdx + 1}`;
			const tableData = [];
			$(table).find('tbody tr').each((__, tr) => {
				const row = {};
				$(tr).find('td').each((ci, td) => {
					row[headers[ci] || `col${ci}`] = $(td).text().trim();
				});
				if (Object.values(row).some((v) => v)) {
					tableData.push(row);
				}
			});

			if (tableData.length > 0) {
				details.propertyDetails[caption] = tableData;
			}
		});

		return details;
	} catch (err) {
		console.log(`[MP RERA Project Detail] Failed: ${err.message}`);
		return null;
	}
}

export async function GET({ url }) {
	const action = url?.searchParams?.get('action') || 'list';
	const district = url?.searchParams?.get('district') || '';
	const forceRefresh = url?.searchParams?.get('refresh') === 'true';
	const search = url?.searchParams?.get('search') || '';
	const detailUrl = url?.searchParams?.get('detailUrl') || '';
	const projectTypeId = url?.searchParams?.get('type') || '';

	// Action: list districts (with codes)
	if (action === 'districts') {
		const districtList = Object.entries(MP_DISTRICTS)
			.map(([name, code]) => ({ name, code }))
			.sort((a, b) => a.name.localeCompare(b.name));
		return json({ success: true, data: districtList });
	}

	// Action: get project details — also persist to DB and link to company
	if (action === 'details' && detailUrl) {
		try {
			const details = await scrapeProjectDetail(detailUrl);
			if (details) {
				// Try to persist project details and link to company
				const projectId = extractProjectId(detailUrl);
				if (projectId && details.allFields) {
					try {
						// Extract RERA reg no and promoter name from scraped fields
						const allF = details.allFields;
						const reraRegNo = allF['RERA Reg. No.'] || allF['Registration No.'] || allF['RERA Registration No'] || projectId;
						const promoterName = allF['Promoter Name'] || allF['Builder Name'] || allF['Applicant Name'] || '';

						await ProjectService.upsertProjects(STATE, [{
							reraRegNo,
							projectName: allF['Project Name'] || allF['Name'] || '',
							district: allF['District'] || '',
							location: allF['Area'] || allF['Location'] || '',
							projectType: allF['Project Type'] || '',
							constructionStatus: allF['Construction Status'] || allF['Status'] || '',
							promoterName
						}], { role: 'promoter' });

						// Also persist rich detail fields
						await ProjectService.updateProjectDetails(STATE, reraRegNo, details).catch(() => {});
					} catch (persistErr) {
						console.warn('[MP RERA Projects] Detail persist failed:', persistErr.message);
					}
				}
				return json({ success: true, data: details });
			}
			return json({ success: false, error: 'Failed to fetch project details' }, { status: 404 });
		} catch (error) {
			return json({ success: false, error: error.message }, { status: 500 });
		}
	}

	// Action: scrape all projects
	if (action === 'scrape-all' || (action === 'list' && !district && forceRefresh)) {
		return await scrapeAllProjects(search, projectTypeId);
	}

	// Action: list projects by district
	if (action === 'list' && district) {
		return await getProjectsByDistrict(district, search, forceRefresh, projectTypeId);
	}

	// Action: list all projects from DB
	if (action === 'list' && !district) {
		const { projects, total } = await ProjectService.getProjectsByState(STATE, { search, take: 5000 });
		return json({ success: true, data: projects, total, cached: true });
	}

	return json(
		{
			success: false,
			error: 'Provide ?action=districts, ?action=list&district=<name>, ?action=scrape-all&refresh=true, or ?action=details&detailUrl=<url>'
		},
		{ status: 400 }
	);
}

async function scrapeAllProjects(search, projectTypeId = '') {
	// Check if scrape already running
	if (await ScrapeLogService.isRunning(SOURCE, STATE)) {
		const { projects, total } = await ProjectService.getProjectsByState(STATE, { search, take: 10000 });
		return json({ success: true, data: projects, total, cached: true, scraping: true });
	}

	const log = await ScrapeLogService.startScrapeLog(SOURCE, STATE);

	try {
		let allProjects = [];
		let totalPersisted = 0;
		let pageNum = 1;
		const PAGE_SIZE = 500;
		const MAX_PAGES = 50;

		while (pageNum <= MAX_PAGES) {
			const { rows, totalRecords } = await fetchProjectPage(PAGE_SIZE, pageNum, {
				projectTypeId
			});
			allProjects.push(...rows);
			console.log(
				`[MP RERA Projects] Page ${pageNum}: ${rows.length} rows (total: ${allProjects.length} of ${totalRecords})`
			);

			// Persist each batch immediately — link projects to companies via promoterName
			if (rows.length > 0) {
				try {
					const count = await ProjectService.upsertProjects(
						STATE,
						rows.map((p) => ({
							...p,
							reraRegNo: extractProjectId(p.detailUrl) || `MP-${p.projectName?.substring(0, 30)}-${p.promoterName?.substring(0, 20)}`.replace(/\s+/g, '-'),
							name: p.projectName,
							promoterName: p.promoterName // Used by ProjectService to link to Company
						})),
						{ role: 'promoter' }
					);
					totalPersisted += count;
				} catch (dbErr) {
					console.warn(`[MP RERA Projects] DB persist failed for page ${pageNum}:`, dbErr.message);
				}
			}

			if (rows.length < PAGE_SIZE || (totalRecords > 0 && allProjects.length >= totalRecords)) break;
			pageNum++;
			await new Promise((r) => setTimeout(r, 500));
		}

		await ScrapeLogService.completeScrapeLog(log.id, { totalItems: totalPersisted });
		console.log(`[MP RERA Projects] Total: ${allProjects.length} scraped, ${totalPersisted} persisted`);

		const { projects: dbProjects, total } = await ProjectService.getProjectsByState(STATE, {
			search,
			take: 10000
		});
		return json({ success: true, data: dbProjects, total, scraped: totalPersisted });
	} catch (scrapeError) {
		await ScrapeLogService.completeScrapeLog(log.id, { error: scrapeError.message });
		console.error('[MP RERA Projects] Scrape failed:', scrapeError.message);

		const { projects: dbProjects, total } = await ProjectService.getProjectsByState(STATE, {
			search,
			take: 10000
		});
		if (dbProjects.length > 0) {
			return json({
				success: true,
				data: dbProjects,
				total,
				cached: true,
				scrapeError: scrapeError.message
			});
		}
		return json({ success: false, error: scrapeError.message }, { status: 500 });
	}
}

async function getProjectsByDistrict(districtName, search, forceRefresh, projectTypeId = '') {
	// Resolve district code
	const districtCode = MP_DISTRICTS[districtName] || '';

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

	// Scrape district-specific projects
	try {
		let districtProjects = [];
		let pageNum = 1;
		const PAGE_SIZE = 500;
		const MAX_PAGES = 50;

		while (pageNum <= MAX_PAGES) {
			const { rows, totalRecords } = await fetchProjectPage(PAGE_SIZE, pageNum, {
				districtCode,
				projectTypeId
			});

			// Set district for each row
			for (const row of rows) {
				row.district = row.district || districtName;
			}
			districtProjects.push(...rows);

			if (rows.length < PAGE_SIZE || (totalRecords > 0 && districtProjects.length >= totalRecords)) break;
			pageNum++;
			await new Promise((r) => setTimeout(r, 500));
		}

		console.log(`[MP RERA Projects] ${districtName} (code=${districtCode}): ${districtProjects.length} projects`);

		// Persist to DB — link projects to companies via promoterName
		if (districtProjects.length > 0) {
			try {
				await ProjectService.upsertProjects(
					STATE,
					districtProjects.map((p) => ({
						...p,
						reraRegNo: extractProjectId(p.detailUrl) || `MP-${districtName}-${p.projectName?.substring(0, 30)}`.replace(/\s+/g, '-'),
						name: p.projectName,
						district: p.district || districtName,
						promoterName: p.promoterName
					})),
					{ role: 'promoter' }
				);
			} catch (dbErr) {
				console.warn('[MP RERA Projects] DB persist failed:', dbErr.message);
			}
		}

		return json({
			success: true,
			data: districtProjects,
			total: districtProjects.length,
			district: districtName
		});
	} catch (error) {
		console.error(`[MP RERA Projects] Scrape error for ${districtName}:`, error.message);

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

		return json(
			{ success: false, error: error.message || 'Failed to scrape project data' },
			{ status: 500 }
		);
	}
}
