import { json } from '@sveltejs/kit';
import { prisma } from '$lib/server/db.js';

export async function GET({ url }) {
	const model = url.searchParams.get('model') || 'agent'; // agent | company | project
	const state = url.searchParams.get('state') || '';
	const search = url.searchParams.get('search') || '';
	const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
	const take = Math.min(100, parseInt(url.searchParams.get('take') || '25'));
	const skip = (page - 1) * take;

	try {
		let where = {};
		if (state) where.state = state;

		if (model === 'agent') {
			if (search) {
				where.OR = [
					{ name: { contains: search, mode: 'insensitive' } },
					{ reraRegNo: { contains: search, mode: 'insensitive' } },
					{ district: { contains: search, mode: 'insensitive' } },
					{ mobile: { contains: search } },
					{ email: { contains: search, mode: 'insensitive' } }
				];
			}
			const [data, total] = await Promise.all([
				prisma.agent.findMany({
					where, skip, take,
					orderBy: { createdAt: 'desc' },
					select: {
						id: true, state: true, reraRegNo: true, name: true, district: true,
						address: true, mobile: true, email: true, firmType: true,
						registrationDate: true, validUpto: true, status: true,
						certificateUrl: true, scrapedAt: true, createdAt: true
					}
				}),
				prisma.agent.count({ where })
			]);
			return json({ success: true, data, total, page, take });
		}

		if (model === 'company') {
			if (search) {
				where.OR = [
					{ name: { contains: search, mode: 'insensitive' } },
					{ reraRegNo: { contains: search, mode: 'insensitive' } },
					{ email: { contains: search, mode: 'insensitive' } },
					{ mobile: { contains: search } },
					{ address: { contains: search, mode: 'insensitive' } }
				];
			}
			const [data, total] = await Promise.all([
				prisma.company.findMany({
					where, skip, take,
					orderBy: { createdAt: 'desc' },
					select: {
						id: true, state: true, reraRegNo: true, name: true, legalType: true,
						address: true, mobile: true, email: true, website: true,
						contactPerson: true, district: true, pan: true,
						scrapedAt: true, createdAt: true,
						_count: { select: { projectLinks: true } }
					}
				}),
				prisma.company.count({ where })
			]);
			return json({ success: true, data, total, page, take });
		}

		if (model === 'project') {
			if (search) {
				where.OR = [
					{ name: { contains: search, mode: 'insensitive' } },
					{ reraRegNo: { contains: search, mode: 'insensitive' } },
					{ location: { contains: search, mode: 'insensitive' } },
					{ district: { contains: search, mode: 'insensitive' } }
				];
			}
			const [data, total] = await Promise.all([
				prisma.project.findMany({
					where, skip, take,
					orderBy: { createdAt: 'desc' },
					select: {
						id: true, state: true, reraRegNo: true, name: true, district: true,
						projectType: true, location: true, constructionStatus: true,
						validUntil: true, certificateUrl: true,
						scrapedAt: true, createdAt: true,
						_count: { select: { companyLinks: true, agentLinks: true } }
					}
				}),
				prisma.project.count({ where })
			]);
			return json({ success: true, data, total, page, take });
		}

		if (model === 'scrapeLog') {
			if (search) {
				where.OR = [
					{ source: { contains: search, mode: 'insensitive' } },
					{ state: { contains: search, mode: 'insensitive' } }
				];
			}
			const [data, total] = await Promise.all([
				prisma.scrapeLog.findMany({
					where, skip, take,
					orderBy: { startedAt: 'desc' }
				}),
				prisma.scrapeLog.count({ where })
			]);
			return json({ success: true, data, total, page, take });
		}

		// ── Detail: full entity with all relations ──
		if (model === 'detail') {
			const id = url.searchParams.get('id') || '';
			const entityType = url.searchParams.get('entityType') || 'company';
			if (!id) return json({ success: false, error: 'id required' }, { status: 400 });

			if (entityType === 'company') {
				const entity = await prisma.company.findUnique({
					where: { id },
					include: {
						projectLinks: {
							include: {
								project: {
									select: {
										id: true, state: true, reraRegNo: true, name: true,
										district: true, projectType: true, location: true,
										constructionStatus: true, validUntil: true, certificateUrl: true
									}
								}
							}
						}
					}
				});
				return json({ success: true, entity, entityType: 'company' });
			}

			if (entityType === 'agent') {
				const entity = await prisma.agent.findUnique({
					where: { id },
					include: {
						projectLinks: {
							include: {
								project: {
									select: {
										id: true, state: true, reraRegNo: true, name: true,
										district: true, projectType: true, location: true,
										constructionStatus: true, validUntil: true, certificateUrl: true
									}
								}
							}
						}
					}
				});
				return json({ success: true, entity, entityType: 'agent' });
			}

			if (entityType === 'project') {
				const entity = await prisma.project.findUnique({
					where: { id },
					include: {
						companyLinks: {
							include: {
								company: {
									select: {
										id: true, state: true, reraRegNo: true, name: true,
										legalType: true, mobile: true, email: true, address: true,
										contactPerson: true, website: true
									}
								}
							}
						},
						agentLinks: {
							include: {
								agent: {
									select: {
										id: true, state: true, reraRegNo: true, name: true,
										firmType: true, mobile: true, email: true, district: true
									}
								}
							}
						},
						bankTieups: true
					}
				});
				return json({ success: true, entity, entityType: 'project' });
			}

			return json({ success: false, error: 'Invalid entityType' }, { status: 400 });
		}

		return json({ success: false, error: 'Invalid model' }, { status: 400 });
	} catch (error) {
		console.error('[Admin Data]', error.message);
		return json({ success: false, error: error.message }, { status: 500 });
	}
}
