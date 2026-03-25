import { json } from '@sveltejs/kit';
import { getDelhiReraAgents } from '$lib/server/agentData';
import { AgentService } from '$lib/server/services/index.js';

const STATE = 'Delhi';
let seeded = false;

export async function GET({ url }) {
	const search = url?.searchParams?.get('search') || '';
	const forceRefresh = url?.searchParams?.get('refresh') === 'true';

	try {
		// If not a refresh request, return cached DB data
		if (!forceRefresh) {
			const { agents, total } = await AgentService.getAgentsByState(STATE, { search, take: 1000 });
			if (agents.length > 0) {
				return json({ success: true, data: agents, total, cached: true });
			}
			return json({ success: true, data: [], total: 0, cached: true, empty: true });
		}

		// Seed/refresh DB from JSON file only when refresh=true
		const fileAgents = await getDelhiReraAgents();
		let upserted = 0;
		if (fileAgents.length > 0) {
			upserted = await AgentService.upsertAgents(
				STATE,
				fileAgents.map((a) => ({
					registrationNo: a.registrationNumber || '',
					name: a.name || '',
					address: a.address || '',
					mobile: a.phone || a.details?.mobile || '',
					email: a.email || a.details?.email || '',
					firmType: a.firmType || '',
					validUpto: a.validity || '',
					status: a.details?.status || '',
					certificateUrl: a.certificate || '',
					partners: a.details?.partners || null,
					detailsLink: a.detailsLink || ''
				}))
			);
			console.log(`[Delhi Agents] Seeded ${upserted} agents to DB`);
		}
		seeded = true;

		const { agents, total } = await AgentService.getAgentsByState(STATE, { search, take: 1000 });
		return json({ success: true, data: agents, total, scraped: upserted });
	} catch (error) {
		console.error('[Delhi Agents] Error:', error);
		// Fallback to file
		const agents = await getDelhiReraAgents();
		return json({ success: true, data: agents, total: agents.length, fallback: true });
	}
}
