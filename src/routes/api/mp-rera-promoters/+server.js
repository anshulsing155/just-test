// src/routes/api/mp-rera-promoters/+server.js
//
// MP RERA promoter data:
//   Listing: promoter-loop.php?show={n}&pagenum={p}&search_txt={q}&project_type_id={t}
//   Detail:  view_promoter_details.php?id=<base64>
//
// Detail page sections:
//   1. Promoter Information — key/value pairs in Bootstrap grid (col-md-3 label / col-md-9 value)
//   2. Partner Details (or Director Details) — partner blocks with photo, name, email, address
//   3. Project List — table with columns: SNo, Project Name, Type, District-Area, RERA Reg No, Valid From, Details link
//
// Total records: ~4,045

import axios from 'axios';
import * as cheerio from 'cheerio';
import { json } from '@sveltejs/kit';
import https from 'https';
import { CompanyService, ProjectService, ScrapeLogService } from '$lib/server/services/index.js';

const BASE_URL = 'https://www.rera.mp.gov.in';
const PROMOTER_LOOP_URL = `${BASE_URL}/promoter-loop.php`;

const STATE = 'MP';
const SOURCE = 'mp-rera-promoters';

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const HEADERS = {
	'User-Agent':
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36',
	Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
	'Accept-Language': 'en-US,en;q=0.9',
	Referer: `${BASE_URL}/promoters/`
};

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
 * Fetch a page of promoters from the AJAX endpoint.
 */
async function fetchPromoterPage(pageSize = 200, pageNum = 1, searchText = '', typeId = '') {
	const url = `${PROMOTER_LOOP_URL}?show=${pageSize}&pagenum=${pageNum}&search_txt=${encodeURIComponent(searchText)}&project_type_id=${encodeURIComponent(typeId)}`;
	console.log(`[MP RERA Promoters] Fetching page ${pageNum} (size=${pageSize})`);

	const html = await fetchHtml(url);
	const $ = cheerio.load(html);

	const promoters = [];

	// Extract total records
	let totalRecords = 0;
	const totalText = $('.total_rec, .total-records').text() || $('body').text();
	const totalMatch = totalText.match(/Total\s*Records?\s*[:\-]?\s*([\d,]+)/i);
	if (totalMatch) {
		totalRecords = parseInt(totalMatch[1].replace(/,/g, ''), 10);
	}

	// Parse table rows — Columns: S.No. | Name | Type | Address | View
	const rows = $('table#example tbody tr, table tbody tr, table tr').filter((_, row) => {
		return $(row).find('td').length >= 4;
	});

	console.log(`[MP RERA Promoters] Found ${rows.length} rows, total records: ${totalRecords}`);

	rows.each((idx, row) => {
		const cells = $(row).find('td');
		if (cells.length < 4) return;

		const sno = $(cells[0]).text().trim();
		if (!sno || isNaN(parseInt(sno.replace('.', '')))) return;

		const promoterName = $(cells[1]).text().trim();
		const promoterType = $(cells[2]).text().trim();
		const address = $(cells[3]).text().trim();

		// Detail link
		let detailUrl = '';
		const detailLink = $(row).find('a[href*="view_promoter_details"]').first();
		if (detailLink.length) {
			const href = detailLink.attr('href') || '';
			detailUrl = href.startsWith('http') ? href : `${BASE_URL}/${href.replace(/^\//, '')}`;
		}

		// Parse district from address
		let district = '';
		const addrParts = address.split(',').map((p) => p.trim());
		if (addrParts.length >= 3) {
			const mpIdx = addrParts.findIndex((p) =>
				p.toLowerCase().includes('madhya pradesh') || p.toLowerCase() === 'mp' || p.toLowerCase() === 'm.p.'
			);
			if (mpIdx > 0) {
				district = addrParts[mpIdx - 1];
			}
		}

		if (promoterName) {
			promoters.push({
				promoterName,
				applicantType: promoterType,
				address,
				district,
				detailUrl
			});
		}
	});

	return { rows: promoters, totalRecords };
}

/**
 * Scrape a single promoter detail page.
 *
 * Page structure:
 *   - "Promoter Information" section: Bootstrap grid rows (col-md-3 <b>label:</b> / col-md-9 value)
 *   - "Partner Details" section: partner blocks with image + name/email/address
 *   - "Project List" section: table with project info
 */
async function scrapePromoterDetail(detailUrl) {
	try {
		const html = await fetchHtml(detailUrl);
		const $ = cheerio.load(html);

		const detail = {
			email: '',
			mobile: '',
			partnershipType: '',
			isNewEntity: '',
			registrationCertificateUrl: '',
			parentName: '',
			parentExperience: '',
			parentAddress: '',
			partners: [],
			projects: []
		};

		// ── 1. Promoter Information ──
		// Each field: <div class="row"><div class="col-md-3"><b>Label :</b></div><div class="col-md-9">Value</div></div>
		// Also handles col-sm-3 / col-sm-9 variant
		$('article#font-size .row, .wrapper3 .row').each((_, row) => {
			const labelEl = $(row).find('.col-md-3 b, .col-sm-3 b').first();
			const valueEl = $(row).find('.col-md-9, .col-sm-9').first();

			if (!labelEl.length || !valueEl.length) return;

			const label = labelEl.text().trim().replace(/\s*:\s*$/, '').toLowerCase();
			const value = valueEl.text().trim();

			if (!label) return;

			if (label.includes('email') && !label.includes('partner')) {
				detail.email = value;
			} else if (label.includes('mobile') || label.includes('phone')) {
				detail.mobile = value;
			} else if (label.includes('partnership type') || label.includes('applicant type')) {
				detail.partnershipType = value;
			} else if (label.includes('new entity')) {
				detail.isNewEntity = value;
			} else if (label.includes('registration certificate')) {
				const certLink = valueEl.find('a').first();
				if (certLink.length) {
					const href = certLink.attr('href') || '';
					detail.registrationCertificateUrl = href.startsWith('http') ? href : `${BASE_URL}/${href.replace(/^\//, '')}`;
				}
			} else if (label.includes('parent name')) {
				detail.parentName = value;
			} else if (label.includes('parent experience')) {
				detail.parentExperience = value;
			} else if (label.includes('parent address')) {
				detail.parentAddress = value;
			}
		});

		// ── 2. Partner / Director Details ──
		// Section header: <div class="h3 text-center title">Partner Details</div>
		// Each partner: col-md-12 > col-md-4 (image) + col-md-8 (details with name/email/address)
		const partnerSection = $('div.h3.title').filter((_, el) => {
			const text = $(el).text().toLowerCase();
			return text.includes('partner') || text.includes('director') || text.includes('proprietor');
		}).first();

		if (partnerSection.length) {
			const partnerContainer = partnerSection.nextAll('.row').first();
			// Partners are separated by <hr/> tags — each partner is a col-md-12 block
			const partnerBlocks = partnerContainer.find('.col-md-12').length > 0
				? partnerContainer.find('.col-md-12')
				: partnerContainer.parent().find('.col-md-12');

			partnerBlocks.each((_, block) => {
				const partner = { name: '', email: '', address: '', imageUrl: '' };

				// Image
				const img = $(block).find('img.partner-image, img.img-responsive').first();
				if (img.length) {
					partner.imageUrl = img.attr('src') || '';
				}

				// Name, Email, Address — in col-md-4 label / col-md-8 value pairs
				$(block).find('.row').each((__, pRow) => {
					const pLabel = $(pRow).find('.col-md-4 b').first().text().trim().replace(/\s*:\s*$/, '').toLowerCase();
					const pValue = $(pRow).find('.col-md-8').first().text().trim();
					if (!pLabel) return;

					if (pLabel.includes('name')) partner.name = pValue;
					else if (pLabel.includes('email')) partner.email = pValue;
					else if (pLabel.includes('address')) partner.address = pValue;
				});

				if (partner.name) {
					detail.partners.push(partner);
				}
			});
		}

		// ── 3. Project List ──
		// Table columns: SNo | Project Name | Type | District-Area | RERA Reg No | Valid From | Details link
		const projectSection = $('div.h3.title').filter((_, el) => {
			return $(el).text().toLowerCase().includes('project');
		}).first();

		if (projectSection.length) {
			const projectTable = projectSection.nextAll('table').first().length
				? projectSection.nextAll('table').first()
				: projectSection.parent().find('table').first();

			projectTable.find('tbody tr').each((_, row) => {
				const cells = $(row).find('td');
				if (cells.length < 5) return;

				const sno = $(cells[0]).text().trim();
				if (!sno || isNaN(parseInt(sno.replace('.', '')))) return;

				const projectName = $(cells[1]).text().trim();
				const projectType = $(cells[2]).text().trim();
				const districtArea = $(cells[3]).text().trim().replace(/\u00a0/g, ' ');
				const reraRegNo = $(cells[4]).text().trim();
				const validFrom = cells.length > 5 ? $(cells[5]).text().trim() : '';

				// Detail link
				let projectDetailUrl = '';
				const projLink = $(row).find('a[href*="view_project_details"]').first();
				if (projLink.length) {
					const href = projLink.attr('href') || '';
					projectDetailUrl = href.startsWith('http') ? href : `${BASE_URL}/${href.replace(/^\//, '')}`;
				}

				if (projectName || reraRegNo) {
					detail.projects.push({
						projectName,
						projectType,
						districtArea,
						reraRegNo,
						validFrom,
						detailUrl: projectDetailUrl
					});
				}
			});
		}

		return detail;
	} catch (err) {
		console.log(`[MP RERA Promoter Detail] Failed for ${detailUrl}: ${err.message}`);
		return null;
	}
}

export async function GET({ url }) {
	const forceRefresh = url?.searchParams?.get('refresh') === 'true';
	const search = url?.searchParams?.get('search') || '';
	// Single promoter detail fetch
	const detailUrl = url?.searchParams?.get('detailUrl') || '';

	// Action: fetch a single promoter's detail page
	if (detailUrl) {
		try {
			const detail = await scrapePromoterDetail(detailUrl);
			if (detail) {
				return json({ success: true, data: detail });
			}
			return json({ success: false, error: 'Failed to fetch promoter details' }, { status: 404 });
		} catch (error) {
			return json({ success: false, error: error.message }, { status: 500 });
		}
	}

	try {
		// Return cached DB data if not refreshing
		if (!forceRefresh) {
			const { companies, total } = await CompanyService.getCompaniesByState(STATE, {
				search,
				take: 5000
			});
			if (companies.length > 0) {
				return json({ success: true, data: companies, total, cached: true });
			}
			// DB empty — fall through to scrape
		}

		// Check if scrape already running
		if (await ScrapeLogService.isRunning(SOURCE, STATE)) {
			const { companies, total } = await CompanyService.getCompaniesByState(STATE, {
				search,
				take: 5000
			});
			return json({ success: true, data: companies, total, cached: true, scraping: true });
		}

		const log = await ScrapeLogService.startScrapeLog(SOURCE, STATE);

		try {
			let allPromoters = [];

			// Fetch all promoters from listing
			let pageNum = 1;
			const PAGE_SIZE = 500;
			const MAX_PAGES = 50;

			while (pageNum <= MAX_PAGES) {
				const { rows, totalRecords } = await fetchPromoterPage(PAGE_SIZE, pageNum);
				allPromoters.push(...rows);
				console.log(
					`[MP RERA Promoters] Page ${pageNum}: ${rows.length} rows (total: ${allPromoters.length} of ${totalRecords})`
				);

				if (rows.length < PAGE_SIZE || (totalRecords > 0 && allPromoters.length >= totalRecords)) break;
				pageNum++;
				await new Promise((r) => setTimeout(r, 500));
			}

			console.log(`[MP RERA Promoters] Listing scrape done: ${allPromoters.length} promoters`);

			// Scrape detail pages for every promoter (email, partners, projects)
			let detailCount = 0;
			let failCount = 0;
			for (const p of allPromoters) {
				if (!p.detailUrl) continue;
				try {
					const detail = await scrapePromoterDetail(p.detailUrl);
					if (detail) {
						// Merge detail data into the promoter record
						p.email = detail.email || '';
						p.mobile = detail.mobile || '';
						p.partnershipType = detail.partnershipType || '';
						p.isNewEntity = detail.isNewEntity || '';
						p.registrationCertificateUrl = detail.registrationCertificateUrl || '';
						p.parentName = detail.parentName || '';
						p.parentExperience = detail.parentExperience || '';
						p.parentAddress = detail.parentAddress || '';
						p.partners = detail.partners || [];
						p.projects = detail.projects || [];
						detailCount++;
					} else {
						failCount++;
					}
				} catch {
					failCount++;
				}

				// Small delay to avoid hammering the server
				await new Promise((r) => setTimeout(r, 200));

				if ((detailCount + failCount) % 100 === 0) {
					console.log(
						`[MP RERA Promoters] Detail progress: ${detailCount} scraped, ${failCount} failed (${detailCount + failCount}/${allPromoters.length})`
					);
				}
			}

			console.log(
				`[MP RERA Promoters] Detail scrape done: ${detailCount} success, ${failCount} failed`
			);

			// Persist to DB — store full detail data in rawData
			const count = await CompanyService.upsertCompanies(STATE, allPromoters, {
				role: 'promoter'
			});
			console.log(`[MP RERA Promoters] Persisted ${count} companies to DB`);

			// Create Project records and Company↔Project links from each promoter's projects[]
			let projectLinkCount = 0;
			for (const p of allPromoters) {
				if (!p.projects || p.projects.length === 0) continue;

				const companyName = p.promoterName || p.name || '';
				if (!companyName) continue;

				for (const proj of p.projects) {
					const reraRegNo = proj.reraRegNo || '';
					if (!reraRegNo) continue;

					try {
						// Parse district from districtArea (e.g., "Bhopal - Bhopal" → "Bhopal")
						let projDistrict = '';
						if (proj.districtArea && proj.districtArea.includes('-')) {
							projDistrict = proj.districtArea.split('-')[0].trim();
						} else {
							projDistrict = proj.districtArea || p.district || '';
						}

						// Upsert Project and link to Company by promoterName match
						await ProjectService.upsertProjects(STATE, [{
							reraRegNo,
							projectName: proj.projectName || '',
							projectType: proj.projectType || '',
							district: projDistrict,
							location: proj.districtArea || '',
							validUntil: proj.validFrom || '',
							promoterName: companyName
						}], { role: 'promoter' });

						projectLinkCount++;
					} catch (linkErr) {
						// Non-fatal: log and continue
						if (projectLinkCount < 5) {
							console.warn(`[MP RERA Promoters] Project link failed: ${linkErr.message}`);
						}
					}
				}
			}
			console.log(`[MP RERA Promoters] Linked ${projectLinkCount} projects to companies`);

			await ScrapeLogService.completeScrapeLog(log.id, { totalItems: count });

			const { companies, total } = await CompanyService.getCompaniesByState(STATE, {
				search,
				take: 5000
			});
			return json({ success: true, data: companies, total, scraped: count });
		} catch (scrapeErr) {
			await ScrapeLogService.completeScrapeLog(log.id, { error: scrapeErr.message });
			console.error('[MP RERA Promoters] Scrape failed:', scrapeErr.message);

			const { companies, total } = await CompanyService.getCompaniesByState(STATE, {
				search,
				take: 5000
			});
			if (companies.length > 0) {
				return json({
					success: true,
					data: companies,
					total,
					cached: true,
					scrapeError: scrapeErr.message
				});
			}
			throw scrapeErr;
		}
	} catch (error) {
		console.error('[MP RERA Promoters] Error:', error.message);
		return json(
			{ success: false, error: error.message || 'Failed to scrape MP RERA promoter data' },
			{ status: 500 }
		);
	}
}
