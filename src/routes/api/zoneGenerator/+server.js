import { json } from '@sveltejs/kit';
import { OPENAI_API_KEY, OPENAI_MODEL } from '$env/static/private';

export async function POST({ request }) {
	const { data } = await request.json();

	// ✅ SYSTEM PROMPT (rules)
	const systemPrompt = `
You are a real estate data structuring engine.

Your task is to convert area + pincode data into user-friendly real estate zones.

OUTPUT FORMAT (STRICT JSON ONLY):

{
  "city": "",
  "zones": [
    {
      "name": "",
      "pincodes": [],
      "areas": [],
      "keywords": [],
      "priority": 1
    }
  ]
}

RULES:

1. NO PINCODE MISSING
- Every pincode from input MUST appear in at least one zone

2. USER-FRIENDLY ZONES
- Use names like "Noida Extension", "Whitefield", etc.

3. LIMIT ZONES
- al less than 10 zones per city

4. PRIORITY
- Lower number = higher importance

5. INCLUDE "Other" ZONE with priority 999

6. RETURN ONLY JSON (NO TEXT)
`;

	// ✅ USER PROMPT (actual data)
	const userPrompt = `
Process the following district data:

${JSON.stringify(data, null, 2)}
`;

	try {
		const res = await fetch('https://api.openai.com/v1/chat/completions', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${OPENAI_API_KEY}`
			},
			body: JSON.stringify({
				model: OPENAI_MODEL || 'gpt-3.5-turbo',
			
				messages: [
					{ role: 'system', content: systemPrompt },
					{ role: 'user', content: userPrompt }
				]
			})
		});

		const result = await res.json();

		const outputText = result.choices?.[0]?.message?.content;

		if (!outputText) {
			const errorMessage = result.error?.message || 'OpenAI returned no content';
			return json({ success: false, error: errorMessage });
		}

		let output;
		try {
			output = JSON.parse(outputText);
		} catch (parseError) {
			return json({
				success: false,
				error: `OpenAI returned invalid JSON: ${parseError.message}`
			});
		}

		return json({
			success: true,
			output
		});
	} catch (err) {
		return json({ success: false, error: err.message });
	}
}
