// src/routes/api/up-rera-projects/+server.js
import puppeteer from 'puppeteer';
import { json } from '@sveltejs/kit';
import { ProjectService, ScrapeLogService } from '$lib/server/services/index.js';

const STATE = 'UP';
const SOURCE = 'up-rera-projects';
const CACHE_DURATION = 1000 * 60 * 60; // 1 hour

// UP districts list for RERA
const UP_DISTRICTS = [
	'Agra', 'Aligarh', 'Allahabad', 'Ambedkar Nagar', 'Amethi', 'Amroha',
	'Auraiya', 'Ayodhya', 'Azamgarh', 'Baghpat', 'Bahraich', 'Ballia',
	'Balrampur', 'Banda', 'Barabanki', 'Bareilly', 'Basti', 'Bijnor',
	'Budaun', 'Bulandshahr', 'Chandauli', 'Chitrakoot', 'Deoria', 'Etah',
	'Etawah', 'Farrukhabad', 'Fatehpur', 'Firozabad', 'Gautam Buddha Nagar',
	'Ghaziabad', 'Ghazipur', 'Gonda', 'Gorakhpur', 'Hamirpur', 'Hapur',
	'Hardoi', 'Hathras', 'Jalaun', 'Jaunpur', 'Jhansi', 'Kannauj',
	'Kanpur Dehat', 'Kanpur Nagar', 'Kasganj', 'Kaushambi', 'Kushinagar',
	'Lakhimpur Kheri', 'Lalitpur', 'Lucknow', 'Maharajganj', 'Mahoba',
	'Mainpuri', 'Mathura', 'Mau', 'Meerut', 'Mirzapur', 'Moradabad',
	'Muzaffarnagar', 'Pilibhit', 'Pratapgarh', 'Raebareli', 'Rampur',
	'Saharanpur', 'Sambhal', 'Sant Kabir Nagar', 'Shahjahanpur', 'Shamli',
	'Shravasti', 'Siddharthnagar', 'Sitapur', 'Sonbhadra', 'Sultanpur',
	'Unnao', 'Varanasi'
];

/**
 * Scrape project rows from the current grid page.
 * /projects page columns: SNo, Reg.Number, Project Name, Promoter, District, Type, View Detail, View Cert
 */
async function scrapeCurrentPage(page) {
	return page.evaluate(() => {
		const results = [];
		const dataTable =
			document.querySelector('#ctl00_ContentPlaceHolder1_GridView1') ||
			document.querySelector('[id*="GridView"]') ||
			document.querySelector('[id*="grd"]') ||
			(() => {
				const tables = document.querySelectorAll('table');
				for (const t of tables) {
					if (t.querySelectorAll('tr').length > 3) return t;
				}
				return null;
			})();

		if (!dataTable) return { rows: results, hasNext: false, nextPageArg: null, gridId: null };

		const allRows = Array.from(
			dataTable.querySelectorAll(':scope > tbody > tr, :scope > tr')
		);

		for (const row of allRows) {
			const cells = row.querySelectorAll('td');
			if (cells.length < 5) continue;
			// Skip pager rows
			if (row.querySelector('table')) continue;

			const getText = (cell) =>
				(cell?.querySelector('span')?.innerText || cell?.innerText || '').trim();

			const sno = getText(cells[0]);
			if (!sno || isNaN(parseInt(sno))) continue;

			const projectRegNo = getText(cells[1]);
			const projectName = getText(cells[2]);

			// Promoter name — clean "Promoter\n\nACTUAL NAME" pattern
			let promoterName = getText(cells[3]);
			if (promoterName) {
				promoterName = promoterName
					.replace(/^Promoter\s*/i, '')
					.replace(/\n+/g, ' ')
					.replace(/\s+/g, ' ')
					.trim();
			}

			const district = getText(cells[4]);
			const projectType = getText(cells[5]);

			// View Detail link
			const viewDetailLink = cells[6]?.querySelector('a');
			const viewDetailHref = viewDetailLink ? (viewDetailLink.getAttribute('href') || '') : '';
			const viewDetailPostback = (() => {
				const match = viewDetailHref.match(/__doPostBack\('([^']+)'/);
				return match ? match[1] : '';
			})();
			let detailUrl = '';
			if (viewDetailLink) {
				const href = viewDetailLink.href || viewDetailLink.getAttribute('href') || '';
				if (href && !href.startsWith('javascript:')) detailUrl = href;
			}

			// View Certificate link
			const viewCertLink = cells[7]?.querySelector('a');
			let certificateUrl = '';
			if (viewCertLink) {
				const href = viewCertLink.href || viewCertLink.getAttribute('href') || '';
				if (href && !href.startsWith('javascript:') && (href.endsWith('.pdf') || href.includes('certificate'))) {
					certificateUrl = href;
				}
			}

			const project = {
				projectRegNo,
				projectName,
				promoterName,
				district,
				projectType,
				viewDetailPostback,
				detailUrl,
				certificateUrl,
				rowIndex: parseInt(sno)
			};
			if (projectName || projectRegNo) results.push(project);
		}

		// Detect next page
		let hasNext = false;
		let nextPageArg = null;
		const pagerTable = dataTable.querySelector('tr td table');
		if (pagerTable) {
			const currentSpan = pagerTable.querySelector('td > span');
			const currentNum = currentSpan ? parseInt(currentSpan.textContent.trim()) : 0;
			const pageLinks = pagerTable.querySelectorAll('td > a');
			for (const link of pageLinks) {
				const href = link.getAttribute('href') || '';
				const match = href.match(/Page\$(\w+)/);
				if (match) {
					const val = match[1];
					if (val === 'Next') {
						hasNext = true;
						nextPageArg = 'Page$Next';
						break;
					}
					const num = parseInt(val);
					if (!isNaN(num) && num > currentNum) {
						hasNext = true;
						nextPageArg = `Page$${val}`;
						break;
					}
				}
			}
		}

		const gridId = dataTable.id ? dataTable.id.replace(/_/g, '$') : null;
		return { rows: results, hasNext, nextPageArg, gridId };
	});
}

export async function GET({ url }) {
	const district = url?.searchParams?.get('district');
	const projectId = url?.searchParams?.get('projectId');
	const rowIndex = url?.searchParams?.get('rowIndex');
	const action = url?.searchParams?.get('action') || 'list';
	const forceRefresh = url?.searchParams?.get('refresh') === 'true';

	// Action: list districts
	if (action === 'districts') {
		return json({ success: true, data: UP_DISTRICTS });
	}

	// Action: get project details by postback
	if (action === 'details' && district && rowIndex) {
		return await getProjectDetailsByPostback(district, parseInt(rowIndex, 10));
	}

	// Action: get project details by direct ID
	if (action === 'details' && projectId) {
		return await getProjectDetailsByDirectId(projectId);
	}

	// Action: bulk scrape all projects from /projects page
	if (action === 'scrape-all' || (action === 'list' && !district && forceRefresh)) {
		return await scrapeAllProjects(url);
	}

	// Action: list projects by district
	if (action === 'list' && district) {
		return await getProjectsByDistrict(district, forceRefresh);
	}

	// Action: list all projects from DB (no district filter)
	if (action === 'list' && !district) {
		const search = url?.searchParams?.get('search') || '';
		const { projects, total } = await ProjectService.getProjectsByState(STATE, { search, take: 5000 });
		return json({ success: true, data: projects, total, cached: true });
	}

	return json(
		{
			success: false,
			error: 'Provide ?action=districts, ?action=list&district=<name>, ?action=scrape-all&refresh=true, or ?action=details&projectId=<id>'
		},
		{ status: 400 }
	);
}

/**
 * Scrape ALL projects by iterating every UP district.
 * /projects URL is on maintenance, so we use per-district pages which load all rows at once.
 */
async function scrapeAllProjects(reqUrl) {
	const search = reqUrl?.searchParams?.get('search') || '';

	// Check if scrape already running
	if (await ScrapeLogService.isRunning(SOURCE, STATE)) {
		const { projects, total } = await ProjectService.getProjectsByState(STATE, { search, take: 10000 });
		return json({ success: true, data: projects, total, cached: true, scraping: true });
	}

	const log = await ScrapeLogService.startScrapeLog(SOURCE, STATE);
	let browser;

	try {
		browser = await puppeteer.launch({
			headless: true,
			args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
			protocolTimeout: 600000
		});

		const page = await browser.newPage();
		await page.setViewport({ width: 1280, height: 900 });
		await page.setUserAgent(
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36'
		);

		let allProjects = [];
		let totalPersisted = 0;

		// Iterate every district
		for (let di = 0; di < UP_DISTRICTS.length; di++) {
			const dist = UP_DISTRICTS[di];
			console.log(`[UP RERA Projects] Scraping district ${di + 1}/${UP_DISTRICTS.length}: ${dist}...`);

			try {
				const targetUrl = `https://www.up-rera.in/frm_allprojectdistrictwise.aspx?districtname=${encodeURIComponent(dist)}`;
				await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });
				await new Promise((r) => setTimeout(r, 2000));

				// Each district page loads all rows at once (no pagination), but handle pagination just in case
				let districtProjects = [];
				let pageNum = 1;
				const MAX_PAGES = 200;

				while (pageNum <= MAX_PAGES) {
					const { rows, hasNext, nextPageArg, gridId } = await scrapeCurrentPage(page);
					// Set district for each row
					for (const row of rows) {
						row.district = row.district || dist;
					}
					districtProjects.push(...rows);

					if (!hasNext || !nextPageArg || !gridId) break;

					try {
						await Promise.all([
							page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }),
							page.evaluate((id, arg) => { __doPostBack(id, arg); }, gridId, nextPageArg)
						]);
						await new Promise((r) => setTimeout(r, 2000));
						pageNum++;
					} catch { break; }
				}

				console.log(`[UP RERA Projects] ${dist}: ${districtProjects.length} projects`);

				// Persist each district batch immediately to avoid losing data
				if (districtProjects.length > 0) {
					try {
						const count = await ProjectService.upsertProjects(STATE, districtProjects.map((p) => ({
							...p,
							reraRegNo: p.projectRegNo,
							name: p.projectName
						})));
						totalPersisted += count;
					} catch (dbErr) {
						console.warn(`[UP RERA Projects] DB persist failed for ${dist}:`, dbErr.message);
					}
				}

				allProjects.push(...districtProjects);
			} catch (distErr) {
				console.log(`[UP RERA Projects] Failed for ${dist}:`, distErr.message);
			}
		}

		await browser.close();
		browser = null;

		await ScrapeLogService.completeScrapeLog(log.id, { totalItems: totalPersisted });
		console.log(`[UP RERA Projects] Total: ${allProjects.length} scraped, ${totalPersisted} persisted across ${UP_DISTRICTS.length} districts`);

		const { projects: dbProjects, total } = await ProjectService.getProjectsByState(STATE, {
			search,
			take: 10000
		});
		return json({ success: true, data: dbProjects, total, scraped: totalPersisted });
	} catch (scrapeError) {
		if (browser) await browser.close();
		await ScrapeLogService.completeScrapeLog(log.id, { error: scrapeError.message });

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
		throw scrapeError;
	}
}

/**
 * Get projects for a specific district — scrapes per-district page with pagination
 */
async function getProjectsByDistrict(district, forceRefresh = false) {
	// Try DB first
	if (!forceRefresh) {
		try {
			const { projects, total } = await ProjectService.getProjectsByState(STATE, { district, take: 5000 });
			if (projects.length > 0) {
				return json({ success: true, data: projects, total, cached: true, district });
			}
		} catch {}
	}

	let browser;
	try {
		browser = await puppeteer.launch({
			headless: true,
			args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
			protocolTimeout: 120000
		});

		const page = await browser.newPage();
		await page.setViewport({ width: 1280, height: 900 });
		await page.setUserAgent(
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36'
		);

		const targetUrl = `https://www.up-rera.in/frm_allprojectdistrictwise.aspx?districtname=${encodeURIComponent(district)}`;
		await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });
		await new Promise((r) => setTimeout(r, 3000));

		let projects = [];
		let pageNum = 1;
		const MAX_PAGES = 200;

		while (pageNum <= MAX_PAGES) {
			const { rows, hasNext, nextPageArg, gridId } = await scrapeCurrentPage(page);
			projects.push(...rows);

			if (!hasNext || !nextPageArg || !gridId) break;

			try {
				await Promise.all([
					page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }),
					page.evaluate((id, arg) => { __doPostBack(id, arg); }, gridId, nextPageArg)
				]);
				await new Promise((r) => setTimeout(r, 2000));
				pageNum++;
			} catch { break; }
		}

		await browser.close();

		// Set district for each project
		projects = projects.map((p) => ({ ...p, district: p.district || district }));

		// Persist to DB
		try {
			await ProjectService.upsertProjects(STATE, projects.map((p) => ({
				...p,
				reraRegNo: p.projectRegNo,
				name: p.projectName
			})));
		} catch (dbErr) {
			console.warn('[UP Projects] DB persist failed:', dbErr.message);
		}

		return json({
			success: true,
			data: projects,
			total: projects.length,
			district
		});
	} catch (error) {
		console.error(`Project scraping error for ${district}:`, error.message);
		if (browser) await browser.close();

		// Fallback: try DB
		try {
			const { projects: dbProjects, total } = await ProjectService.getProjectsByState(STATE, { district, take: 5000 });
			if (dbProjects.length > 0) {
				return json({ success: true, data: dbProjects, total, cached: true, district });
			}
		} catch {}

		return json(
			{ success: false, error: error.message || 'Failed to scrape project data' },
			{ status: 500 }
		);
	}
}

async function launchBrowser() {
	return puppeteer.launch({
		headless: true,
		args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
		protocolTimeout: 120000
	});
}

async function createPage(browser) {
	const page = await browser.newPage();
	await page.setViewport({ width: 1280, height: 900 });
	await page.setUserAgent(
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36'
	);
	return page;
}

/**
 * Get project details by navigating to the district page and clicking postback
 */
async function getProjectDetailsByPostback(district, rowIndex) {
	let browser;
	try {
		browser = await launchBrowser();
		const page = await createPage(browser);

		const targetUrl = `https://www.up-rera.in/frm_allprojectdistrictwise.aspx?districtname=${encodeURIComponent(district)}`;
		await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });
		await new Promise((r) => setTimeout(r, 3000));

		const postbackTarget = await page.evaluate((rowIndex) => {
			const table =
				document.querySelector('#ctl00_ContentPlaceHolder1_GridView1') ||
				document.querySelector('[id*="GridView"]');
			if (!table) return null;

			const rows = Array.from(table.querySelectorAll('tr'));
			if (rowIndex >= rows.length) return null;

			const row = rows[rowIndex];
			const links = row.querySelectorAll('a');
			for (const a of links) {
				const href = a.getAttribute('href') || '';
				if (href.includes('LnkView') && !href.includes('LnkViewregcer')) {
					const match = href.match(/__doPostBack\('([^']+)'/);
					if (match) return match[1];
				}
			}
			return null;
		}, rowIndex);

		if (!postbackTarget) {
			await browser.close();
			return json(
				{ success: false, error: `No view detail link found for row ${rowIndex}` },
				{ status: 404 }
			);
		}

		await Promise.all([
			page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }),
			page.evaluate((target) => { __doPostBack(target, ''); }, postbackTarget)
		]);

		await new Promise((r) => setTimeout(r, 3000));
		const details = await extractProjectDetails(page);
		await browser.close();

		return json({ success: true, data: details });
	} catch (error) {
		console.error(`Project detail postback error:`, error.message);
		if (browser) await browser.close();
		return json(
			{ success: false, error: error.message || 'Failed to fetch project details' },
			{ status: 500 }
		);
	}
}

/**
 * Get project details by direct URL
 */
async function getProjectDetailsByDirectId(projectId) {
	let browser;
	try {
		browser = await launchBrowser();
		const page = await createPage(browser);

		await page.goto(
			`https://www.up-rera.in/Frm_View_Project_Details.aspx?id=${encodeURIComponent(projectId)}`,
			{ waitUntil: 'networkidle2', timeout: 60000 }
		);
		await new Promise((r) => setTimeout(r, 3000));

		const details = await extractProjectDetails(page);
		await browser.close();

		return json({ success: true, data: details, projectId });
	} catch (error) {
		console.error(`Project detail error for ${projectId}:`, error.message);
		if (browser) await browser.close();
		return json(
			{ success: false, error: error.message || 'Failed to scrape project details' },
			{ status: 500 }
		);
	}
}

/**
 * Extract all project details from a project detail page.
 */
async function extractProjectDetails(page) {
	const raw = await page.evaluate(() => {
		const data = {};

		document.querySelectorAll('span[id*="ContentPlaceHolder1"]').forEach((span) => {
			const value = span.innerText.trim();
			if (value) {
				const key = span.id
					.replace('ctl00_ContentPlaceHolder1_', '')
					.replace(/^lbl/, '')
					.replace(/^txt/, '');
				data[key] = value;
			}
		});

		document
			.querySelectorAll(
				'input[id*="ContentPlaceHolder1"][type="text"], input[id*="ContentPlaceHolder1"][readonly]'
			)
			.forEach((input) => {
				const value = input.value.trim();
				if (value) {
					const key = input.id
						.replace('ctl00_ContentPlaceHolder1_', '')
						.replace(/^lbl/, '')
						.replace(/^txt/, '');
					data[key] = value;
				}
			});

		const sectionData = {};
		document.querySelectorAll('.panel, .card, fieldset, [id*="Panel"]').forEach((section) => {
			const heading =
				section
					.querySelector('.panel-heading, .card-header, legend, h3, h4')
					?.innerText?.trim() || '';
			if (!heading) return;
			const pairs = {};
			section.querySelectorAll('label, .label, span[id*="lbl"]').forEach((label) => {
				const labelText = label.innerText.trim().replace(/:$/, '');
				const nextEl = label.nextElementSibling;
				if (labelText && nextEl) {
					pairs[labelText] = nextEl.innerText.trim();
				}
			});
			if (Object.keys(pairs).length > 0) {
				sectionData[heading] = pairs;
			}
		});

		const tableSections = {};
		document.querySelectorAll('table[id*="grd"], table[id*="Grid"]').forEach((table) => {
			if (table.id.includes('GridView1') && table.querySelectorAll('tr').length > 50) return;

			const tableId = table.id.replace('ctl00_ContentPlaceHolder1_', '');
			const rows = Array.from(table.querySelectorAll('tr'));
			const headers = Array.from(rows[0]?.querySelectorAll('th') || []).map((th) =>
				th.innerText.trim()
			);
			if (headers.length === 0) return;

			const tableData = [];
			for (let i = 1; i < rows.length; i++) {
				const cells = rows[i].querySelectorAll('td');
				const row = {};
				Array.from(cells).forEach((cell, idx) => {
					row[headers[idx] || `col${idx}`] = cell.innerText.trim();
				});
				if (Object.values(row).some((v) => v)) {
					tableData.push(row);
				}
			}
			if (tableData.length > 0) {
				tableSections[tableId] = tableData;
			}
		});

		return {
			fields: data,
			sections: sectionData,
			tables: tableSections,
			pageTitle: document.title,
			currentUrl: window.location.href
		};
	});

	const organized = {
		projectInfo: {},
		promoterInfo: {},
		locationInfo: {},
		financialInfo: {},
		propertyDetails: raw.tables,
		sections: raw.sections,
		allFields: raw.fields,
		pageTitle: raw.pageTitle,
		sourceUrl: raw.currentUrl
	};

	for (const [key, value] of Object.entries(raw.fields)) {
		const lk = key.toLowerCase();
		if (lk.includes('promoter') || lk.includes('applicant') || lk.includes('chairman') || lk.includes('director')) {
			organized.promoterInfo[key] = value;
		} else if (lk.includes('district') || lk.includes('tehsil') || lk.includes('village') || lk.includes('address') || lk.includes('location') || lk.includes('state') || lk.includes('pin')) {
			organized.locationInfo[key] = value;
		} else if (lk.includes('cost') || lk.includes('fee') || lk.includes('bank') || lk.includes('account') || lk.includes('ifsc') || lk.includes('amount')) {
			organized.financialInfo[key] = value;
		} else {
			organized.projectInfo[key] = value;
		}
	}

	return organized;
}
