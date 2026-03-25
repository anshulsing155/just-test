import { prisma } from '../db.js';

/**
 * Get or create a chat session, return messages history for OpenAI format.
 * @param {string} sessionId
 * @returns {Array<{ role: string, content: string }>}
 */
export async function getOrCreateSession(sessionId) {
	let session = await prisma.chatSession.findUnique({
		where: { sessionId },
		include: {
			messages: {
				orderBy: { createdAt: 'asc' },
				take: 20 // limit context window
			}
		}
	});

	if (!session) {
		session = await prisma.chatSession.create({
			data: {
				sessionId,
				messages: {
					create: {
						role: 'system',
						content:
							'You are a helpful virtual assistant for a RERA Toolkit web application. Help users with RERA registration queries, agent verification, promoter lookup, and loan information. Be concise and helpful.'
					}
				}
			},
			include: { messages: { orderBy: { createdAt: 'asc' } } }
		});
	}

	return session;
}

/**
 * Add a message to a session
 * @param {string} sessionId - the session's DB id (ObjectId)
 * @param {string} role - 'user' | 'assistant'
 * @param {string} content
 */
export async function addMessage(sessionId, role, content) {
	return prisma.chatMessage.create({
		data: {
			role,
			content,
			sessionId
		}
	});
}

/**
 * Get messages formatted for OpenAI API
 * @param {string} sessionId
 * @returns {Array<{ role: string, content: string }>}
 */
export async function getMessagesForOpenAI(sessionId) {
	const session = await prisma.chatSession.findUnique({
		where: { sessionId },
		include: {
			messages: {
				orderBy: { createdAt: 'asc' },
				take: 20
			}
		}
	});

	if (!session) return [];

	return session.messages.map((m) => ({
		role: m.role,
		content: m.content
	}));
}

/**
 * Prune old messages to keep context window manageable.
 * Keeps system message + last N exchanges.
 */
export async function pruneMessages(sessionDbId, keepCount = 10) {
	const messages = await prisma.chatMessage.findMany({
		where: { sessionId: sessionDbId },
		orderBy: { createdAt: 'asc' }
	});

	if (messages.length <= keepCount + 1) return; // +1 for system message

	// Keep system message (first) + last keepCount messages
	const toDelete = messages.slice(1, messages.length - keepCount);
	if (toDelete.length > 0) {
		await prisma.chatMessage.deleteMany({
			where: { id: { in: toDelete.map((m) => m.id) } }
		});
	}
}
