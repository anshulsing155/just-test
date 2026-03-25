// src/routes/api/delhi-rera-promoters/+server.js
import axios from 'axios';
import * as cheerio from 'cheerio';
import { json } from '@sveltejs/kit';
import https from 'https';
import { CompanyService, ProjectService, ScrapeLogService } from '$lib/server/services/index.js';

const BASE_URL = 'https://www.rera.delhi.gov.in';
const PROMOTER_LIST_URL = `${BASE_URL}/registered_promoters_list`;
const COMPLETED_LIST_URL = `${BASE_URL}/completed_project_list`;

// Skip SSL verification (Delhi RERA has cert issues)
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// Cache duration unused now — DB is the cache layer

function parsePromoterDetails(html) {
	// Format: "Name : VALUEAddress : VALUEEmail : VALUEPhone Number : VALUE"
	const result = { name: '', address: '', email: '', phone: '' };

	// Extract name
	const nameMatch = html.match(/Name\s*:\s*(.*?)(?=Address\s*:|$)/s);
	if (nameMatch) result.name = nameMatch[1].trim();

	// Extract address
	const addrMatch = html.match(/Address\s*:\s*(.*?)(?=Email\s*:|Phone\s*Number\s*:|$)/s);
	if (addrMatch) result.address = addrMatch[1].trim();

	// Extract email
	const emailMatch = html.match(/Email\s*:\s*(.*?)(?=Phone\s*Number\s*:|$)/s);
	if (emailMatch) result.email = emailMatch[1].trim();

	// Extract phone
	const phoneMatch = html.match(/Phone\s*Number\s*:\s*([\d\s+\-()]+)/);
	if (phoneMatch) result.phone = phoneMatch[1].trim();

	return result;
}

function parseProjectDetails(html) {
	const result = { name: '', location: '' };

	const nameMatch = html.match(/Name\s*:\s*(.*?)(?=Location\s*:|$)/s);
	if (nameMatch) result.name = nameMatch[1].trim();

	const locMatch = html.match(/Location\s*:\s*(.*)/s);
	if (locMatch) result.location = locMatch[1].trim();

	return result;
}

function parseRegistrationDetails(html) {
	const result = {
		registrationNo: '',
		validUntil: '',
		constructionStatus: '',
		certificateUrl: '',
		extensionCertificate: ''
	};

	const regMatch = html.match(/Registration\s*No\.\s*:\s*([\w\d]+)/);
	if (regMatch) result.registrationNo = regMatch[1].trim();

	const validMatch = html.match(/Valid\s*Until\s*:\s*([\d/]+)/);
	if (validMatch) result.validUntil = validMatch[1].trim();

	const statusMatch = html.match(/Construction\s*Status\s*:\s*(.*?)(?=Certificate\s*:|$)/s);
	if (statusMatch) result.constructionStatus = statusMatch[1].trim();

	const extMatch = html.match(/Extension\s*Certificate\s*:\s*(.*)/s);
	if (extMatch) result.extensionCertificate = extMatch[1].trim();

	return result;
}

async function fetchPage(url) {
	const response = await axios.get(url, {
		httpsAgent,
		timeout: 30000,
		// Delhi RERA Drupal site often returns 500 but still serves HTML
		validateStatus: (status) => status < 600,
		headers: {
			'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36',
			'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
			'Accept-Language': 'en-US,en;q=0.9'
		}
	});
	if (!response.data || typeof response.data !== 'string' || !response.data.includes('<html')) {
		throw new Error(`Failed to fetch page: HTTP ${response.status}`);
	}
	return response.data;
}

async function scrapePromoterList(url, type = 'registered') {
	const promoters = [];

	// Load all items at once
	const fullUrl = `${url}?items_per_page=All`;
	console.log(`[Delhi RERA] Fetching ${type} promoters from ${fullUrl}`);

	const html = await fetchPage(fullUrl);
	const $ = cheerio.load(html);

	const table = $('table.views-table');
	if (!table.length) {
		console.log(`[Delhi RERA] No table found for ${type}`);
		return promoters;
	}

	const rows = table.find('tbody tr');
	console.log(`[Delhi RERA] Found ${rows.length} ${type} rows`);

	// Detect column layout: registered has 5 cols, completed has 6 (extra "status" col at index 3)
	const colCount = table.find('thead th').length;
	const isExtendedLayout = colCount >= 6;

	rows.each((idx, row) => {
		const cells = $(row).find('td');
		if (cells.length < 4) return;

		// Column 0: S.No
		const srNo = $(cells[0]).text().trim();

		// Column 1: Promoter Details (Name, Address, Email, Phone)
		const promoterHtml = $(cells[1]).text().trim();
		const promoterInfo = parsePromoterDetails(promoterHtml);

		// Column 2: Project Details (Name, Location)
		const projectHtml = $(cells[2]).text().trim();
		const projectInfo = parseProjectDetails(projectHtml);

		let regInfo, certLink, qprLinks = [], completionStatus = '';

		if (isExtendedLayout) {
			// Completed layout: col3 = status ("Completed"), col4 = registration, col5 = QPR
			completionStatus = $(cells[3]).text().trim();

			const regCell = $(cells[4]);
			regInfo = parseRegistrationDetails(regCell.text().trim());
			certLink = regCell.find('a[href*="certification_document"]').attr('href');

			if (cells.length > 5) {
				$(cells[5]).find('a').each((_, a) => {
					const href = $(a).attr('href');
					if (href) qprLinks.push({ text: $(a).text().trim(), url: href.startsWith('http') ? href : `${BASE_URL}${href}` });
				});
			}
		} else {
			// Registered layout: col3 = registration, col4 = QPR
			const regCell = $(cells[3]);
			regInfo = parseRegistrationDetails(regCell.text().trim());
			certLink = regCell.find('a[href*="certification_document"]').attr('href');

			if (cells.length > 4) {
				$(cells[4]).find('a').each((_, a) => {
					const href = $(a).attr('href');
					if (href) qprLinks.push({ text: $(a).text().trim(), url: href.startsWith('http') ? href : `${BASE_URL}${href}` });
				});
			}
		}

		if (certLink) {
			regInfo.certificateUrl = certLink.startsWith('http') ? certLink : `${BASE_URL}${certLink}`;
		}

		const promoter = {
			srNo,
			promoterName: promoterInfo.name,
			promoterAddress: promoterInfo.address,
			promoterEmail: promoterInfo.email,
			promoterPhone: promoterInfo.phone,
			projectName: projectInfo.name,
			projectLocation: projectInfo.location,
			registrationNo: regInfo.registrationNo,
			validUntil: regInfo.validUntil,
			constructionStatus: completionStatus || regInfo.constructionStatus,
			certificateUrl: regInfo.certificateUrl,
			extensionCertificate: regInfo.extensionCertificate,
			qprLinks,
			type
		};

		if (promoter.promoterName || promoter.registrationNo) {
			promoters.push(promoter);
		}
	});

	return promoters;
}

const STATE = 'Delhi';
const SOURCE = 'delhi-rera-promoters';

export async function GET({ url }) {
	const forceRefresh = url?.searchParams?.get('refresh') === 'true';
	const type = url?.searchParams?.get('type') || 'all';
	const search = url?.searchParams?.get('search') || '';

	try {
		// Return cached DB data if not refreshing
		if (!forceRefresh) {
			const dbData = await getFromDb(search);
			if (dbData.length > 0) {
				const filtered = filterByType(dbData, type);
				return json({ success: true, data: filtered, total: filtered.length, cached: true });
			}
			// DB empty — fall through to scrape
		}

		// Check if scrape already running
		if (await ScrapeLogService.isRunning(SOURCE, STATE)) {
			const dbData = await getFromDb(search);
			const filtered = filterByType(dbData, type);
			return json({ success: true, data: filtered, total: filtered.length, cached: true, scraping: true });
		}

		const log = await ScrapeLogService.startScrapeLog(SOURCE, STATE);

		try {
			let registered = [];
			let completed = [];

			registered = await scrapePromoterList(PROMOTER_LIST_URL, 'registered');
			try {
				completed = await scrapePromoterList(COMPLETED_LIST_URL, 'completed');
			} catch (e) {
				console.log('[Delhi RERA] Failed to fetch completed projects:', e.message);
			}

			// Persist to DB
			const allData = [...registered, ...completed];
			const count = await CompanyService.upsertCompanies(STATE, allData, { role: 'promoter' });
			await ScrapeLogService.completeScrapeLog(log.id, { totalItems: count });
			console.log(`[Delhi RERA Promoters] Persisted ${count} companies to DB`);

			// Return freshly scraped data (already in frontend-expected format)
			const filtered = filterByType(allData, type);
			return json({ success: true, data: filtered, total: filtered.length, scraped: count });
		} catch (scrapeErr) {
			await ScrapeLogService.completeScrapeLog(log.id, { error: scrapeErr.message });
			console.error('[Delhi RERA Promoters] Scrape failed:', scrapeErr.message);

			// Fall back to DB data
			const dbData = await getFromDb(search);
			if (dbData.length > 0) {
				const filtered = filterByType(dbData, type);
				return json({ success: true, data: filtered, total: filtered.length, cached: true, scrapeError: scrapeErr.message });
			}
			throw scrapeErr;
		}
	} catch (error) {
		console.error('[Delhi RERA Promoters] Error:', error.message);
		return json(
			{ success: false, error: error.message || 'Failed to scrape Delhi RERA promoter data' },
			{ status: 500 }
		);
	}
}

/**
 * Get promoters from DB via Project model (each row = unique project-promoter pair).
 * rawData stores the original scraped object with frontend-expected field names.
 */
async function getFromDb(search) {
	const { projects } = await ProjectService.getProjectsByState(STATE, { search, take: 5000 });
	return projects
		.map((p) => {
			if (p.rawData && typeof p.rawData === 'object' && p.rawData.promoterName) {
				return p.rawData;
			}
			// Fallback: reconstruct from DB fields
			const company = p.companyLinks?.[0]?.company;
			return {
				promoterName: company?.name || '',
				promoterAddress: '',
				promoterEmail: '',
				promoterPhone: '',
				projectName: p.name || '',
				projectLocation: p.location || '',
				registrationNo: p.reraRegNo || '',
				validUntil: p.validUntil || '',
				constructionStatus: p.constructionStatus || '',
				certificateUrl: p.certificateUrl || '',
				extensionCertificate: p.extensionCertificate || '',
				type: 'registered'
			};
		})
		.filter((p) => p.promoterName || p.registrationNo);
}

function filterByType(data, type) {
	if (type === 'all') return data;
	return data.filter((p) => p.type === type);
}
