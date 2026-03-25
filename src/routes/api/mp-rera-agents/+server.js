// src/routes/api/mp-rera-agents/+server.js
import axios from 'axios';
import * as cheerio from 'cheerio';
import { json } from '@sveltejs/kit';
import https from 'https';
import { getMpReraAgents } from '$lib/server/agentData';
import { AgentService, ScrapeLogService } from '$lib/server/services/index.js';

const BASE_URL = 'https://www.rera.mp.gov.in';
const AGENTS_URL = `${BASE_URL}/agents`;

const STATE = 'MP';
const SOURCE = 'mp-rera-agents';

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
 * Scrape agents from the MP RERA website.
 * Page structure (DataTables):
 *   Columns: S.No. | Name | Address | Type | Registration No. | Validity | Details
 *   Pagination: ?page=N or DataTables server-side
 */
async function scrapeAgentsPage(pageNum = 1) {
	const agents = [];

	const url = pageNum > 1 ? `${AGENTS_URL}?page=${pageNum}` : AGENTS_URL;
	console.log(`[MP RERA Agents] Fetching page ${pageNum}: ${url}`);

	const html = await fetchPage(url);
	const $ = cheerio.load(html);

	// Find the data table — DataTables usually adds an ID or specific class
	const table =
		$('table#DataTables_Table_0').first().length ? $('table#DataTables_Table_0').first() :
		$('table.dataTable').first().length ? $('table.dataTable').first() :
		$('table.table').first().length ? $('table.table').first() :
		$('table').filter((_, el) => {
			const rows = $(el).find('tbody tr');
			return rows.length > 2;
		}).first();

	if (!table || !table.length) {
		console.log('[MP RERA Agents] No table found on page');
		return { rows: agents, hasNext: false, totalRecords: 0 };
	}

	const rows = table.find('tbody tr');
	console.log(`[MP RERA Agents] Found ${rows.length} rows on page ${pageNum}`);

	rows.each((idx, row) => {
		const cells = $(row).find('td');
		if (cells.length < 6) return;

		// Columns: S.No. | Name | Address | Type | Registration No. | Validity | Details
		const sno = $(cells[0]).text().trim();
		if (!sno || isNaN(parseInt(sno.replace('.', '')))) return;

		const name = $(cells[1]).text().trim();
		const address = $(cells[2]).text().trim();
		const firmType = $(cells[3]).text().trim();
		const registrationNo = $(cells[4]).text().trim();
		const validity = $(cells[5]).text().trim();

		// Extract detail link from the Details column
		let detailUrl = '';
		if (cells.length > 6) {
			const detailLink = $(cells[6]).find('a').first();
			if (detailLink.length) {
				const href = detailLink.attr('href') || '';
				detailUrl = href.startsWith('http') ? href : `${BASE_URL}${href}`;
			}
		}

		// Parse district from address (e.g., "..., Indore, Madhya Pradesh, 452001")
		let district = '';
		const addrParts = address.split(',').map((p) => p.trim());
		// Look for district in address — typically second-to-last or third-to-last part
		if (addrParts.length >= 3) {
			// Check if "Madhya Pradesh" is in the address to locate district
			const mpIdx = addrParts.findIndex((p) => p.toLowerCase().includes('madhya pradesh'));
			if (mpIdx > 0) {
				district = addrParts[mpIdx - 1];
			} else if (addrParts.length >= 2) {
				// Fallback: use second-to-last part
				district = addrParts[addrParts.length - 2];
			}
		}

		const agent = {
			registrationNo,
			name,
			address,
			district,
			firmType,
			validUpto: validity,
			detailUrl
		};

		if (name || registrationNo) {
			agents.push(agent);
		}
	});

	// Check for pagination — DataTables uses "Next" link or page number links
	let hasNext = false;
	const nextLink =
		$('.paginate_button.next:not(.disabled)').first().length > 0 ||
		$('.pager-next a').length > 0 ||
		$('a[rel="next"]').length > 0 ||
		$('li.next:not(.disabled) a').length > 0;
	hasNext = !!nextLink;

	// Try to extract total records from "Showing X to Y of Z entries" or "Total Records: N"
	let totalRecords = 0;
	const infoText = $('.dataTables_info, .total-records, .info').text();
	const totalMatch = infoText.match(/of\s+([\d,]+)\s+entries/i) ||
		infoText.match(/Total\s*Records:\s*([\d,]+)/i);
	if (totalMatch) {
		totalRecords = parseInt(totalMatch[1].replace(/,/g, ''), 10);
	}

	return { rows: agents, hasNext, totalRecords };
}

/**
 * Scrape individual agent detail page for extra info (mobile, email, status, partners).
 */
async function scrapeAgentDetail(detailUrl) {
	try {
		const html = await fetchPage(detailUrl);
		const $ = cheerio.load(html);

		const detail = {};

		// Extract key-value pairs from the detail page
		$('table tr, .field, .form-group').each((_, el) => {
			const label = $(el).find('th, .field-label, label, td:first-child').first().text().trim().replace(/:$/, '');
			const value = $(el).find('td:last-child, .field-item, span').last().text().trim();
			if (label && value && label !== value) {
				const lk = label.toLowerCase();
				if (lk.includes('mobile') || lk.includes('phone')) detail.mobile = value;
				else if (lk.includes('email')) detail.email = value;
				else if (lk.includes('status')) detail.status = value;
				else if (lk.includes('partner') || lk.includes('proprietor')) detail.contactPerson = value;
				else if (lk.includes('father')) detail.fatherName = value;
				else if (lk.includes('pan')) detail.panNumber = value;
				else if (lk.includes('aadhar') || lk.includes('aadhaar')) detail.aadharNumber = value;
			}
		});

		return detail;
	} catch (err) {
		console.log(`[MP RERA Agent Detail] Failed for ${detailUrl}: ${err.message}`);
		return null;
	}
}

export async function GET({ url }) {
	const search = url?.searchParams?.get('search') || '';
	const forceRefresh = url?.searchParams?.get('refresh') === 'true';
	const scrapeDetails = url?.searchParams?.get('details') === 'true';

	try {
		// Return cached DB data if not refreshing
		if (!forceRefresh) {
			const { agents, total } = await AgentService.getAgentsByState(STATE, { search, take: 5000 });
			if (agents.length > 0) {
				return json({ success: true, data: agents, total, cached: true });
			}
			return json({ success: true, data: [], total: 0, cached: true, empty: true });
		}

		// Check if scrape already running
		if (await ScrapeLogService.isRunning(SOURCE, STATE)) {
			const { agents, total } = await AgentService.getAgentsByState(STATE, { search, take: 5000 });
			return json({ success: true, data: agents, total, cached: true, scraping: true });
		}

		const log = await ScrapeLogService.startScrapeLog(SOURCE, STATE);

		try {
			let allAgents = [];

			// Strategy 1: Try live scraping from rera.mp.gov.in
			try {
				console.log('[MP RERA Agents] Attempting live scrape from rera.mp.gov.in...');
				let pageNum = 1;
				const MAX_PAGES = 200;

				while (pageNum <= MAX_PAGES) {
					const { rows, hasNext, totalRecords } = await scrapeAgentsPage(pageNum);
					allAgents.push(...rows);
					console.log(
						`[MP RERA Agents] Page ${pageNum}: ${rows.length} rows (total: ${allAgents.length}${totalRecords ? ` of ${totalRecords}` : ''})`
					);

					if (!hasNext || rows.length === 0) break;
					pageNum++;

					// Small delay between pages to avoid rate limiting
					await new Promise((r) => setTimeout(r, 500));
				}

				console.log(`[MP RERA Agents] Live scrape complete: ${allAgents.length} agents`);
			} catch (liveErr) {
				console.log('[MP RERA Agents] Live scrape failed:', liveErr.message);
			}

			// Strategy 2: Fall back to JSON files if live scrape yielded nothing
			if (allAgents.length === 0) {
				console.log('[MP RERA Agents] Falling back to JSON file seed...');
				const fileAgents = await getMpReraAgents();
				allAgents = fileAgents.map((a) => ({
					registrationNo: a.registrationNumber || a.registrationNo || '',
					name: a.name || a.agentName || '',
					address: a.address || '',
					district: a.district || '',
					mobile: a.details?.mobile || a.mobile || '',
					email: a.details?.email || a.email || '',
					firmType: a.firmType || '',
					registrationDate: a.registrationDate || '',
					validUpto: a.validity || a.validUpto || '',
					status: a.details?.status || a.status || '',
					partners: a.details?.partners || null
				}));
				console.log(`[MP RERA Agents] Loaded ${allAgents.length} agents from JSON files`);
			}

			// Optionally scrape detail pages for extra info (mobile, email, status)
			if (scrapeDetails && allAgents.length > 0) {
				let detailCount = 0;
				for (const agent of allAgents) {
					if (!agent.detailUrl) continue;
					const detail = await scrapeAgentDetail(agent.detailUrl);
					if (detail) {
						if (detail.mobile) agent.mobile = detail.mobile;
						if (detail.email) agent.email = detail.email;
						if (detail.status) agent.status = detail.status;
						if (detail.contactPerson) agent.contactPerson = detail.contactPerson;
						if (detail.fatherName) agent.fatherName = detail.fatherName;
						detailCount++;
					}
					// Delay between detail requests
					await new Promise((r) => setTimeout(r, 300));
					if (detailCount % 50 === 0) {
						console.log(`[MP RERA Agents] Scraped ${detailCount} detail pages...`);
					}
				}
				console.log(`[MP RERA Agents] Scraped ${detailCount} detail pages total`);
			}

			// Persist to DB
			const upserted = await AgentService.upsertAgents(STATE, allAgents);
			await ScrapeLogService.completeScrapeLog(log.id, { totalItems: upserted });
			console.log(`[MP RERA Agents] Persisted ${upserted} agents to DB`);

			const { agents, total } = await AgentService.getAgentsByState(STATE, { search, take: 5000 });
			return json({ success: true, data: agents, total, scraped: upserted });
		} catch (scrapeError) {
			await ScrapeLogService.completeScrapeLog(log.id, { error: scrapeError.message });
			console.error('[MP RERA Agents] Failed:', scrapeError.message);

			// Final fallback to JSON files
			try {
				const agents = await getMpReraAgents();
				return json({ success: true, data: agents, total: agents.length, fallback: true });
			} catch {
				throw scrapeError;
			}
		}
	} catch (error) {
		console.error('[MP RERA Agents] Error:', error.message);
		return json(
			{ success: false, error: error.message || 'Failed to fetch MP agent data' },
			{ status: 500 }
		);
	}
}
