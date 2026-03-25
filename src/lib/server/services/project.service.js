import { prisma } from '../db.js';

/**
 * Upsert projects for a given state.
 * Optionally links to a company (promoter/builder) via the junction table.
 *
 * @param {string} state
 * @param {Array} projects - scraped project data
 * @param {{ companyId?: string, role?: string }} [opts]
 * @returns {number} count of upserted records
 */
export async function upsertProjects(state, projects, opts = {}) {
	const { companyId = null, role = 'promoter' } = opts;

	let count = 0;
	for (const p of projects) {
		const regNo = p.projectRegNo || p.registrationNo || p.reraRegNo || '';
		if (!regNo) continue;

		const project = await prisma.project.upsert({
			where: {
				state_reraRegNo: { state, reraRegNo: regNo }
			},
			update: {
				name: p.projectName || p.name || undefined,
				district: p.district || undefined,
				projectType: p.projectType || undefined,
				location: p.location || p.projectLocation || undefined,
				constructionStatus: p.constructionStatus || undefined,
				validUntil: p.validUntil || p.validUpto || undefined,
				certificateUrl: p.certificateUrl || undefined,
				rawData: p,
				scrapedAt: new Date()
			},
			create: {
				state,
				reraRegNo: regNo,
				name: p.projectName || p.name || '',
				district: p.district || null,
				projectType: p.projectType || null,
				location: p.location || p.projectLocation || null,
				constructionStatus: p.constructionStatus || null,
				validUntil: p.validUntil || p.validUpto || null,
				certificateUrl: p.certificateUrl || null,
				rawData: p
			}
		});

		// Link to company — by explicit ID or by matching promoterName
		let linkCompanyId = companyId;
		if (!linkCompanyId && p.promoterName) {
			const match = await prisma.company.findFirst({
				where: { state, name: { equals: p.promoterName, mode: 'insensitive' } },
				select: { id: true }
			});
			if (match) linkCompanyId = match.id;
		}

		if (linkCompanyId) {
			await prisma.projectCompany.upsert({
				where: {
					projectId_companyId_role: {
						projectId: project.id,
						companyId: linkCompanyId,
						role
					}
				},
				update: {},
				create: {
					projectId: project.id,
					companyId: linkCompanyId,
					role,
					isPrimary: true
				}
			});
		}

		count++;
	}
	return count;
}

/**
 * Update project with detail page info
 */
export async function updateProjectDetails(state, reraRegNo, details) {
	return prisma.project.update({
		where: {
			state_reraRegNo: { state, reraRegNo }
		},
		data: {
			projectInfo: details.projectInfo || undefined,
			locationInfo: details.locationInfo || undefined,
			financialInfo: details.financialInfo || undefined,
			propertyDetails: details.propertyDetails || undefined,
			sections: details.sections || undefined
		}
	});
}

/**
 * Get projects by state with optional filters
 */
export async function getProjectsByState(state, { search = '', district = '', skip = 0, take = 100 } = {}) {
	const where = { state };

	if (district) where.district = district;

	if (search) {
		where.OR = [
			{ name: { contains: search, mode: 'insensitive' } },
			{ reraRegNo: { contains: search, mode: 'insensitive' } },
			{ location: { contains: search, mode: 'insensitive' } }
		];
	}

	const [projects, total] = await Promise.all([
		prisma.project.findMany({
			where,
			skip,
			take,
			orderBy: { createdAt: 'desc' },
			include: {
				companyLinks: {
					include: { company: { select: { id: true, name: true, reraRegNo: true } } }
				},
				agentLinks: {
					include: { agent: { select: { id: true, name: true, reraRegNo: true } } }
				},
				bankTieups: true
			}
		}),
		prisma.project.count({ where })
	]);

	return { projects, total };
}

/**
 * Get a single project with all relationships
 */
export async function getProject(state, reraRegNo) {
	return prisma.project.findUnique({
		where: { state_reraRegNo: { state, reraRegNo } },
		include: {
			companyLinks: { include: { company: true } },
			agentLinks: { include: { agent: true } },
			bankTieups: true
		}
	});
}

/**
 * Get distinct districts for a state
 */
export async function getDistricts(state) {
	const results = await prisma.project.findMany({
		where: { state, district: { not: null } },
		select: { district: true },
		distinct: ['district'],
		orderBy: { district: 'asc' }
	});
	return results.map((r) => r.district).filter(Boolean);
}

/**
 * Add bank tieup to a project
 */
export async function addBankTieup(projectId, bankData) {
	return prisma.projectBank.upsert({
		where: {
			projectId_bankName: { projectId, bankName: bankData.bankName }
		},
		update: {
			interestRate: bankData.interestRate || undefined,
			maxLoanPct: bankData.maxLoanPct || undefined,
			processingFee: bankData.processingFee || undefined,
			remarks: bankData.remarks || undefined
		},
		create: {
			projectId,
			bankName: bankData.bankName,
			loanAvailable: bankData.loanAvailable ?? true,
			interestRate: bankData.interestRate || null,
			maxLoanPct: bankData.maxLoanPct || null,
			processingFee: bankData.processingFee || null,
			remarks: bankData.remarks || null
		}
	});
}
