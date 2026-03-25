import puppeteer from 'puppeteer';
import { AgentService } from '$lib/server/services/index.js';

export async function GET({ url }) {
	const refresh = url.searchParams.get('refresh') === 'true';
	const search = url.searchParams.get('search') || '';

	// If not a refresh request, return cached DB data
	if (!refresh) {
		try {
			const { agents, total } = await AgentService.getAgentsByState('Rajasthan', { search });
			if (agents.length > 0) {
				return new Response(JSON.stringify({ success: true, data: agents, total, cached: true }), {
					headers: { 'Content-Type': 'application/json' }
				});
			}
		} catch (dbErr) {
			console.warn('[Rajasthan Agents] DB read failed:', dbErr);
		}
		return new Response(JSON.stringify({ success: true, data: [], total: 0, cached: true, empty: true }), {
			headers: { 'Content-Type': 'application/json' }
		});
	}

	// Scrape only when refresh=true
	let browser;
	try {
		const baseUrl = 'https://rera.rajasthan.gov.in/AgentSearch?Out=Y';
		browser = await puppeteer.launch({
			headless: true,
			args: ['--no-sandbox', '--disable-setuid-sandbox']
		});

		const page = await browser.newPage();
		await page.setUserAgent(
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36'
		);
		await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 30000 });

		let allAgents = [];
		let currentPage = 1;
		const maxPages = 5;

		while (allAgents.length < 10 && currentPage <= maxPages) {
			console.log(`[Rajasthan] Scraping page ${currentPage}...`);

			const agents = await page.evaluate(() => {
				return [...document.querySelectorAll('.ds4u-tbody tr')].map((row) => {
					let columns = row.querySelectorAll('td');
					if (!columns || columns.length < 4) return null;

					let viewLink = row.querySelector('a.btn-primary')?.href || '';

					return {
						district: columns[0]?.innerText?.trim() || '',
						name: columns[1]?.innerText?.trim() || '',
						applicationNo: columns[2]?.innerText?.split('(')[0]?.trim() || '',
						submissionDate: columns[2]?.innerText?.match(/\((.*?)\)/)?.[1] || '',
						registrationNo: columns[3]?.innerText?.split('(')[0]?.trim() || '',
						registrationDate: columns[3]?.innerText?.match(/\((.*?)\)/)?.[1] || '',
						profileLink: viewLink ? new URL(viewLink, window.location.origin).href : ''
					};
				}).filter(Boolean);
			});

			if (agents.length === 0) break; // No more data on this page

			allAgents.push(...agents);

			if (allAgents.length >= 10) {
				allAgents = allAgents.slice(0, 10);
				break;
			}

			let nextButton = await page.$('.ds4u-btn.mpbtn:not(.ds4u-selected)');
			if (!nextButton) break;
			await nextButton.click();
			await new Promise((resolve) => setTimeout(resolve, 3000));

			currentPage++;
		}

		// Now scrape details from each profile page
		const detailedAgents = [];
		for (const agent of allAgents) {
			if (!agent.profileLink) {
				detailedAgents.push(agent);
				continue;
			}

			try {
				console.log(`Fetching details for: ${agent.name}`);
				const detailPage = await browser.newPage();
				await detailPage.goto(agent.profileLink, { waitUntil: 'networkidle2', timeout: 15000 });

				const details = await detailPage.evaluate(() => {
					// Try multiple selector strategies for the detail page
					const getText = (selectors) => {
						for (const sel of selectors) {
							const el = document.querySelector(sel);
							if (el && el.innerText?.trim()) return el.innerText.trim();
						}
						return '';
					};

					// Look for contact info in common page structures
					const contactNumber = getText([
						'.contact-info span',
						'[data-label="Mobile"] span',
						'td:has(> label:contains("Mobile")) + td',
						'.ds4u-value:nth-of-type(4)'
					]);
					const email = getText([
						'.email-info span',
						'[data-label="Email"] span',
						'td:has(> label:contains("Email")) + td',
						'.ds4u-value:nth-of-type(5)'
					]);
					const address = getText([
						'.address-info span',
						'[data-label="Address"] span',
						'td:has(> label:contains("Address")) + td',
						'.ds4u-value:nth-of-type(3)'
					]);

					// Fallback: try to extract from all table rows
					let fallbackMobile = '';
					let fallbackEmail = '';
					let fallbackAddress = '';
					const allRows = document.querySelectorAll('table tr, .ds4u-row');
					allRows.forEach((row) => {
						const text = row.innerText || '';
						if (text.match(/mobile|phone|contact/i)) {
							const cells = row.querySelectorAll('td, .ds4u-value');
							if (cells.length >= 2) fallbackMobile = cells[cells.length - 1]?.innerText?.trim() || '';
						}
						if (text.match(/email/i) && !text.match(/mobile/i)) {
							const cells = row.querySelectorAll('td, .ds4u-value');
							if (cells.length >= 2) fallbackEmail = cells[cells.length - 1]?.innerText?.trim() || '';
						}
						if (text.match(/address/i) && !text.match(/email/i)) {
							const cells = row.querySelectorAll('td, .ds4u-value');
							if (cells.length >= 2) fallbackAddress = cells[cells.length - 1]?.innerText?.trim() || '';
						}
					});

					return {
						contactNumber: contactNumber || fallbackMobile || '',
						email: email || fallbackEmail || '',
						address: address || fallbackAddress || ''
					};
				});

				await detailPage.close();
				detailedAgents.push({ ...agent, ...details });
			} catch (detailErr) {
				console.warn(`[Rajasthan] Failed to get details for ${agent.name}:`, detailErr.message);
				detailedAgents.push(agent);
			}
		}

		// Persist to DB using upsert (prevents duplicates via state + reraRegNo unique key)
		let upsertCount = 0;
		try {
			upsertCount = await AgentService.upsertAgents('Rajasthan', detailedAgents.map((a) => ({
				registrationNo: a.registrationNo || a.applicationNo || '',
				name: a.name || '',
				district: a.district || '',
				address: a.address || '',
				mobile: a.contactNumber || '',
				email: a.email || '',
				registrationDate: a.registrationDate || ''
			})));
		} catch (dbErr) {
			console.warn('[Rajasthan Agents] DB persist failed:', dbErr.message);
		}

		// Return fresh data from DB to include all previously scraped agents
		const { agents: allDbAgents, total } = await AgentService.getAgentsByState('Rajasthan', {});

		return new Response(JSON.stringify({ success: true, data: allDbAgents, total, scraped: detailedAgents.length, upserted: upsertCount }), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (error) {
		// On scrape failure, try returning cached DB data
		try {
			const { agents: cachedAgents, total } = await AgentService.getAgentsByState('Rajasthan', {});
			if (cachedAgents.length > 0) {
				return new Response(
					JSON.stringify({
						success: true,
						data: cachedAgents,
						total,
						cached: true,
						scrapeError: error.message
					}),
					{ headers: { 'Content-Type': 'application/json' } }
				);
			}
		} catch {}

		console.error('Scraping failed:', error);
		return new Response(JSON.stringify({ success: false, error: 'Scraping failed: ' + error.message }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	} finally {
		if (browser) await browser.close();
	}
}
