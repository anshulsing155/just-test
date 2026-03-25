// src/routes/api/mp-rera-agents/+server.js
import { json } from '@sveltejs/kit';
import { getMpReraAgents } from '$lib/server/agentData';
import { AgentService, ScrapeLogService } from '$lib/server/services/index.js';

const STATE = 'MP';
const SOURCE = 'mp-rera-agents';

export async function GET({ url }) {
	const search = url?.searchParams?.get('search') || '';
	const forceRefresh = url?.searchParams?.get('refresh') === 'true';

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
			// Seed/refresh DB from JSON files
			const fileAgents = await getMpReraAgents();
			let upserted = 0;
			if (fileAgents.length > 0) {
				upserted = await AgentService.upsertAgents(
					STATE,
					fileAgents.map((a) => ({
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
					}))
				);
				console.log(`[MP RERA Agents] Seeded ${upserted} agents to DB`);
			}

			await ScrapeLogService.completeScrapeLog(log.id, { totalItems: upserted });

			const { agents, total } = await AgentService.getAgentsByState(STATE, { search, take: 5000 });
			return json({ success: true, data: agents, total, scraped: upserted });
		} catch (scrapeError) {
			await ScrapeLogService.completeScrapeLog(log.id, { error: scrapeError.message });
			console.error('[MP RERA Agents] Seed failed:', scrapeError.message);

			// Fallback to file
			const agents = await getMpReraAgents();
			return json({ success: true, data: agents, total: agents.length, fallback: true });
		}
	} catch (error) {
		console.error('[MP RERA Agents] Error:', error.message);
		return json(
			{ success: false, error: error.message || 'Failed to fetch MP agent data' },
			{ status: 500 }
		);
	}
}
