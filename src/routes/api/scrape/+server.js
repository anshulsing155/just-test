import { chromium } from 'playwright';

export async function GET() {
	console.log('object');
	const browser = await chromium.launch({ headless: true });
	const page = await browser.newPage();

	// Open UP RERA website
	await page.goto('https://up-rera.in/agents', { waitUntil: 'domcontentloaded' });

	// Scroll to load more agents
	for (let i = 0; i < 5; i++) {
		await page.evaluate(() => window.scrollBy(0, document.body.scrollHeight));
		await new Promise((resolve) => setTimeout(resolve, 3000)); // Fix here
	}

	// Extract agent details
	const agents = await page.evaluate(() => {
		return Array.from(document.querySelectorAll('table tbody tr')).map((row) => {
			const cols = row.querySelectorAll('td');
			return {
				name: cols[0]?.innerText.trim(),
				registrationNumber: cols[1]?.innerText.trim(),
				companyName: cols[2]?.innerText.trim(),
				city: cols[3]?.innerText.trim(),
				status: cols[4]?.innerText.trim()
			};
		});
	});
	console.log(agents);

	await browser.close();

	return new Response(JSON.stringify({ agents }), {
		headers: { 'Content-Type': 'application/json' }
	});
}
