import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { ChatService } from '$lib/server/services/index.js';

export async function POST({ request }) {
	try {
		const { query, sessionId = 'default' } = await request.json();

		if (!query || typeof query !== 'string') {
			return json({ response: 'Please provide a valid query.' }, { status: 400 });
		}

		// Quick keyword responses (no DB / API needed)
		const q = query.toLowerCase();
		if (/^(hello|hi|hey)\b/.test(q)) {
			return json({ response: 'Hello! How can I help you today?' });
		}
		if (q.includes('what time') || q === 'time') {
			return json({ response: `The current time is ${new Date().toLocaleTimeString()}.` });
		}
		if (q.includes('what date') || q.includes("today's date") || q === 'date') {
			return json({ response: `Today is ${new Date().toLocaleDateString()}.` });
		}

		// Get or create DB-backed session
		const session = await ChatService.getOrCreateSession(sessionId);

		// Add user message
		await ChatService.addMessage(session.id, 'user', query);

		// Build messages for OpenAI
		const messages = await ChatService.getMessagesForOpenAI(sessionId);

		// Call OpenAI
		const apiKey = env.OPENAI_API_KEY;
		if (!apiKey) {
			return json({
				response:
					"The assistant API isn't configured yet (missing OPENAI_API_KEY). I can still help with basic queries."
			});
		}

		try {
			const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${apiKey}`
				},
				body: JSON.stringify({
					model: env.OPENAI_MODEL || 'gpt-3.5-turbo',
					messages,
					max_tokens: 150
				})
			});

			const data = await openaiResponse.json();

			if (!data.choices?.length) {
				throw new Error('Invalid response from OpenAI');
			}

			const botResponse = data.choices[0].message.content;

			// Persist assistant reply
			await ChatService.addMessage(session.id, 'assistant', botResponse);

			// Prune old messages to keep context manageable
			await ChatService.pruneMessages(session.id, 10);

			return json({ response: botResponse });
		} catch (aiError) {
			console.error('[Assistant] OpenAI error:', aiError);

			const fallbacks = [
				"I'm having trouble connecting to my knowledge base right now.",
				'I seem to be experiencing some technical difficulties. Could you try again?',
				'My advanced capabilities are temporarily unavailable. I can still help with basic queries.'
			];

			return json({
				response: fallbacks[Math.floor(Math.random() * fallbacks.length)]
			});
		}
	} catch (error) {
		console.error('[Assistant] Error:', error);
		return json(
			{ response: 'Sorry, I encountered an error processing your request.' },
			{ status: 500 }
		);
	}
}
