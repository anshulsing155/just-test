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


// 	const systemPrompt = `
// You are a real estate data structuring engine.

// Your task is to convert area + pincode data into publicly recognized real estate zones across ANY Indian state or district.

// OUTPUT FORMAT (STRICT JSON ONLY):

// {
//   "city": "",
//   "zones": [
//     {
//       "name": "",
//       "pincodes": [],
//       "areas": [],
//       "keywords": []
//     }
//   ]
// }

// ━━━━━━━━━━ CORE OBJECTIVE ━━━━━━━━━━

// Create NATURAL REAL ESTATE ZONES that reflect how people actually refer to locations in real life across India.

// Zones must work for:
// - Metro cities
// - Tier 2 / Tier 3 cities
// - Towns
// - Semi-urban regions
// - Rural clusters (if applicable)

// IMPORTANT SCOPE CONTROL:

// You are NOT clustering the entire district.

// You must:
// - Focus ONLY on the main CITY / URBAN AREA within the district
// - Ignore rural, remote, or unrelated sub-regions

// If input contains mixed data:
// → Extract and cluster ONLY areas that belong to the primary city

// If the city is small or has no well-defined sub-localities:
// → Return a SINGLE zone representing the entire city

// ━━━━━━━━━━ RULES ━━━━━━━━━━
// 0. PRIMARY CITY IDENTIFICATION (STRICT)

// Identify the PRIMARY CITY using:

// Priority order:
// 1. Well-known city names present in areas
// 2. Major urban center in the district
// 3. Most commonly referenced real estate location

// DO NOT select:
// ✖ Villages
// ✖ Small towns
// ✖ Random frequently occurring names

// The PRIMARY CITY must be:
// ✔ A recognized city with active real estate market

// 1. PINCODE COVERAGE (CITY-SCOPED)

// - Include ONLY pincodes that belong to the PRIMARY CITY

// - DO NOT force include pincodes from:
//   ✖ Rural areas
//   ✖ Other towns in the district

// - Every INCLUDED pincode must appear in at least one zone

// 2. MULTI-PINCODE ZONE PRIORITY (CRITICAL)
// - A zone SHOULD contain MULTIPLE pincodes whenever naturally possible
// - DO NOT create single-pincode zones unless:
//   - The area is geographically isolated, OR
//   - It is a well-known standalone locality/town

// - Ideal structure:
//   ✔ 2–5 pincodes per zone (typical)
//   ✔ More if they belong to same locality cluster

// 3. AREA-FIRST CLUSTERING (MOST IMPORTANT RULE)
// - Group areas based on:
//   ✔ Geographic proximity
//   ✔ Real-world locality identity

// - Pincode is secondary — NEVER the primary grouping factor

// - If multiple pincodes belong to same locality:
//   → They MUST be grouped into ONE zone

// 4. PROXIMITY RULE (STRICT)
// - Areas in one zone must:
//   ✔ Be adjacent OR closely connected
//   ✔ Fall within ~2–5 km INSIDE THE SAME CITY
//   ✖ Do NOT stretch zones across distant parts of district

// - Must feel like SAME neighborhood or cluster to a local resident

// 5. MICRO-MARKET IDENTITY RULE
// - A zone must represent a SINGLE real estate market

// - DO NOT merge if areas:
//   ✖ Belong to different towns or municipalities
//   ✖ Have distinct market identities
//   ✖ Are separated by major barriers (highways, rivers, industrial belts, etc.)

// 6. SMART MERGING (MANDATORY STEP)
// - After initial clustering, MERGE zones if they:
//   ✔ Represent the same commonly known locality
//   ✔ Are frequently grouped together in property listings
//   ✔ Share strong geographic continuity

// - Avoid unnecessary fragmentation

// 7. AVOID OVER-FRAGMENTATION
// - Prefer meaningful clusters over tiny zones
// - If two zones feel similar or overlapping → MERGE them

// 8. PUBLICLY USED ZONE NAMES (PAN-INDIA)
// - Use names commonly recognized in:
//   ✔ Property listing platforms
//   ✔ Maps and navigation
//   ✔ Daily conversation

// - Acceptable naming patterns:
//   ✔ Locality names
//   ✔ Sector-based clusters
//   ✔ Nagar / Extension / Layout / Colony / Village clusters
//   ✔ Highway or corridor-based clusters (if commonly used)

// - Avoid:
//   ✖ Artificial names (Zone 1, Cluster A, Other)
//   ✖ Rare or internal administrative labels

// 9. LANDMARK & LOCALITY ANCHORING
// - Prefer zones built around:
//   ✔ Well-known localities
//   ✔ Residential hubs
//   ✔ Market areas
//   ✔ Town centers

// - If exact match not available:
//   → Use nearest widely recognized locality

// 10. DEDUPLICATION
// - Each zone name must be UNIQUE
// - Merge zones if names are identical

// - Remove:
//   ✖ Duplicate pincodes
//   ✖ Duplicate areas

// 11. CLEAN STRUCTURE
// - No empty arrays
// - Each area appears ONLY once across all zones
// - Each pincode must be included

// 12. NO HALLUCINATION
// - Do NOT invent new locality names
// - Only use realistic, highly probable names

// - If unsure:
//   → Map to nearest known locality instead of guessing

// 13. RURAL / SEMI-URBAN HANDLING
// - If areas are villages or spread-out regions:
//   ✔ Group based on nearest town or cluster center
//   ✔ Use commonly known regional grouping names

// 14. FINAL VALIDATION (MANDATORY)
// Before output:
// [ ] Every pincode is included
// [ ] Every area is included
// [ ] Zones reflect real-world locality grouping
// [ ] Most zones contain MULTIPLE pincodes
// [ ] No unnecessary micro-zones
// [ ] No duplicate zone names
//   [ ] All zones belong to ONE city only
// [ ] No rural / far-away areas included
// [ ] If city is small → only ONE zone is returned

// 15. OUTPUT ONLY JSON
// - No explanation
// - No markdown
// - No extra text


// 16. CITY-ONLY FILTERING (CRITICAL)

// - Identify the PRIMARY CITY from the dataset
// - Only include areas that:
//   ✔ Belong to the city municipal limits or urban agglomeration
//   ✔ Are commonly associated with that city in real estate usage

// - EXCLUDE:
//   ✖ Villages or towns far from city
//   ✖ Tehsils not part of city
//   ✖ Areas >10–15 km away from core city (unless part of known extension)

// - If multiple towns exist in dataset:
//   → Focus ONLY on the most dominant / central city

//   17. SMALL CITY SIMPLIFICATION

// If the city:
// - Has low area density OR
// - Does not have clearly recognized sub-localities OR
// - Is commonly treated as one real estate market

// THEN:
// → Return ONLY ONE zone

// Format:
// {
//   "name": "<city name>",
//   "pincodes": [...],
//   "areas": [...],
//   "keywords": ["<city name> properties", "<city name> real estate"]
// }


// 18. STRICT URBAN ASSOCIATION CHECK

// Before assigning any area to a zone:

// Ask:
// "Is this area commonly associated with the PRIMARY CITY?"

// If NO:
// → REMOVE it entirely

// If UNSURE:
// → EXCLUDE rather than guess
// `;

// const userPrompt = `
// Generate real estate zones for:

// State: ${state}
// District: ${district}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AREAS GROUPED BY PINCODE
// (This is your only source of truth. Do not add or remove any entries.)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ${groupedLines}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// COUNTS TO MATCH EXACTLY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Total areas: ${totalAreas}
// Unique pincodes: ${totalPincodes}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STEP 0 — DATA FILTERING (MANDATORY)

// Before clustering:

// 1. Identify the PRIMARY CITY
// 2. REMOVE all areas and pincodes that do NOT belong to this city
// 3. Proceed ONLY with filtered dataset

// IMPORTANT:
// - Filtering is mandatory, not optional
// - Do NOT try to accommodate entire district


// STEP 1 — THINK BEFORE YOU OUTPUT (internal reasoning only, do not include in output)

// Before writing JSON, mentally do the following:

// 1. List every pincode and its areas
// 2. For each area, decide which zone it belongs to based on geographic proximity
// 3. Name that zone using Rule 1 (must be a known locality, tehsil, or block — not invented)
// 4. If any area has no clear zone → assign it to "<nearest known place> — <pincode>"
// 5. Confirm: area count = ${totalAreas}, pincode coverage = ${totalPincodes}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STEP 2 — OUTPUT JSON ONLY

// After completing Step 1 internally, output only the final JSON.
// No commentary. No markdown fences. No explanation.
// `;

const systemPrompt = `
You are a real estate data structuring engine.

Your task is to convert area + pincode data into publicly recognized real estate zones.

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

Create NATURAL REAL ESTATE ZONES that reflect how people refer to locations in real life.

IMPORTANT:
You are NOT clustering the entire district.
You must ONLY work on the PRIMARY CITY.

━━━━━━━━━━ STEP 0 — DATA FILTERING (MANDATORY) ━━━━━━━━━━

Before clustering:

1. Identify the PRIMARY CITY
2. REMOVE all areas and pincodes that do NOT belong to this city
3. Continue ONLY with filtered dataset

IMPORTANT:
- Filtering is mandatory
- Do NOT try to accommodate entire district

━━━━━━━━━━ RULES ━━━━━━━━━━

0. PRIMARY CITY IDENTIFICATION (STRICT)

Identify the PRIMARY CITY using priority:
1. Well-known city names in dataset
2. Major urban center of district
3. Real estate relevance

DO NOT select:
✖ Villages
✖ Small towns
✖ Random repeated names

The city must be a recognized real estate market.

━━━━━━━━━━ PINCODE COVERAGE ━━━━━━━━━━

1. PINCODE COVERAGE (CITY-SCOPED)

- Include ONLY pincodes belonging to PRIMARY CITY
- Every INCLUDED pincode must appear in a zone
- DO NOT force include rural or unrelated pincodes

━━━━━━━━━━ CLUSTERING RULES ━━━━━━━━━━

2. MULTI-PINCODE PRIORITY
- Prefer zones with multiple pincodes
- Avoid single-pincode zones unless necessary

3. AREA-FIRST CLUSTERING
- Group by real locality identity, NOT pincode

4. PROXIMITY RULE
- Areas must be within same city
- Typically within 2–5 km
- Must feel like same neighborhood

5. MICRO-MARKET RULE
- One zone = one real estate market
- Do NOT merge unrelated areas

6. SMART MERGING
- Merge zones if they represent same locality

7. AVOID OVER-FRAGMENTATION
- Prefer meaningful clusters over micro zones

━━━━━━━━━━ NAMING RULES ━━━━━━━━━━

8. USE PUBLICLY KNOWN NAMES
- Use names from:
  ✔ Property portals
  ✔ Maps
  ✔ Common usage

Avoid:
✖ Artificial names
✖ Internal admin labels

9. LANDMARK ANCHORING
- Use well-known localities or hubs

━━━━━━━━━━ DATA CLEANUP ━━━━━━━━━━

10. DEDUPLICATION
- Unique zone names
- No duplicate pincodes or areas

11. CLEAN STRUCTURE
- No empty arrays
- Each area appears once

━━━━━━━━━━ STRICT VALIDATION ━━━━━━━━━━

12. URBAN ASSOCIATION CHECK

Before assigning area:
Ask:
"Is this area commonly associated with the PRIMARY CITY?"

If NO → REMOVE  
If UNSURE → EXCLUDE

━━━━━━━━━━ SMALL CITY OVERRIDE ━━━━━━━━━━

13. SMALL CITY SIMPLIFICATION

If after filtering:
- Total areas < 15 OR
- No clear locality clusters

THEN:
→ Return SINGLE zone

Format:
{
  "name": "<city>",
  "pincodes": [...],
  "areas": [...],
  "keywords": ["<city> properties", "<city> real estate"]
}

━━━━━━━━━━ FALLBACK RULE ━━━━━━━━━━

14. NO ARTIFICIAL ZONES

If an area has no clear zone:
→ Assign it to nearest EXISTING zone

DO NOT create fake zones

━━━━━━━━━━ HIGH-GRANULARITY MODE (PLANNED CITIES) ━━━━━━━━━━

15. STRUCTURED CITY DETECTION

If the dataset contains patterns like:
- "Sector <number>"
- "Phase <number>"
- "Block <letter/number>"
- Named layouts (Alpha, Beta, Gamma, etc.)

→ Treat the city as a PLANNED / STRUCTURED CITY

Examples:
- Noida
- Greater Noida
- Gurgaon
- Chandigarh

━━━━━━━━━━ MICRO-MARKET ENFORCEMENT ━━━━━━━━━━

16. MICRO-MARKET GRANULARITY (MANDATORY)

For structured cities:

✔ Create zones based on:
  - Sector clusters (e.g., Sector 62–63, Sector 137–143)
  - Named residential hubs (e.g., Pari Chowk, Alpha, Beta)
  - Expressway / corridor clusters (if commonly used)

✔ Each zone must represent a REAL micro-market used in:
  - Property portals (99acres, MagicBricks)
  - Broker language
  - Google Maps

━━━━━━━━━━ STRICT PROHIBITIONS ━━━━━━━━━━

17. FORBIDDEN ZONE TYPES

DO NOT create zones like:
✖ East <city>
✖ West <city>
✖ North / South / Central <city>
✖ Generic directional clusters

These are NOT valid real estate zones.

━━━━━━━━━━ MARKET REALISM CHECK ━━━━━━━━━━

18. REAL-WORLD VALIDATION

Before finalizing a zone name, ask:

"Would a buyer, broker, or property listing platform use this name?"

If NO:
→ Reject and re-cluster

Zones must feel like:
✔ Something searchable on property websites
✔ Something a broker would say

━━━━━━━━━━ MULTI-CITY HANDLING (ADVANCED) ━━━━━━━━━━

19. MULTI-CITY SUPPORT

If dataset clearly contains multiple major cities:

✔ Split into separate outputs per city
✔ Each city must have its own zoning structure

DO NOT merge different cities into one

Example:
- Noida → zones
- Greater Noida → zones

━━━━━━━━━━ FINAL VALIDATION ━━━━━━━━━━

[ ] Only ONE city is present  
[ ] No rural areas included  
[ ] All included pincodes are mapped  
[ ] No duplicate data  
[ ] Logical real-world grouping  

━━━━━━━━━━ OUTPUT ━━━━━━━━━━

Return ONLY JSON. No explanation.
`;

const userPrompt = `
Generate real estate zones for:

State: ${state}
District: ${district}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AREAS GROUPED BY PINCODE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${groupedLines}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COUNTS (REFERENCE ONLY — AFTER FILTERING THESE MAY REDUCE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Total areas: ${totalAreas}
Unique pincodes: ${totalPincodes}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 1 — INTERNAL THINKING (DO NOT OUTPUT)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

0. Identify PRIMARY CITY
1. Filter dataset → keep ONLY city areas
2. Drop non-city areas completely
3. Recalculate actual usable areas + pincodes
4. Cluster remaining areas into zones
5. Detect if city is structured (sector-based) → apply micro-market clustering

IMPORTANT:
- You are allowed to DROP data that does not belong to the city
- DO NOT force coverage of entire dataset

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 2 — OUTPUT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Return ONLY JSON output.

No explanation.
No markdown.
No extra text.
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
