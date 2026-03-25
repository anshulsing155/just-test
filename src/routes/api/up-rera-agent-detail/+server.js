// src/routes/api/up-rera-agent-detail/+server.js
import puppeteer from 'puppeteer';
import { json } from '@sveltejs/kit';
import { AgentService } from '$lib/server/services/index.js';

const STATE = 'UP';

export async function POST({ request }) {
	let browser;
	try {
		const { viewDetailId, registrationNo } = await request.json();
		if (!viewDetailId) {
			return json({ error: 'No viewDetailId provided' }, { status: 400 });
		}

		// Check if we already have details in DB
		if (registrationNo) {
			const existing = await AgentService.getAgent(STATE, registrationNo);
			if (existing?.fatherName && existing.fatherName !== 'N/A') {
				return json({ details: existing });
			}
		}

		browser = await puppeteer.launch({
			headless: true,
			args: ['--no-sandbox', '--disable-setuid-sandbox'],
			protocolTimeout: 60000
		});
		const page = await browser.newPage();
		await page.setViewport({ width: 1280, height: 800 });
		await page.setUserAgent(
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36'
		);

		await page.goto('https://up-rera.in/agents', { waitUntil: 'networkidle2' });
		await page.waitForSelector('#ctl00_ContentPlaceHolder1_grdagents');

		const detailSelector = `[id="${viewDetailId}"]`;
		await Promise.all([
			page.waitForNavigation({ waitUntil: 'networkidle2' }),
			page.click(detailSelector)
		]);

		const details = await page.evaluate(() => ({
			name: document.querySelector('#ctl00_ContentPlaceHolder1_lblAname')?.innerText.trim() || 'N/A',
			district: document.querySelector('#ctl00_ContentPlaceHolder1_lblDist')?.innerText.trim() || 'N/A',
			applicantType: document.querySelector('#ctl00_ContentPlaceHolder1_lblAtype')?.innerText.trim() || 'N/A',
			tehsil: document.querySelector('#ctl00_ContentPlaceHolder1_lblTehsil')?.innerText.trim() || 'N/A',
			fatherName: document.querySelector('#ctl00_ContentPlaceHolder1_lblFname')?.innerText.trim() || 'N/A',
			email: document.querySelector('#ctl00_ContentPlaceHolder1_lblEmail')?.innerText.trim() || 'N/A',
			mobile: document.querySelector('#ctl00_ContentPlaceHolder1_lblAMob')?.innerText.trim() || 'N/A',
			permanentAddress: document.querySelector('#ctl00_ContentPlaceHolder1_lblAdd')?.innerText.trim() || 'N/A',
			panNumber: document.querySelector('#ctl00_ContentPlaceHolder1_lblPan')?.innerText.trim() || 'N/A',
			aadharNumber: document.querySelector('#ctl00_ContentPlaceHolder1_lblAdhaar')?.innerText.trim() || 'N/A',
			registrationFee: document.querySelector('#ctl00_ContentPlaceHolder1_lblregfee')?.innerText.trim() || 'N/A',
			paymentDate: document.querySelector('#ctl00_ContentPlaceHolder1_lblpaydt')?.innerText.trim() || 'N/A',
			transactionId: document.querySelector('#ctl00_ContentPlaceHolder1_lbltraid')?.innerText.trim() || 'N/A',
			bankName: document.querySelector('#ctl00_ContentPlaceHolder1_lblbankname')?.innerText.trim() || 'N/A',
			accountNumber: document.querySelector('#ctl00_ContentPlaceHolder1_lblaccno')?.innerText.trim() || 'N/A',
			ifscCode: document.querySelector('#ctl00_ContentPlaceHolder1_lblifsc')?.innerText.trim() || 'N/A',
			branchName: document.querySelector('#ctl00_ContentPlaceHolder1_lblbranch')?.innerText.trim() || 'N/A',
			bankAddress: document.querySelector('#ctl00_ContentPlaceHolder1_lblBankadd')?.innerText.trim() || 'N/A',
			registrationDate: document.querySelector('#ctl00_ContentPlaceHolder1_lblregdt')?.innerText.trim() || 'N/A'
		}));

		await browser.close();
		browser = null;

		// Persist details to DB
		if (registrationNo) {
			try {
				await AgentService.updateAgentDetails(STATE, registrationNo, details);
			} catch (dbErr) {
				console.warn('[UP Agent Detail] DB update failed (agent may not exist):', dbErr.message);
			}
		}

		return json({ details });
	} catch (error) {
		console.error('[UP Agent Detail] Error:', error.message);
		if (browser) await browser.close();
		return json({ error: error.message || 'Failed to fetch agent details' }, { status: 500 });
	}
}
