// src/routes/api/mp-rera-promoters/+server.js
import axios from 'axios';
import * as cheerio from 'cheerio';
import { json } from '@sveltejs/kit';
import https from 'https';
import { CompanyService, ScrapeLogService } from '$lib/server/services/index.js';

const BASE_URL = 'https://www.rera.mp.gov.in';
const PROMOTER_LIST_URL = `${BASE_URL}/promoters`;

const STATE = 'MP';
const SOURCE = 'mp-rera-promoters';

// Skip SSL verification (MP RERA may have cert issues)
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

async function fetchPage(url) {
	const response = await axios.get(url, {
		httpsAgent,
		timeout: 30000,
		validateStatus: (status) => status < 600,
		headers: {
			'User-Agent':
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36',
			Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
			'Accept-Language': 'en-US,en;q=0.9'
		}
	});
	if (!response.data || typeof response.data !== 'string') {
		throw new Error(`Failed to fetch page: HTTP ${response.status}`);
	}
	return response.data;
}

/**
 * Scrape promoters from the MP RERA promoters listing page.
 * The page renders an HTML table with promoter/builder details.
 */
async function scrapePromoterList(pageNum = 1) {
	const promoters = [];

	const url = pageNum > 1 ? `${PROMOTER_LIST_URL}?page=${pageNum}` : PROMOTER_LIST_URL;
	console.log(`[MP RERA Promoters] Fetching page ${pageNum}: ${url}`);

	const html = await fetchPage(url);
	const $ = cheerio.load(html);

	// Try common table selectors used by RERA sites
	const table =
		$('table.views-table').first() ||
		$('table.table').first() ||
		$('table').filter((_, el) => $(el).find('tbody tr').length > 2).first();

	if (!table || !table.length) {
		console.log('[MP RERA Promoters] No table found on page');
		return { rows: promoters, hasNext: false };
	}

	const rows = table.find('tbody tr');
	console.log(`[MP RERA Promoters] Found ${rows.length} rows on page ${pageNum}`);

	rows.each((idx, row) => {
		const cells = $(row).find('td');
		if (cells.length < 3) return;

		// Extract text from each cell, handling different possible column layouts
		const cellTexts = [];
		cells.each((_, cell) => {
			cellTexts.push($(cell).text().trim());
		});

		// Try to map columns based on common MP RERA table structure
		// Typical: SNo, RegNo, Name, Address, Contact, Type, Project, Status
		let promoter = {};

		if (cellTexts.length >= 7) {
			promoter = {
				registrationNo: cellTexts[1] || '',
				promoterName: cellTexts[2] || '',
				address: cellTexts[3] || '',
				mobile: '',
				email: '',
				applicantType: cellTexts[5] || '',
				projectName: cellTexts[6] || '',
				constructionStatus: cellTexts.length > 7 ? cellTexts[7] : ''
			};

			// Parse contact cell for phone/email
			const contactText = cellTexts[4] || '';
			const phoneMatch = contactText.match(/([\d]{10,})/);
			const emailMatch = contactText.match(/([^\s@]+@[^\s@]+\.[^\s@]+)/);
			if (phoneMatch) promoter.mobile = phoneMatch[1];
			if (emailMatch) promoter.email = emailMatch[1];
		} else if (cellTexts.length >= 4) {
			// Simpler layout
			promoter = {
				registrationNo: cellTexts[1] || '',
				promoterName: cellTexts[2] || '',
				address: cellTexts[3] || '',
				mobile: cellTexts.length > 4 ? cellTexts[4] : '',
				email: '',
				applicantType: cellTexts.length > 5 ? cellTexts[5] : ''
			};
		} else {
			return; // Skip rows with too few columns
		}

		// Also check for detail links
		const detailLink = $(cells).find('a[href]').first();
		if (detailLink.length) {
			const href = detailLink.attr('href') || '';
			promoter.detailUrl = href.startsWith('http') ? href : `${BASE_URL}${href}`;
		}

		if (promoter.promoterName || promoter.registrationNo) {
			promoters.push(promoter);
		}
	});

	// Check for pagination (next page link)
	let hasNext = false;
	const nextLink =
		$('.pager-next a, .pagination .next a, a[rel="next"], li.next a').first();
	if (nextLink.length) {
		hasNext = true;
	}

	return { rows: promoters, hasNext };
}

export async function GET({ url }) {
	const forceRefresh = url?.searchParams?.get('refresh') === 'true';
	const search = url?.searchParams?.get('search') || '';

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
			let pageNum = 1;
			const MAX_PAGES = 100;

			while (pageNum <= MAX_PAGES) {
				const { rows, hasNext } = await scrapePromoterList(pageNum);
				allPromoters.push(...rows);
				console.log(
					`[MP RERA Promoters] Page ${pageNum}: ${rows.length} rows (total: ${allPromoters.length})`
				);

				if (!hasNext || rows.length === 0) break;
				pageNum++;
			}

			// Persist to DB
			const count = await CompanyService.upsertCompanies(STATE, allPromoters, {
				role: 'promoter'
			});
			await ScrapeLogService.completeScrapeLog(log.id, { totalItems: count });
			console.log(`[MP RERA Promoters] Persisted ${count} companies to DB`);

			const { companies, total } = await CompanyService.getCompaniesByState(STATE, {
				search,
				take: 5000
			});
			return json({ success: true, data: companies, total, scraped: count });
		} catch (scrapeErr) {
			await ScrapeLogService.completeScrapeLog(log.id, { error: scrapeErr.message });
			console.error('[MP RERA Promoters] Scrape failed:', scrapeErr.message);

			// Fall back to DB data
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
