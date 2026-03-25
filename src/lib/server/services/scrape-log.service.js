import { prisma } from '../db.js';

/**
 * Start a scrape log entry
 * @param {string} source - e.g. 'up-rera-agents'
 * @param {string} state - e.g. 'UP'
 * @returns {object} the created log record
 */
export async function startScrapeLog(source, state) {
	return prisma.scrapeLog.create({
		data: {
			source,
			state,
			status: 'running'
		}
	});
}

/**
 * Complete a scrape log entry
 */
export async function completeScrapeLog(id, { totalItems = 0, error = null } = {}) {
	const startedLog = await prisma.scrapeLog.findUnique({ where: { id } });
	const duration = startedLog ? Date.now() - startedLog.startedAt.getTime() : null;

	return prisma.scrapeLog.update({
		where: { id },
		data: {
			status: error ? 'failed' : 'success',
			totalItems,
			duration,
			error,
			finishedAt: new Date()
		}
	});
}

/**
 * Get recent scrape logs for a source
 */
export async function getRecentLogs(source, state, limit = 10) {
	return prisma.scrapeLog.findMany({
		where: { source, state },
		orderBy: { startedAt: 'desc' },
		take: limit
	});
}

/**
 * Check if a scrape is currently running for a source.
 * Auto-expires stale runs older than 10 minutes.
 */
export async function isRunning(source, state) {
	const STALE_TIMEOUT = 10 * 60 * 1000; // 10 minutes
	const running = await prisma.scrapeLog.findFirst({
		where: { source, state, status: 'running' }
	});
	if (!running) return false;

	// If the scrape has been "running" for too long, mark it as failed
	if (Date.now() - running.startedAt.getTime() > STALE_TIMEOUT) {
		await prisma.scrapeLog.update({
			where: { id: running.id },
			data: {
				status: 'failed',
				error: 'Timed out (stale run auto-expired)',
				finishedAt: new Date()
			}
		});
		return false;
	}

	return true;
}

/**
 * Get the last successful scrape time for a source
 */
export async function getLastSuccessTime(source, state) {
	const log = await prisma.scrapeLog.findFirst({
		where: { source, state, status: 'success' },
		orderBy: { finishedAt: 'desc' },
		select: { finishedAt: true, totalItems: true }
	});
	return log;
}
