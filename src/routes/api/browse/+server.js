import { json } from '@sveltejs/kit';
import { prisma } from '$lib/server/db.js';

/**
 * Optimized browse API — single endpoint for all filter combinations.
 *
 * Query params:
 *   action    = filters | entities | projects
 *   state     = UP | Delhi | ...
 *   district  = district name
 *   type      = promoter | agent
 *   search    = free text
 *   entityId  = company/agent ID (for loading their projects)
 *   page      = 1-based page number
 *   take      = page size (max 100)
 */
export async function GET({ url }) {
	const action = url.searchParams.get('action') || 'filters';
	const state = url.searchParams.get('state') || '';
	const district = url.searchParams.get('district') || '';
	const type = url.searchParams.get('type') || 'promoter';
	const search = url.searchParams.get('search') || '';
	const entityId = url.searchParams.get('entityId') || '';
	const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
	const take = Math.min(100, parseInt(url.searchParams.get('take') || '25'));
	const skip = (page - 1) * take;

	try {
		// ── Action: filters ──────────────────────────────────
		// Returns available states + districts for cascading dropdowns
		if (action === 'filters') {
			const [agentStates, companyStates, projectStates] = await Promise.all([
				prisma.agent.findMany({ distinct: ['state'], select: { state: true } }),
				prisma.company.findMany({ distinct: ['state'], select: { state: true } }),
				prisma.project.findMany({ distinct: ['state'], select: { state: true } })
			]);

			const allStates = [...new Set([
				...agentStates.map(s => s.state),
				...companyStates.map(s => s.state),
				...projectStates.map(s => s.state)
			])].sort();

			// If state is provided, get districts for that state
			let districts = [];
			if (state) {
				const [agentDistricts, projectDistricts] = await Promise.all([
					prisma.agent.findMany({
						where: { state, district: { not: null } },
						distinct: ['district'],
						select: { district: true },
						orderBy: { district: 'asc' }
					}),
					prisma.project.findMany({
						where: { state, district: { not: null } },
						distinct: ['district'],
						select: { district: true },
						orderBy: { district: 'asc' }
					})
				]);
				districts = [...new Set([
					...agentDistricts.map(d => d.district).filter(Boolean),
					...projectDistricts.map(d => d.district).filter(Boolean)
				])].sort();
			}

			// Counts per state for context
			const [agentCounts, companyCounts, projectCounts] = await Promise.all([
				prisma.agent.groupBy({ by: ['state'], _count: true }),
				prisma.company.groupBy({ by: ['state'], _count: true }),
				prisma.project.groupBy({ by: ['state'], _count: true })
			]);

			const stateCounts = {};
			for (const s of allStates) {
				stateCounts[s] = {
					agents: agentCounts.find(c => c.state === s)?._count || 0,
					companies: companyCounts.find(c => c.state === s)?._count || 0,
					projects: projectCounts.find(c => c.state === s)?._count || 0
				};
			}

			return json({ success: true, states: allStates, districts, stateCounts });
		}

		// ── Action: entities ─────────────────────────────────
		// Returns companies (promoters/builders) or agents with project counts
		if (action === 'entities') {
			if (type === 'agent') {
				const where = {};
				if (state) where.state = state;
				if (district) where.district = district;
				if (search) {
					where.OR = [
						{ name: { contains: search, mode: 'insensitive' } },
						{ reraRegNo: { contains: search, mode: 'insensitive' } },
						{ mobile: { contains: search } },
						{ email: { contains: search, mode: 'insensitive' } }
					];
				}

				const [data, total] = await Promise.all([
					prisma.agent.findMany({
						where, skip, take,
						orderBy: { name: 'asc' },
						select: {
							id: true, state: true, reraRegNo: true, name: true,
							district: true, firmType: true, mobile: true, email: true,
							address: true, validUpto: true, status: true, certificateUrl: true,
							_count: { select: { projectLinks: true } }
						}
					}),
					prisma.agent.count({ where })
				]);

				return json({ success: true, data, total, page, take });
			}

			// type === 'promoter' (companies)
			const where = {};
			if (state) where.state = state;
			if (district) where.district = district;
			if (search) {
				where.OR = [
					{ name: { contains: search, mode: 'insensitive' } },
					{ reraRegNo: { contains: search, mode: 'insensitive' } },
					{ mobile: { contains: search } },
					{ email: { contains: search, mode: 'insensitive' } }
				];
			}

			const [data, total] = await Promise.all([
				prisma.company.findMany({
					where, skip, take,
					orderBy: { name: 'asc' },
					select: {
						id: true, state: true, reraRegNo: true, name: true,
						legalType: true, district: true, mobile: true, email: true,
						address: true, website: true, contactPerson: true, pan: true,
						_count: { select: { projectLinks: true } }
					}
				}),
				prisma.company.count({ where })
			]);

			return json({ success: true, data, total, page, take });
		}

		// ── Action: projects ─────────────────────────────────
		// Returns projects for a specific entity OR filtered by state/district
		if (action === 'projects') {
			const where = {};
			if (state) where.state = state;
			if (district) where.district = district;

			// If entityId is given, get projects linked to that company or agent
			if (entityId) {
				if (type === 'agent') {
					where.agentLinks = { some: { agentId: entityId } };
				} else {
					where.companyLinks = { some: { companyId: entityId } };
				}
			}

			if (search) {
				where.OR = [
					{ name: { contains: search, mode: 'insensitive' } },
					{ reraRegNo: { contains: search, mode: 'insensitive' } },
					{ location: { contains: search, mode: 'insensitive' } }
				];
			}

			const [data, total] = await Promise.all([
				prisma.project.findMany({
					where, skip, take,
					orderBy: { createdAt: 'desc' },
					select: {
						id: true, state: true, reraRegNo: true, name: true,
						district: true, projectType: true, location: true,
						constructionStatus: true, validUntil: true, certificateUrl: true,
						companyLinks: {
							select: {
								role: true, isPrimary: true,
								company: { select: { id: true, name: true, reraRegNo: true } }
							}
						},
						agentLinks: {
							select: {
								agent: { select: { id: true, name: true, reraRegNo: true } }
							}
						}
					}
				}),
				prisma.project.count({ where })
			]);

			return json({ success: true, data, total, page, take });
		}

		// ── Action: entity-detail ────────────────────────────
		// Full detail for a single entity with all linked projects
		if (action === 'entity-detail') {
			if (!entityId) return json({ success: false, error: 'entityId required' }, { status: 400 });

			if (type === 'agent') {
				const agent = await prisma.agent.findUnique({
					where: { id: entityId },
					include: {
						projectLinks: {
							include: {
								project: {
									select: {
										id: true, state: true, reraRegNo: true, name: true,
										district: true, location: true, constructionStatus: true, validUntil: true
									}
								}
							}
						}
					}
				});
				return json({ success: true, entity: agent });
			}

			const company = await prisma.company.findUnique({
				where: { id: entityId },
				include: {
					projectLinks: {
						include: {
							project: {
								select: {
									id: true, state: true, reraRegNo: true, name: true,
									district: true, location: true, constructionStatus: true,
									validUntil: true, certificateUrl: true
								}
							}
						}
					}
				}
			});
			return json({ success: true, entity: company });
		}

		return json({ success: false, error: 'Invalid action' }, { status: 400 });
	} catch (error) {
		console.error('[Browse API]', error.message);
		return json({ success: false, error: error.message }, { status: 500 });
	}
}
