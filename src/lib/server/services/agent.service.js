import { prisma } from '../db.js';

/**
 * Upsert a batch of agents for a given state.
 * Uses reraRegNo + state as the unique key.
 * @param {string} state - e.g. 'UP', 'Delhi', 'MP', 'Punjab', 'Rajasthan'
 * @param {Array} agents - scraped agent data
 * @returns {number} count of upserted records
 */
export async function upsertAgents(state, agents) {
	let count = 0;

	// Helper: return non-empty trimmed string or fallback
	const val = (...sources) => {
		for (const s of sources) {
			if (s && typeof s === 'string' && s.trim()) return s.trim();
		}
		return undefined;
	};
	const valOrNull = (...sources) => {
		for (const s of sources) {
			if (s && typeof s === 'string' && s.trim()) return s.trim();
		}
		return null;
	};

	for (const agent of agents) {
		const regNo = val(agent.registrationNo, agent.registrationNumber, agent.reraRegNo);
		if (!regNo) continue;

		const name = val(agent.name, agent.agentName, agent.promoterName) || '';
		const district = valOrNull(agent.district);
		const area = valOrNull(agent.area, agent.locality, agent.sector);
		const pinCode = valOrNull(agent.pinCode, agent.pincode);
		const address = valOrNull(agent.address);
		const mobile = valOrNull(agent.mobile, agent.phone);
		const email = valOrNull(agent.email);
		const firmType = valOrNull(agent.firmType, agent.agentType, agent.applicantType);
		const registrationDate = valOrNull(agent.registrationDate, agent.issueDate);
		const validUpto = valOrNull(agent.validUpto, agent.validity);
		const status = valOrNull(agent.status);
		const certificateUrl = valOrNull(agent.certificateUrl, agent.certificate);
		const partners = agent.partners || agent.details?.partners || null;
		const detailsLink = valOrNull(agent.detailsLink);

		await prisma.agent.upsert({
			where: {
				state_reraRegNo: { state, reraRegNo: regNo }
			},
			update: {
				name: name || undefined,
				district: district || undefined,
				area: area || undefined,
				pinCode: pinCode || undefined,
				address: address || undefined,
				mobile: mobile || undefined,
				email: email || undefined,
				firmType: firmType || undefined,
				registrationDate: registrationDate || undefined,
				validUpto: validUpto || undefined,
				status: status || undefined,
				certificateUrl: certificateUrl || undefined,
				partners: partners || undefined,
				detailsLink: detailsLink || undefined,
				rawData: agent,
				scrapedAt: new Date()
			},
			create: {
				state,
				reraRegNo: regNo,
				name,
				district,
				area,
				pinCode,
				address,
				mobile,
				email,
				firmType,
				registrationDate,
				validUpto,
				status,
				certificateUrl,
				partners,
				detailsLink,
				rawData: agent
			}
		});
		count++;
	}
	return count;
}

/**
 * Update agent detail fields (from detail page scraping)
 */
export async function updateAgentDetails(state, reraRegNo, details) {
	return prisma.agent.update({
		where: {
			state_reraRegNo: { state, reraRegNo }
		},
		data: {
			fatherName: details.fatherName || undefined,
			tehsil: details.tehsil || undefined,
			email: details.email || undefined,
			mobile: details.mobile || undefined,
			address: details.permanentAddress || details.address || undefined,
			panNumber: details.panNumber || undefined,
			aadharNumber: details.aadharNumber || undefined,
			registrationFee: details.registrationFee || undefined,
			paymentDate: details.paymentDate || undefined,
			transactionId: details.transactionId || undefined,
			bankName: details.bankName || undefined,
			accountNumber: details.accountNumber || undefined,
			ifscCode: details.ifscCode || undefined,
			branchName: details.branchName || undefined,
			bankAddress: details.bankAddress || undefined,
			registrationDate: details.registrationDate || undefined
		}
	});
}

/**
 * Get agents by state with optional search
 */
export async function getAgentsByState(state, { search = '', skip = 0, take = 100 } = {}) {
	const where = { state };

	if (search) {
		where.OR = [
			{ name: { contains: search, mode: 'insensitive' } },
			{ reraRegNo: { contains: search, mode: 'insensitive' } },
			{ district: { contains: search, mode: 'insensitive' } },
			{ area: { contains: search, mode: 'insensitive' } },
			{ pinCode: { contains: search } },
			{ mobile: { contains: search } },
			{ address: { contains: search, mode: 'insensitive' } }
		];
	}

	const [agents, total] = await Promise.all([
		prisma.agent.findMany({
			where,
			skip,
			take,
			orderBy: { createdAt: 'desc' },
			include: {
				projectLinks: {
					include: { project: { select: { id: true, name: true, reraRegNo: true } } }
				}
			}
		}),
		prisma.agent.count({ where })
	]);

	return { agents, total };
}

/**
 * Get a single agent by state + reraRegNo
 */
export async function getAgent(state, reraRegNo) {
	return prisma.agent.findUnique({
		where: { state_reraRegNo: { state, reraRegNo } },
		include: {
			projectLinks: {
				include: { project: true }
			}
		}
	});
}

/**
 * Get count of agents by state
 */
export async function getAgentCount(state) {
	return prisma.agent.count({ where: { state } });
}

/**
 * Check when agents for a state were last scraped
 */
export async function getLastScrapeTime(state) {
	const latest = await prisma.agent.findFirst({
		where: { state },
		orderBy: { scrapedAt: 'desc' },
		select: { scrapedAt: true }
	});
	return latest?.scrapedAt || null;
}

/**
 * Link an agent to a project
 */
export async function linkAgentToProject(agentId, projectId, opts = {}) {
	return prisma.projectAgent.upsert({
		where: {
			projectId_agentId: { projectId, agentId }
		},
		update: {
			commissionPct: opts.commissionPct || undefined
		},
		create: {
			projectId,
			agentId,
			commissionPct: opts.commissionPct || null
		}
	});
}
