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
	const district = state ? (Object.keys(data[state])[0] ?? '') : '';
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
		return json(
			{ success: false, error: 'Data must contain at least one state and district' },
			{ status: 400 }
		);
	}

	const areaMap = data[state][district];
	const totalAreas = Object.keys(areaMap).length;
	const pincodeGroups = groupByPincode(areaMap);
	const totalPincodes = Object.keys(pincodeGroups).length;

	// Build pincode-grouped block for the prompt
	const groupedLines = Object.entries(pincodeGroups)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(
			([pin, areas]) =>
				`  ${pin} (${areas.length} area${areas.length > 1 ? 's' : ''}): ${areas.join(', ')}`
		)
		.join('\n');

	const maxZones = 15;
	const minZones = Math.min(Math.max(3, Math.ceil(totalPincodes * 0.4)), maxZones);

	// ─── SYSTEM PROMPT ────────────────────────────────────────────────────────
	// 	const systemPrompt = `You are an expert Indian real estate data analyst and geographic zone classifier.

	// Your job is to group Indian district area+pincode data into meaningful, user-friendly real estate zones for a property search platform.

	// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
	// OUTPUT FORMAT — STRICT JSON ONLY
	// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
	// {
	//   "state": "",
	//   "district": "",
	//   "city": "",
	//   "total_areas": 0,
	//   "total_pincodes": 0,
	//   "summary": "",
	//   "zones": [
	//     {
	//       "name": "",
	//       "description": "",
	//       "locality_type": "",
	//       "pincodes": [],
	//       "areas": [],
	//       "keywords": [],
	//       "highlights": [],
	//       "connectivity": "",
	//       "priority": 1
	//     }
	//   ]
	// }

	// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
	// FIELD DEFINITIONS
	// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
	// - state / district / city: from input
	// - total_areas: exact count of all input areas
	// - total_pincodes: count of unique pincodes in input
	// - summary: 2-3 sentence overview of the district real estate landscape

	// Each zone:
	// - name: short, well-known local name buyers would search
	// - description: 1-2 sentences on the zone character and real estate appeal
	// - locality_type: "urban" | "suburban" | "rural" | "industrial" | "mixed" | "commercial"
	// - pincodes: ALL pincode strings belonging to this zone
	// - areas: ALL area names belonging to this zone
	// - keywords: 4-8 buyer search terms
	// - highlights: 2-5 notable features
	// - connectivity: key transport links, highways, metro stations
	// - priority: 1 = most important (ascending)

	// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
	// RULES
	// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
	// RULE 1 — 100% AREA COVERAGE (CRITICAL)
	// Every single area listed in the input MUST appear in exactly one zone's "areas" array.
	// Count the areas you have placed after building your zones. If the count is less than the total, keep adding the missed areas to appropriate zones until every area is placed.

	// RULE 2 — 100% PINCODE COVERAGE (CRITICAL)
	// Every single pincode listed in the input MUST appear in exactly one zone's "pincodes" array.

	// RULE 3 — ZONE COUNT
	// Produce between ${minZones} and ${maxZones} zones total.
	// Merge small/adjacent pincodes into one zone to stay within the ${maxZones} cap.

	// RULE 4 — NO CATCH-ALL ZONE
	// Do NOT create "Other", "Miscellaneous", "Remaining", or any catch-all zone.
	// Every area must go into a zone with a real geographic name.
	// For areas that don't fit neatly, group them with geographically adjacent areas or create a directional zone: "North ${district}", "Outer ${district}", "Rural ${district}", "Eastern ${district} Belt".

	// RULE 5 — ZONE NAMING
	// - Use the most prominent area name or landmark in the group
	// - For rural/peripheral pincodes use directional + district name
	// - Never use "Zone 1", "Area A", or generic placeholders

	// RULE 6 — RETURN ONLY JSON
	// No markdown fences, no explanatory text. Pure JSON only.`;

	const systemPrompt = `
You are a real estate data structuring engine.

Your task is to convert area + pincode data into publicly recognized real estate zones across ANY Indian state or district.

OUTPUT FORMAT (STRICT JSON ONLY):

{
  "city": "",
  "zones": [
    {
      "name": "",
      "pincodes": [],
      "areas": [],
      "keywords": []
    }
  ]
}

━━━━━━━━━━ CORE OBJECTIVE ━━━━━━━━━━

Create NATURAL REAL ESTATE ZONES that reflect how people actually refer to locations in real life across India.

Zones must work for:
- Metro cities
- Tier 2 / Tier 3 cities
- Towns
- Semi-urban regions
- Rural clusters (if applicable)

━━━━━━━━━━ RULES ━━━━━━━━━━

1. NO PINCODE MISSING
- Every pincode MUST appear in at least one zone

2. MULTI-PINCODE ZONE PRIORITY (CRITICAL)
- A zone SHOULD contain MULTIPLE pincodes whenever naturally possible
- DO NOT create single-pincode zones unless:
  - The area is geographically isolated, OR
  - It is a well-known standalone locality/town

- Ideal structure:
  ✔ 2–5 pincodes per zone (typical)
  ✔ More if they belong to same locality cluster

3. AREA-FIRST CLUSTERING (MOST IMPORTANT RULE)
- Group areas based on:
  ✔ Geographic proximity
  ✔ Real-world locality identity

- Pincode is secondary — NEVER the primary grouping factor

- If multiple pincodes belong to same locality:
  → They MUST be grouped into ONE zone

4. PROXIMITY RULE (STRICT)
- Areas in one zone must:
  ✔ Be adjacent OR closely connected
  ✔ Fall within ~2–5 km (urban) or reasonable local radius (rural)

- Must feel like SAME neighborhood or cluster to a local resident

5. MICRO-MARKET IDENTITY RULE
- A zone must represent a SINGLE real estate market

- DO NOT merge if areas:
  ✖ Belong to different towns or municipalities
  ✖ Have distinct market identities
  ✖ Are separated by major barriers (highways, rivers, industrial belts, etc.)

6. SMART MERGING (MANDATORY STEP)
- After initial clustering, MERGE zones if they:
  ✔ Represent the same commonly known locality
  ✔ Are frequently grouped together in property listings
  ✔ Share strong geographic continuity

- Avoid unnecessary fragmentation

7. AVOID OVER-FRAGMENTATION
- Prefer meaningful clusters over tiny zones
- If two zones feel similar or overlapping → MERGE them

8. PUBLICLY USED ZONE NAMES (PAN-INDIA)
- Use names commonly recognized in:
  ✔ Property listing platforms
  ✔ Maps and navigation
  ✔ Daily conversation

- Acceptable naming patterns:
  ✔ Locality names
  ✔ Sector-based clusters
  ✔ Nagar / Extension / Layout / Colony / Village clusters
  ✔ Highway or corridor-based clusters (if commonly used)

- Avoid:
  ✖ Artificial names (Zone 1, Cluster A, Other)
  ✖ Rare or internal administrative labels

9. LANDMARK & LOCALITY ANCHORING
- Prefer zones built around:
  ✔ Well-known localities
  ✔ Residential hubs
  ✔ Market areas
  ✔ Town centers

- If exact match not available:
  → Use nearest widely recognized locality

10. DEDUPLICATION
- Each zone name must be UNIQUE
- Merge zones if names are identical

- Remove:
  ✖ Duplicate pincodes
  ✖ Duplicate areas

11. CLEAN STRUCTURE
- No empty arrays
- Each area appears ONLY once across all zones
- Each pincode must be included

12. NO HALLUCINATION
- Do NOT invent new locality names
- Only use realistic, highly probable names

- If unsure:
  → Map to nearest known locality instead of guessing

13. RURAL / SEMI-URBAN HANDLING
- If areas are villages or spread-out regions:
  ✔ Group based on nearest town or cluster center
  ✔ Use commonly known regional grouping names

14. FINAL VALIDATION (MANDATORY)
Before output:
[ ] Every pincode is included
[ ] Every area is included
[ ] Zones reflect real-world locality grouping
[ ] Most zones contain MULTIPLE pincodes
[ ] No unnecessary micro-zones
[ ] No duplicate zone names

15. OUTPUT ONLY JSON
- No explanation
- No markdown
- No extra text


`;
	// ─── USER PROMPT ──────────────────────────────────────────────────────────
// 	const userPrompt = `Generate real estate zones for this Indian district.

// State: ${state}
// District: ${district}
// Total areas: ${totalAreas} — YOU MUST PLACE ALL ${totalAreas} AREAS
// Unique pincodes: ${totalPincodes} — YOU MUST COVER ALL ${totalPincodes} PINCODES


// ━━ AREAS GROUPED BY PINCODE (your source of truth) ━━
// ${groupedLines}

// ━━ CHECKLIST BEFORE OUTPUTTING ━━
// Before writing the final JSON, verify:
// [ ] Every pincode above appears in exactly one zone's "pincodes" array
// [ ] Every area above appears in exactly one zone's "areas" array
// [ ] Area count across all zones = ${totalAreas}
// [ ] Pincode count across all zones = ${totalPincodes}
// [ ] No zone is named "Other" or any catch-all variant;

// ━━IMPORTANT━━:
// - Prefer fewer, well-formed zones with multiple pincodes
// - Avoid creating unnecessary small zones
// - Focus on real-world locality grouping, not strict pincode separation`;

const userPrompt = `
Generate real estate zones for:

State: ${state}
District: ${district}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AREAS GROUPED BY PINCODE
(This is your only source of truth. Do not add or remove any entries.)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${groupedLines}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COUNTS TO MATCH EXACTLY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Total areas: ${totalAreas}
Unique pincodes: ${totalPincodes}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 1 — THINK BEFORE YOU OUTPUT (internal reasoning only, do not include in output)

Before writing JSON, mentally do the following:

1. List every pincode and its areas
2. For each area, decide which zone it belongs to based on geographic proximity
3. Name that zone using Rule 1 (must be a known locality, tehsil, or block — not invented)
4. If any area has no clear zone → assign it to "<nearest known place> — <pincode>"
5. Confirm: area count = ${totalAreas}, pincode coverage = ${totalPincodes}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 2 — OUTPUT JSON ONLY

After completing Step 1 internally, output only the final JSON.
No commentary. No markdown fences. No explanation.
`;

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
		const outputText =
			outputItem?.content
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
