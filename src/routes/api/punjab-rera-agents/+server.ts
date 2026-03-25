import puppeteer from 'puppeteer';
import { AgentService } from '$lib/server/services/index.js';

export async function GET({ url }) {
	const refresh = url.searchParams.get('refresh') === 'true';
	const search = url.searchParams.get('search') || '';

	// If not a refresh request, return cached DB data
	if (!refresh) {
		try {
			const { agents, total } = await AgentService.getAgentsByState('Punjab', { search });
			if (agents.length > 0) {
				return new Response(JSON.stringify({ success: true, data: agents, total, cached: true }), {
					headers: { 'Content-Type': 'application/json' }
				});
			}
		} catch (dbErr) {
			console.warn('[Punjab Agents] DB read failed:', dbErr);
		}
		// If DB is empty and no refresh requested, return empty with a hint
		return new Response(JSON.stringify({ success: true, data: [], total: 0, cached: true, empty: true }), {
			headers: { 'Content-Type': 'application/json' }
		});
	}

	// Scrape only when refresh=true
	let browser: any;
	try {
		browser = await puppeteer.launch({
			headless: true,
			args: ['--no-sandbox', '--disable-setuid-sandbox']
		});
		const page = await browser.newPage();
		await page.setViewport({ width: 1280, height: 800 });

		await page.goto('https://rera.punjab.gov.in/reraindex/publicview/agentinfo', {
			waitUntil: 'networkidle2',
			timeout: 30000
		});

		// NOTE: Punjab RERA pages can include anti-bot protections / CAPTCHA.
		// If the table doesn't appear, we return a clear error for the UI.
		await page.waitForSelector('#dataTablePartialViewSearchRegdAgent', { timeout: 30000 });

		const agents: any[] = [];
		const maxRowsToScrape = 5;

		const rows = await page.$$('#dataTablePartialViewSearchRegdAgent tbody tr');

		for (let i = 0; i < Math.min(rows.length, maxRowsToScrape); i++) {
			const freshRows = await page.$$('#dataTablePartialViewSearchRegdAgent tbody tr');
			const row = freshRows[i];

			const basicData = await page.evaluate((row: any) => {
				const columns = row.querySelectorAll('td');
				return {
					name: columns[1]?.innerText.trim() || 'N/A',
					district: columns[2]?.innerText.trim() || 'N/A',
					registrationNumber: columns[3]?.innerText.trim() || 'N/A',
					issueDate: columns[4]?.innerText.trim() || 'N/A',
					validUpto: columns[5]?.innerText.trim() || 'N/A'
				};
			}, row);

			const viewBtn = await row.$('td:last-child a');
			let detailedData: any = {};

			if (viewBtn) {
				try {
					await viewBtn.click();
					await page.waitForSelector('.modal-body #dataTable', { timeout: 20000, visible: true });
					await new Promise((resolve) => setTimeout(resolve, 750));

					detailedData = await page.evaluate((basicData: any) => {
						const modalBody = document.querySelector('.modal-body');
						if (!modalBody) return {
							name: basicData.name,
							address: basicData.district,
							firmType: 'N/A',
							registrationNumber: basicData.registrationNumber,
							validity: `${basicData.issueDate} to ${basicData.validUpto}`,
							details: { mobile: null, email: null, status: 'Approved' }
						};

						let address = 'N/A';
						let firmType = 'N/A';
						let phone = null;
						let email = null;
						const partners: any[] = [];
						let status = 'Approved';

						// Registration Details
						const regTable = modalBody.querySelector('#dataTable tbody');
						let registrationNumber = basicData.registrationNumber;
						let validity = basicData.validUpto;
						if (regTable) {
							const cells = regTable.querySelectorAll('td');
							registrationNumber = cells[1]?.innerText.trim() || basicData.registrationNumber;
							validity = cells[3]?.innerText.trim() || basicData.validUpto;
						}

						// General Information
						const genInfo = (modalBody.querySelectorAll('#dataTable') as any)[1];
						if (genInfo) {
							const rows = genInfo.querySelectorAll('tbody tr');
							rows.forEach((row: any) => {
								const cells = row.querySelectorAll('td');
								if (cells[0]?.innerText.includes('Agent Type')) {
									firmType = cells[1]?.innerText.trim() || 'N/A';
								}
								if (cells[0]?.innerText.includes('E-Mail')) {
									email = cells[1]?.innerText.trim() || null;
								}
								if (cells[0]?.innerText.includes('Mobile')) {
									phone = cells[1]?.innerText.trim() || null;
								}
							});
						}

						// Partners (if applicable)
						const memberTable = modalBody.querySelector('#AgentProfile #dataTable:nth-child(3)');
						if (memberTable) {
							const memberRows = memberTable.querySelectorAll('tbody tr');
							memberRows.forEach((row: any) => {
								const cells = row.querySelectorAll('td');
								const addressText = cells[3]?.innerText.trim() || 'N/A';
								const emailMatch = addressText.match(/Email:\s*([^\s]+)/);
								partners.push({
									name: cells[2]?.innerText.trim() || 'N/A',
									email: emailMatch ? emailMatch[1] : null,
									mobile: null,
									address: addressText,
									image: cells[4]?.querySelector('img')?.src || 'N/A'
								});
							});
						}

						// Registered Address
						const regAddressTable = modalBody.querySelector(
							'#AgentProfile #dataTable:nth-child(4)'
						);
						if (regAddressTable) {
							const rows = regAddressTable.querySelectorAll('tbody tr');
							const addressParts: any[] = [];
							rows.forEach((row: any) => {
								const cells = row.querySelectorAll('td');
								addressParts.push(cells[1]?.innerText.trim());
								addressParts.push(cells[3]?.innerText.trim());
							});
							address = addressParts.filter((part) => part).join(', ') || 'N/A';
						}

						return {
							name: basicData.name,
							address,
							firmType,
							registrationNumber,
							validity: `${basicData.issueDate} to ${validity}`,
							details: {
								mobile: phone,
								email,
								status,
								partners: partners.length > 0 ? partners : undefined
							}
						};
					}, basicData);

					await page.click('.modal-footer .btn-secondary').catch(() => {});
					await new Promise((resolve) => setTimeout(resolve, 500));
				} catch (modalError) {
					// Fallback to basic data if modal scraping fails
					detailedData = {
						name: basicData.name,
						address: `${basicData.district}`,
						firmType: 'N/A',
						registrationNumber: basicData.registrationNumber,
						validity: `${basicData.issueDate} to ${basicData.validUpto}`,
						details: {
							mobile: null,
							email: null,
							status: 'Approved'
						}
					};
					await page.click('.modal-footer .btn-secondary').catch(() => {});
					await new Promise((resolve) => setTimeout(resolve, 500));
				}
			} else {
				detailedData = {
					name: basicData.name,
					address: `${basicData.district}`,
					firmType: 'N/A',
					registrationNumber: basicData.registrationNumber,
					validity: `${basicData.issueDate} to ${basicData.validUpto}`,
					details: {
						mobile: null,
						email: null,
						status: 'Approved'
					}
				};
			}

			agents.push(detailedData);
		}

		// Persist to DB using upsert (prevents duplicates via state + reraRegNo unique key)
		let upsertCount = 0;
		try {
			upsertCount = await AgentService.upsertAgents('Punjab', agents.map((a: any) => ({
				registrationNo: a.registrationNumber || '',
				name: a.name || '',
				address: a.address || '',
				mobile: a.details?.mobile || '',
				email: a.details?.email || '',
				firmType: a.firmType || '',
				validUpto: a.validity || '',
				status: a.details?.status || '',
				partners: a.details?.partners || null
			})));
		} catch (dbErr) {
			console.warn('[Punjab Agents] DB persist failed:', dbErr);
		}

		// Return fresh data from DB to include all previously scraped agents too
		const { agents: allAgents, total } = await AgentService.getAgentsByState('Punjab', {});

		return new Response(JSON.stringify({ success: true, data: allAgents, total, scraped: agents.length, upserted: upsertCount }), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (error) {
		// On scrape failure, try returning cached DB data
		try {
			const { agents: cachedAgents, total } = await AgentService.getAgentsByState('Punjab', {});
			if (cachedAgents.length > 0) {
				return new Response(
					JSON.stringify({
						success: true,
						data: cachedAgents,
						total,
						cached: true,
						scrapeError: error instanceof Error ? error.message : 'Scrape failed'
					}),
					{ headers: { 'Content-Type': 'application/json' } }
				);
			}
		} catch {}

		return new Response(
			JSON.stringify({
				success: false,
				error:
					error instanceof Error
						? error.message
						: 'Failed to scrape Punjab RERA agents. (Possible CAPTCHA / anti-bot protection.)'
			}),
			{
				status: 500,
				headers: { 'Content-Type': 'application/json' }
			}
		);
	} finally {
		try {
			if (browser) await browser.close();
		} catch {}
	}
}
