import { json } from '@sveltejs/kit';
import puppeteer from 'puppeteer';

export async function GET({ url }) {
	const searchParams = new URL(url).searchParams;
	const agentUrl = searchParams.get('url');
	if (!agentUrl) return json({ error: 'No URL provided' }, { status: 400 });

	const browser = await puppeteer.launch({ headless: 'new' });
	const page = await browser.newPage();

	try {
		await page.goto(agentUrl, { waitUntil: 'domcontentloaded' });

		// Extract "Agent Information"
		const details = await page.evaluate(() => {
			const details = {};
			document.querySelectorAll('table tr').forEach((row) => {
				const cols = row.querySelectorAll('td');
				if (cols.length === 2) {
					details[cols[0].textContent.trim()] = cols[1].textContent.trim();
				}
			});
			return details;
		});

		return json(details);
	} catch (error) {
		console.error('Error fetching agent details:', error);
		return json({ error: 'Failed to fetch agent details' }, { status: 500 });
	} finally {
		await browser.close();
	}
}
