// src/routes/api/up-rera-agents/+server.js
import puppeteer from 'puppeteer';
import { json } from '@sveltejs/kit';
import { AgentService, ScrapeLogService } from '$lib/server/services/index.js';

const STATE = 'UP';
const SOURCE = 'up-rera-agents';
const CACHE_DURATION = 1000 * 60 * 60; // 1 hour

/**
 * Scrape all agent rows from the table.
 * The UP RERA agents table loads ALL rows at once (3600+), no pagination needed.
 * Columns: SrNo, Registration No, Agent Name, Registration Date, ValidUpto, District, Agent Type, Details
 */
async function scrapeAgentTable(page) {
	return page.evaluate(() => {
		const results = [];
		const dataTable =
			document.querySelector('#ctl00_ContentPlaceHolder1_grdagents') ||
			document.querySelector('[id*="grdagent" i]') ||
			document.querySelector('[id*="GridView"]') ||
			(() => {
				const tables = document.querySelectorAll('table');
				for (const t of tables) {
					if (t.querySelectorAll('tr').length > 10) return t;
				}
				return null;
			})();

		if (!dataTable) return results;

		const allRows = Array.from(
			dataTable.querySelectorAll(':scope > tbody > tr, :scope > tr')
		);

		for (const row of allRows) {
			const cells = row.querySelectorAll('td');
			if (cells.length < 7) continue;
			// Skip pager rows
			if (row.querySelector('table')) continue;

			const getText = (cell) =>
				(cell?.querySelector('span')?.innerText || cell?.innerText || '').trim();

			const sno = getText(cells[0]);
			if (!sno || isNaN(parseInt(sno))) continue;

			const regNo = getText(cells[1]);
			const name = getText(cells[2]);
			const registrationDate = getText(cells[3]);
			const validUpto = getText(cells[4]);
			const district = getText(cells[5]);
			const agentType = getText(cells[6]);

			// Detail link
			const detailCell = cells[7];
			const detailLink = detailCell?.querySelector('a');
			let viewDetailPostback = '';
			let detailLinkId = '';
			if (detailLink) {
				const href = detailLink.getAttribute('href') || '';
				const match = href.match(/__doPostBack\('([^']+)'/);
				if (match) viewDetailPostback = match[1];
				detailLinkId = detailLink.id || '';
			}

			const agent = {
				registrationNo: regNo,
				agentName: name,
				registrationDate,
				validUpto,
				district,
				agentType,
				viewDetailPostback,
				detailLinkId
			};
			if (name || regNo) results.push(agent);
		}

		return results;
	});
}

export async function GET({ url }) {
	const forceRefresh = url?.searchParams?.get('refresh') === 'true';
	const search = url?.searchParams?.get('search') || '';

	try {
		// Return cached data if not refreshing
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
		let browser;

		try {
			browser = await puppeteer.launch({
				headless: true,
				args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
				protocolTimeout: 300000
			});

			const page = await browser.newPage();
			await page.setViewport({ width: 1280, height: 900 });
			await page.setUserAgent(
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36'
			);

			let agents = [];

			// Primary: homepage postback (reliable, /agents URL is on maintenance)
			try {
				console.log('[UP RERA Agents] Navigating to homepage...');
				await page.goto('https://www.up-rera.in/', {
					waitUntil: 'networkidle2',
					timeout: 60000
				});
				await new Promise((r) => setTimeout(r, 3000));

				console.log('[UP RERA Agents] Clicking REGISTERED AGENT postback...');
				await Promise.all([
					page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }),
					page.evaluate(() => {
						__doPostBack('ctl00$ContentPlaceHolder1$lnkAgents', '');
					})
				]);
				await new Promise((r) => setTimeout(r, 3000));

				console.log('[UP RERA Agents] Page URL:', page.url());
				// Wait for agent table to appear
				try {
					await page.waitForSelector('#ctl00_ContentPlaceHolder1_grdagents', { timeout: 15000 });
					console.log('[UP RERA Agents] Agent table found, scraping...');
				} catch {
					console.log('[UP RERA Agents] Table selector not found, trying generic...');
				}
				// Extra wait for large table to fully render
				await new Promise((r) => setTimeout(r, 5000));
				agents = await scrapeAgentTable(page);
				console.log(`[UP RERA Agents] Scraped ${agents.length} agents`);
			} catch (primaryErr) {
				console.log('[UP RERA Agents] Homepage postback failed:', primaryErr.message);

				// Fallback: try direct /agents URL
				try {
					console.log('[UP RERA Agents] Trying /agents direct...');
					await page.goto('https://www.up-rera.in/agents', {
						waitUntil: 'networkidle2',
						timeout: 60000
					});
					await new Promise((r) => setTimeout(r, 3000));

					if (!page.url().includes('maintenance')) {
						agents = await scrapeAgentTable(page);
						console.log(`[UP RERA Agents] Fallback scraped ${agents.length} agents`);
					}
				} catch (fallbackErr) {
					console.log('[UP RERA Agents] Fallback failed:', fallbackErr.message);
				}
			}

			await browser.close();
			browser = null;

			// Persist to DB
			const count = await AgentService.upsertAgents(
				STATE,
				agents.map((a) => ({
					...a,
					name: a.agentName,
					firmType: a.agentType
				}))
			);

			await ScrapeLogService.completeScrapeLog(log.id, { totalItems: count });
			console.log(`[UP RERA Agents] Persisted ${count} agents to DB`);

			const { agents: dbAgents, total } = await AgentService.getAgentsByState(STATE, {
				search,
				take: 5000
			});
			return json({ success: true, data: dbAgents, total, scraped: count });
		} catch (scrapeError) {
			if (browser) await browser.close();
			await ScrapeLogService.completeScrapeLog(log.id, { error: scrapeError.message });

			const { agents: dbAgents, total } = await AgentService.getAgentsByState(STATE, {
				search,
				take: 5000
			});
			if (dbAgents.length > 0) {
				return json({
					success: true,
					data: dbAgents,
					total,
					cached: true,
					scrapeError: scrapeError.message
				});
			}
			throw scrapeError;
		}
	} catch (error) {
		console.error('[UP RERA Agents] Error:', error.message);
		return json(
			{ success: false, error: error.message || 'Failed to fetch agent data' },
			{ status: 500 }
		);
	}
}
