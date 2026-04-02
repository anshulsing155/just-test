import { json } from '@sveltejs/kit';
import { OPENAI_API_KEY, OPENAI_MODEL } from '$env/static/private';

function stripMarkdownFences(text) {
	return text
		.replace(/^```(?:json)?\s*/i, '')
		.replace(/\s*```\s*$/, '')
		.trim();
}

function extractStateDistrict(data) {
	const state = Object.keys(data)[0] ?? '';
	const district = state ? Object.keys(data[state])[0] ?? '' : '';
	return { state, district };
}

/** Group areas by pincode */
function groupByPincode(areaMap) {
	const groups = {};
	for (const [area, pincode] of Object.entries(areaMap)) {
		if (!groups[pincode]) groups[pincode] = [];
		groups[pincode].push(area);
	}
	return groups;
}

export async function POST({ request }) {
	let body;
	try {
		body = await request.json();
	} catch {
		return json({ success: false, error: 'Invalid request body' }, { status: 400 });
	}

	const { data } = body;

	if (!data || typeof data !== 'object') {
		return json({ success: false, error: 'Missing or invalid data field' }, { status: 400 });
	}

	const { state, district } = extractStateDistrict(data);

	if (!state || !district) {
		return json({ success: false, error: 'Data must contain at least one state and district' }, { status: 400 });
	}

	const areaMap = data[state][district];
	const totalAreas = Object.keys(areaMap).length;
	const pincodeGroups = groupByPincode(areaMap);
	const totalPincodes = Object.keys(pincodeGroups).length;

	// Build pincode-grouped block for the prompt
	const groupedLines = Object.entries(pincodeGroups)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([pin, areas]) => `  ${pin} (${areas.length} area${areas.length > 1 ? 's' : ''}): ${areas.join(', ')}`)
		.join('\n');

	const maxZones = 10;
	const minZones = Math.min(Math.max(3, Math.ceil(totalPincodes * 0.4)), maxZones);

	// ─── SYSTEM PROMPT ────────────────────────────────────────────────────────
	const systemPrompt = `You are an expert Indian real estate data analyst and geographic zone classifier.

Your job is to group Indian district area+pincode data into meaningful, user-friendly real estate zones for a property search platform.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT — STRICT JSON ONLY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{
  "state": "",
  "district": "",
  "city": "",
  "total_areas": 0,
  "total_pincodes": 0,
  "summary": "",
  "zones": [
    {
      "name": "",
      "description": "",
      "locality_type": "",
      "pincodes": [],
      "areas": [],
      "keywords": [],
      "highlights": [],
      "connectivity": "",
      "priority": 1
    }
  ]
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FIELD DEFINITIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- state / district / city: from input
- total_areas: exact count of all input areas
- total_pincodes: count of unique pincodes in input
- summary: 2-3 sentence overview of the district real estate landscape

Each zone:
- name: short, well-known local name buyers would search
- description: 1-2 sentences on the zone character and real estate appeal
- locality_type: "urban" | "suburban" | "rural" | "industrial" | "mixed" | "commercial"
- pincodes: ALL pincode strings belonging to this zone
- areas: ALL area names belonging to this zone
- keywords: 4-8 buyer search terms
- highlights: 2-5 notable features
- connectivity: key transport links, highways, metro stations
- priority: 1 = most important (ascending)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE 1 — 100% AREA COVERAGE (CRITICAL)
Every single area listed in the input MUST appear in exactly one zone's "areas" array.
Count the areas you have placed after building your zones. If the count is less than the total, keep adding the missed areas to appropriate zones until every area is placed.

RULE 2 — 100% PINCODE COVERAGE (CRITICAL)
Every single pincode listed in the input MUST appear in exactly one zone's "pincodes" array.

RULE 3 — ZONE COUNT
Produce between ${minZones} and ${maxZones} zones total.
Merge small/adjacent pincodes into one zone to stay within the ${maxZones} cap.

RULE 4 — NO CATCH-ALL ZONE
Do NOT create "Other", "Miscellaneous", "Remaining", or any catch-all zone.
Every area must go into a zone with a real geographic name.
For areas that don't fit neatly, group them with geographically adjacent areas or create a directional zone: "North ${district}", "Outer ${district}", "Rural ${district}", "Eastern ${district} Belt".

RULE 5 — ZONE NAMING
- Use the most prominent area name or landmark in the group
- For rural/peripheral pincodes use directional + district name
- Never use "Zone 1", "Area A", or generic placeholders

RULE 6 — RETURN ONLY JSON
No markdown fences, no explanatory text. Pure JSON only.`;

	// ─── USER PROMPT ──────────────────────────────────────────────────────────
	const userPrompt = `Generate real estate zones for this Indian district.

State: ${state}
District: ${district}
Total areas: ${totalAreas} — YOU MUST PLACE ALL ${totalAreas} AREAS
Unique pincodes: ${totalPincodes} — YOU MUST COVER ALL ${totalPincodes} PINCODES
Max zones: ${maxZones}

━━ AREAS GROUPED BY PINCODE (your source of truth) ━━
${groupedLines}

━━ CHECKLIST BEFORE OUTPUTTING ━━
Before writing the final JSON, verify:
[ ] Every pincode above appears in exactly one zone's "pincodes" array
[ ] Every area above appears in exactly one zone's "areas" array
[ ] Area count across all zones = ${totalAreas}
[ ] Pincode count across all zones = ${totalPincodes}
[ ] No zone is named "Other" or any catch-all variant
[ ] Total zones ≤ ${maxZones}`;

	try {
		const res = await fetch('https://api.openai.com/v1/responses', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${OPENAI_API_KEY}`
			},
			body: JSON.stringify({
				model: 'gpt-4o',
				tools: [{ type: 'web_search_preview' }],
				tool_choice: 'auto',
				max_output_tokens: 4096,
				temperature: 0,
				input: [
					{ role: 'system', content: systemPrompt },
					{ role: 'user', content: userPrompt }
				]
			})
		});

		if (!res.ok) {
			const errBody = await res.json().catch(() => ({}));
			return json({
				success: false,
				error: errBody?.error?.message ?? `OpenAI API error: ${res.status}`
			});
		}

		const result = await res.json();

		// Responses API: output is an array; find the message item and extract text
		const outputItem = result.output?.find((o) => o.type === 'message');
		const outputText = outputItem?.content
			?.filter((b) => b.type === 'output_text')
			?.map((b) => b.text)
			?.join('') ?? '';

		if (!outputText) {
			return json({ success: false, error: 'OpenAI returned no content' });
		}

		let output;
		try {
			output = JSON.parse(stripMarkdownFences(outputText));
		} catch (parseError) {
			return json({
				success: false,
				error: `Failed to parse OpenAI response as JSON: ${parseError.message}`
			});
		}

		if (!output.zones || !Array.isArray(output.zones)) {
			return json({ success: false, error: 'OpenAI response missing zones array' });
		}

		output.total_areas = totalAreas;
		output.total_pincodes = totalPincodes;
		// Send the raw areaMap so the client can validate coverage
		output._areaMap = areaMap;

		return json({ success: true, output });
	} catch (err) {
		return json({ success: false, error: err.message });
	}
}
