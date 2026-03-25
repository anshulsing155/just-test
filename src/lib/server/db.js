import { PrismaClient } from '@prisma/client';

// Singleton pattern: reuse the same client across hot reloads in dev
const globalForPrisma = globalThis;

/** @type {PrismaClient | null} */
let _prisma = globalForPrisma.__prisma || null;

/**
 * Get Prisma client instance (lazy-initialized).
 * This avoids connection errors during build/prerender.
 * @returns {PrismaClient}
 */
export function getPrisma() {
	if (!_prisma) {
		_prisma = new PrismaClient({
			log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error']
		});
		if (process.env.NODE_ENV === 'development') {
			globalForPrisma.__prisma = _prisma;
		}
	}
	return _prisma;
}

// Proxy defers actual PrismaClient creation until first use
/** @type {PrismaClient} */
export const prisma = new Proxy(/** @type {any} */ ({}), {
	get(_target, prop) {
		return getPrisma()[prop];
	}
});
