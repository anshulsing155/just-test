// src/routes/api/up-rera-promoters/+server.js
import puppeteer from 'puppeteer';
import { json } from '@sveltejs/kit';
import { CompanyService, ScrapeLogService } from '$lib/server/services/index.js';

const STATE = 'UP';
const SOURCE = 'up-rera-promoters';
const CACHE_DURATION = 1000 * 60 * 60; // 1 hour

/**
 * Scrape rows from the current grid page.
 * Each row: SNo, Reg.Number, Name, Address, Contact Details, Type, Details (link)
 */
async function scrapeCurrentPage(page) {
	return page.evaluate(() => {
		const results = [];
		// Find the main data table (GridView)
		const dataTable =
			document.querySelector('#ctl00_ContentPlaceHolder1_grdRegisteredPromoters') ||
			document.querySelector('[id*="grdpromoter" i]') ||
			document.querySelector('[id*="GridView"]') ||
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
			// Skip pager rows (contain nested table with page links)
			if (row.querySelector('table')) continue;

			const getText = (cell) =>
				(cell?.querySelector('span')?.innerText || cell?.innerText || '').trim();

			const sno = getText(cells[0]);
			// Skip header-like or non-data rows
			if (!sno || isNaN(parseInt(sno))) continue;

			const regNo = getText(cells[1]);
			const name = getText(cells[2]);

			// Address cell
			const address = getText(cells[3]);

			// Contact Details cell contains mobile, email, website stacked
			const contactCell = cells[4];
			const contactText = (contactCell?.innerText || '').trim();
			const contactLines = contactText
				.split('\n')
				.map((l) => l.trim())
				.filter(Boolean);
			let mobile = '';
			let email = '';
			let website = '';
			for (const line of contactLines) {
				if (/^\d{10,}$/.test(line.replace(/[+\-\s]/g, ''))) {
					mobile = line;
				} else if (line.includes('@')) {
					email = line;
				} else if (line.startsWith('http') || line.includes('www.') || line.includes('.com') || line.includes('.in') || line.includes('.org')) {
					website = line;
				}
			}

			const applicantType = getText(cells[5]);

			// Detail link — ViewPromoter.aspx?Id=...
			const detailLink = cells[6]?.querySelector('a');
			const detailUrl = detailLink ? detailLink.href || detailLink.getAttribute('href') : '';

			const promoter = {
				registrationNo: regNo,
				promoterName: name,
				mobile,
				email,
				address,
				website,
				applicantType,
				detailUrl
			};
			if (name || regNo) results.push(promoter);
		}

		// Detect next page in ASP.NET GridView pager
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

/**
 * Scrape the detail page for a single promoter.
 * Returns extra fields: chairman, pan, cin, registrationDate
 */
async function scrapePromoterDetail(page, detailUrl) {
	try {
		await page.goto(detailUrl, { waitUntil: 'networkidle2', timeout: 30000 });
		await new Promise((r) => setTimeout(r, 1500));

		return await page.evaluate(() => {
			const detail = {};
			// The detail page shows key-value pairs in a structured layout
			const allText = document.body.innerText || '';

			// Helper: extract value after a label
			const extract = (label) => {
				const regex = new RegExp(label + '\\s*[:\\-]?\\s*([^\\n]+)', 'i');
				const match = allText.match(regex);
				return match ? match[1].trim() : '';
			};

			detail.chairman = extract('Name of Chairman') || extract('Chairman') || extract('Name of Director') || '';
			detail.pan = extract('Pan number') || extract('PAN') || '';
			detail.cin = extract('CIN/TAN Number') || extract('CIN') || extract('TAN') || '';
			detail.registrationDate = extract('Registration Date') || '';

			// Also try structured elements (spans, labels, etc.)
			const spans = document.querySelectorAll('span');
			for (const span of spans) {
				const text = span.innerText.trim();
				const nextSpan = span.parentElement?.nextElementSibling?.querySelector('span');
				const val = nextSpan?.innerText?.trim() || '';
				if (!val) continue;

				if (text.match(/Name of Chairman/i)) detail.chairman = detail.chairman || val;
				if (text.match(/Pan number/i)) detail.pan = detail.pan || val;
				if (text.match(/CIN/i)) detail.cin = detail.cin || val;
				if (text.match(/Registration Date/i)) detail.registrationDate = detail.registrationDate || val;
			}

			return detail;
		});
	} catch (err) {
		console.log(`[UP RERA Detail] Failed for ${detailUrl}: ${err.message}`);
		return null;
	}
}

export async function GET({ url }) {
	const forceRefresh = url?.searchParams?.get('refresh') === 'true';
	const search = url?.searchParams?.get('search') || '';
	const scrapeDetails = url?.searchParams?.get('details') === 'true'; // opt-in, slow for 1000+ promoters

	try {
		const lastScrape = await ScrapeLogService.getLastSuccessTime(SOURCE, STATE);
		const isFresh =
			lastScrape?.finishedAt &&
			Date.now() - lastScrape.finishedAt.getTime() < CACHE_DURATION;

		if (isFresh && !forceRefresh) {
			const { companies, total } = await CompanyService.getCompaniesByState(STATE, {
				search,
				take: 5000
			});
			return json({ success: true, data: companies, total, cached: true });
		}

		if (await ScrapeLogService.isRunning(SOURCE, STATE)) {
			const { companies, total } = await CompanyService.getCompaniesByState(STATE, {
				search,
				take: 5000
			});
			return json({
				success: true,
				data: companies,
				total,
				cached: true,
				scraping: true
			});
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

			let promoters = [];

			// Navigate directly to the promoters listing page
			try {
				console.log('[UP RERA Promoters] Navigating to /promoters...');
				await page.goto('https://www.up-rera.in/promoters', {
					waitUntil: 'networkidle2',
					timeout: 60000
				});
				await new Promise((r) => setTimeout(r, 3000));

				// Scrape all pages
				let pageNum = 1;
				const MAX_PAGES = 500;
				while (pageNum <= MAX_PAGES) {
					console.log(`[UP RERA Promoters] Scraping page ${pageNum}...`);
					const { rows, hasNext, nextPageArg, gridId } = await scrapeCurrentPage(page);
					promoters.push(...rows);
					console.log(
						`[UP RERA Promoters] Page ${pageNum}: ${rows.length} rows (total: ${promoters.length})`
					);

					if (!hasNext || !nextPageArg || !gridId) break;

					try {
						await Promise.all([
							page.waitForNavigation({
								waitUntil: 'networkidle2',
								timeout: 60000
							}),
							page.evaluate(
								(id, arg) => {
									__doPostBack(id, arg);
								},
								gridId,
								nextPageArg
							)
						]);
						await new Promise((r) => setTimeout(r, 2000));
						pageNum++;
					} catch (navErr) {
						console.log(
							`[UP RERA Promoters] Pagination failed at page ${pageNum}:`,
							navErr.message
						);
						break;
					}
				}

				console.log(`[UP RERA Promoters] Total scraped from listing: ${promoters.length}`);
			} catch (primaryErr) {
				console.log('[UP RERA Promoters] Primary scrape failed:', primaryErr.message);
			}

			// Fallback: try old homepage postback method
			if (promoters.length === 0) {
				try {
					console.log('[UP RERA Promoters] Trying homepage postback fallback...');
					await page.goto('https://www.up-rera.in/', {
						waitUntil: 'networkidle2',
						timeout: 60000
					});
					await new Promise((r) => setTimeout(r, 3000));

					await Promise.all([
						page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }),
						page.evaluate(() => {
							__doPostBack('ctl00$ContentPlaceHolder1$lnkRegisteredPromoters', '');
						})
					]);
					await new Promise((r) => setTimeout(r, 3000));

					// Scrape all pages with the same pagination logic
					let pageNum = 1;
					while (pageNum <= 500) {
						const { rows, hasNext, nextPageArg, gridId } =
							await scrapeCurrentPage(page);
						promoters.push(...rows);
						if (!hasNext || !nextPageArg || !gridId) break;
						try {
							await Promise.all([
								page.waitForNavigation({
									waitUntil: 'networkidle2',
									timeout: 60000
								}),
								page.evaluate(
									(id, arg) => {
										__doPostBack(id, arg);
									},
									gridId,
									nextPageArg
								)
							]);
							await new Promise((r) => setTimeout(r, 2000));
							pageNum++;
						} catch {
							break;
						}
					}
				} catch (fallbackErr) {
					console.log('[UP RERA Promoters] Fallback also failed:', fallbackErr.message);
				}
			}

			// Scrape detail pages for extra info (chairman, PAN, CIN)
			if (scrapeDetails && promoters.length > 0) {
				const detailPage = await browser.newPage();
				await detailPage.setViewport({ width: 1280, height: 900 });
				await detailPage.setUserAgent(
					'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36'
				);

				let detailCount = 0;
				for (const promoter of promoters) {
					if (!promoter.detailUrl) continue;
					// Ensure absolute URL
					const fullUrl = promoter.detailUrl.startsWith('http')
						? promoter.detailUrl
						: `https://www.up-rera.in/${promoter.detailUrl.replace(/^\//, '')}`;

					const detail = await scrapePromoterDetail(detailPage, fullUrl);
					if (detail) {
						promoter.contactPerson = detail.chairman || '';
						promoter.pan = detail.pan || '';
						promoter.cin = detail.cin || '';
						promoter.registrationDate = detail.registrationDate || '';
						detailCount++;
					}

					// Small delay to avoid hammering the server
					await new Promise((r) => setTimeout(r, 500));

					if (detailCount % 50 === 0) {
						console.log(
							`[UP RERA Promoters] Scraped ${detailCount} detail pages...`
						);
					}
				}

				await detailPage.close();
				console.log(
					`[UP RERA Promoters] Scraped ${detailCount} detail pages total`
				);
			}

			await browser.close();
			browser = null;

			// Persist to DB
			const count = await CompanyService.upsertCompanies(STATE, promoters, {
				role: 'promoter'
			});
			await ScrapeLogService.completeScrapeLog(log.id, { totalItems: count });
			console.log(`[UP RERA Promoters] Persisted ${count} companies to DB`);

			const { companies, total } = await CompanyService.getCompaniesByState(STATE, {
				search,
				take: 5000
			});
			return json({ success: true, data: companies, total });
		} catch (scrapeError) {
			if (browser) await browser.close();
			await ScrapeLogService.completeScrapeLog(log.id, {
				error: scrapeError.message
			});

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
					scrapeError: scrapeError.message
				});
			}
			throw scrapeError;
		}
	} catch (error) {
		console.error('[UP RERA Promoters] Error:', error.message);
		return json({ success: false, error: error.message }, { status: 500 });
	}
}
