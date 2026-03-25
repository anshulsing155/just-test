import puppeteer from 'puppeteer';

export async function GET() {
	const projectsURL = 'https://www.rera.mp.gov.in/projects/'; // Update if needed

	// Launch Puppeteer
	const browser = await puppeteer.launch({
		headless: false, // Run browser in visible mode for debugging
		args: ['--no-sandbox', '--disable-setuid-sandbox']
	});

	const page = await browser.newPage();
	// Mimic real browser
	await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');

	console.log('Navigating to:', projectsURL);
	await page.goto(projectsURL, { waitUntil: 'networkidle2' });

	// Wait for the table to be rendered
	await page.waitForSelector('table tbody tr', { timeout: 10000 });

	// Log the page content to debug
	const pageContent = await page.content();
	console.log('Page HTML:', pageContent); // Check if table exists in HTML

	// Extract Project List
	const projects = await page.evaluate(() => {
		let projectData = [];
		const rows = document.querySelectorAll('table tbody tr');
		console.log('Rows Found:', rows.length);

		rows.forEach((row) => {
			console.log(row);
			const columns = row.querySelectorAll('td');
			if (columns.length > 0) {
				let projectName = columns[0]?.innerText.trim();
				let promoterName = columns[1]?.innerText.trim();
				let projectStatus = columns[2]?.innerText.trim();
				let projectLink = columns[0]?.querySelector('a')?.href;

				if (projectName && projectLink) {
					projectData.push({
						projectName,
						promoterName,
						projectStatus,
						projectLink
					});
				}
			}
		});

		return projectData;
	});

	console.log('Projects Extracted:', projects.length);
	await browser.close();

	// Return the scraped data
	return new Response(JSON.stringify(projects), { status: 200 });
}
