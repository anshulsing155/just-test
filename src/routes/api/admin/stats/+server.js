import { json } from '@sveltejs/kit';
import { prisma } from '$lib/server/db.js';

export async function GET() {
	try {
		// Aggregate counts by state for each model
		const [agents, companies, projects, scrapeLogs] = await Promise.all([
			prisma.agent.groupBy({ by: ['state'], _count: true }),
			prisma.company.groupBy({ by: ['state'], _count: true }),
			prisma.project.groupBy({ by: ['state'], _count: true }),
			prisma.scrapeLog.findMany({
				orderBy: { startedAt: 'desc' },
				take: 50
			})
		]);

		// Totals
		const totals = {
			agents: agents.reduce((s, g) => s + g._count, 0),
			companies: companies.reduce((s, g) => s + g._count, 0),
			projects: projects.reduce((s, g) => s + g._count, 0)
		};

		// Build state map
		const stateMap = {};
		for (const g of agents) {
			stateMap[g.state] = stateMap[g.state] || { agents: 0, companies: 0, projects: 0 };
			stateMap[g.state].agents = g._count;
		}
		for (const g of companies) {
			stateMap[g.state] = stateMap[g.state] || { agents: 0, companies: 0, projects: 0 };
			stateMap[g.state].companies = g._count;
		}
		for (const g of projects) {
			stateMap[g.state] = stateMap[g.state] || { agents: 0, companies: 0, projects: 0 };
			stateMap[g.state].projects = g._count;
		}

		// Latest scrape per source
		const latestBySource = {};
		for (const log of scrapeLogs) {
			const key = `${log.source}::${log.state}`;
			if (!latestBySource[key]) latestBySource[key] = log;
		}

		return json({
			success: true,
			totals,
			states: stateMap,
			scrapeLogs,
			latestBySource: Object.values(latestBySource)
		});
	} catch (error) {
		console.error('[Admin Stats]', error.message);
		return json({ success: false, error: error.message }, { status: 500 });
	}
}
