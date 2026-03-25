import { json } from '@sveltejs/kit';
import { getMpReraAgents } from '$lib/server/agentData';
import { AgentService } from '$lib/server/services/index.js';

const STATE = 'MP';
let seeded = false;

export async function GET({ url }) {
	const search = url?.searchParams?.get('search') || '';
	const forceRefresh = url?.searchParams?.get('refresh') === 'true';

	try {
		// If not a refresh request, return cached DB data
		if (!forceRefresh) {
			const { agents, total } = await AgentService.getAgentsByState(STATE, { search, take: 2000 });
			if (agents.length > 0) {
				return json({ success: true, data: agents, total, cached: true });
			}
			return json({ success: true, data: [], total: 0, cached: true, empty: true });
		}

		// Seed/refresh DB from JSON files only when refresh=true
		const fileAgents = await getMpReraAgents();
		let upserted = 0;
		if (fileAgents.length > 0) {
			upserted = await AgentService.upsertAgents(
				STATE,
				fileAgents.map((a) => ({
					registrationNo: a.registrationNumber || a.registrationNo || a.Registration_No || '',
					name: a.name || a.agentName || a.Agent_Name || '',
					address: a.address || a.Address || '',
					district: a.district || a.District || '',
					mobile: a.details?.mobile || a.mobile || a.Mobile || '',
					email: a.details?.email || a.email || a.Email || '',
					firmType: a.firmType || '',
					registrationDate: a.registrationDate || '',
					validUpto: a.validity || a.validUpto || '',
					status: a.details?.status || a.status || '',
					partners: a.details?.partners || null
				}))
			);
			console.log(`[MP Agents] Seeded ${upserted} agents to DB`);
		}
		seeded = true;

		const { agents, total } = await AgentService.getAgentsByState(STATE, { search, take: 2000 });
		return json({ success: true, data: agents, total, scraped: upserted });
	} catch (error) {
		console.error('[MP Agents] Error:', error);
		const agents = await getMpReraAgents();
		return json({ success: true, data: agents, total: agents.length, fallback: true });
	}
}
