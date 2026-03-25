import { prisma } from '../db.js';

/**
 * Upsert a company and optionally link it to a project via ProjectCompany junction.
 * Replaces the old promoter.service.js — now handles all company roles.
 *
 * @param {string} state
 * @param {Array} companies - scraped company/promoter data
 * @param {{ role?: string, projectRegNo?: string }} [opts]
 * @returns {number} count of upserted records
 */
export async function upsertCompanies(state, companies, opts = {}) {
	const { role = 'promoter', projectRegNo = null } = opts;
	let count = 0;

	for (const c of companies) {
		const reraRegNo = c.registrationNo || c.reraRegNo || '';
		const name = c.promoterName || c.name || '';
		if (!reraRegNo && !name) continue;

		// Use project name or regNo as fallback when promoter name is missing
		const companyName = name || c.projectName || reraRegNo || `${state}-unknown-${count}`;

		// Upsert the company by state + name (unique constraint)
		const company = await prisma.company.upsert({
			where: {
				state_name: { state, name: companyName }
			},
			update: {
				reraRegNo: reraRegNo || undefined,
				legalType: c.applicantType || c.legalType || undefined,
				address: c.promoterAddress || c.address || undefined,
				mobile: c.promoterPhone || c.mobile || undefined,
				email: c.promoterEmail || c.email || undefined,
				district: c.district || undefined,
				pan: c.pan || undefined,
				gstin: c.gstin || undefined,
				website: c.website || undefined,
				contactPerson: c.contactPerson || undefined,
				rawData: c,
				scrapedAt: new Date()
			},
			create: {
				state,
				reraRegNo: reraRegNo || null,
				name: companyName,
				legalType: c.applicantType || c.legalType || null,
				address: c.promoterAddress || c.address || null,
				mobile: c.promoterPhone || c.mobile || null,
				email: c.promoterEmail || c.email || null,
				district: c.district || null,
				pan: c.pan || null,
				gstin: c.gstin || null,
				website: c.website || null,
				contactPerson: c.contactPerson || null,
				rawData: c
			}
		});

		// If we have project data in the same record, upsert the project and link
		const projRegNo = projectRegNo || c.projectRegNo || c.projectRegistrationNo;
		const projName = c.projectName;

		if (projRegNo || projName) {
			const pRegNo = projRegNo || reraRegNo;
			if (pRegNo) {
				const project = await prisma.project.upsert({
					where: {
						state_reraRegNo: { state, reraRegNo: pRegNo }
					},
					update: {
						name: projName || undefined,
						location: c.projectLocation || undefined,
						district: c.district || undefined,
						projectType: c.projectType || undefined,
						constructionStatus: c.constructionStatus || undefined,
						validUntil: c.validUntil || c.validUpto || undefined,
						certificateUrl: c.certificateUrl || undefined,
						extensionCertificate: c.extensionCertificate || undefined,
						rawData: c,
						scrapedAt: new Date()
					},
					create: {
						state,
						reraRegNo: pRegNo,
						name: projName || '',
						location: c.projectLocation || null,
						district: c.district || null,
						projectType: c.projectType || null,
						constructionStatus: c.constructionStatus || null,
						validUntil: c.validUntil || c.validUpto || null,
						certificateUrl: c.certificateUrl || null,
						extensionCertificate: c.extensionCertificate || null,
						rawData: c
					}
				});

				// Link company ↔ project via junction
				await prisma.projectCompany.upsert({
					where: {
						projectId_companyId_role: {
							projectId: project.id,
							companyId: company.id,
							role
						}
					},
					update: {},
					create: {
						projectId: project.id,
						companyId: company.id,
						role,
						isPrimary: true
					}
				});
			}
		}

		count++;
	}
	return count;
}

/**
 * Get companies by state with optional search and role filter
 */
export async function getCompaniesByState(state, { search = '', role = '', skip = 0, take = 100 } = {}) {
	const where = { state };

	if (search) {
		where.OR = [
			{ name: { contains: search, mode: 'insensitive' } },
			{ reraRegNo: { contains: search, mode: 'insensitive' } },
			{ mobile: { contains: search } },
			{ address: { contains: search, mode: 'insensitive' } },
			{ email: { contains: search, mode: 'insensitive' } }
		];
	}

	// If filtering by role, use the junction table
	if (role) {
		where.projectLinks = { some: { role } };
	}

	const [companies, total] = await Promise.all([
		prisma.company.findMany({
			where,
			skip,
			take,
			orderBy: { createdAt: 'desc' },
			include: {
				projectLinks: {
					include: { project: { select: { id: true, name: true, reraRegNo: true, state: true } } }
				}
			}
		}),
		prisma.company.count({ where })
	]);

	return { companies, total };
}

/**
 * Get a single company with all linked projects
 */
export async function getCompany(state, name) {
	return prisma.company.findUnique({
		where: { state_name: { state, name } },
		include: {
			projectLinks: {
				include: { project: true }
			}
		}
	});
}

/**
 * Get a company by RERA registration number
 */
export async function getCompanyByReraRegNo(state, reraRegNo) {
	return prisma.company.findFirst({
		where: { state, reraRegNo },
		include: {
			projectLinks: {
				include: { project: true }
			}
		}
	});
}

/**
 * Link an existing company to an existing project
 */
export async function linkCompanyToProject(companyId, projectId, role = 'promoter', isPrimary = false) {
	return prisma.projectCompany.upsert({
		where: {
			projectId_companyId_role: { projectId, companyId, role }
		},
		update: { isPrimary },
		create: { projectId, companyId, role, isPrimary }
	});
}
