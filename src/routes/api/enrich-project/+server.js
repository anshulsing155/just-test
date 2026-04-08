import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { prisma } from '$lib/server/db.js';

// ── State helpers ─────────────────────────────────────────────────────────────

const STATE_LABELS = {
	'UP':          'Uttar Pradesh',
	'DL':          'Delhi',
	'MH':          'Maharashtra',
	'PB':          'Punjab',
	'TS':          'Telangana',
	'MP':          'Madhya Pradesh',
	'RJ':          'Rajasthan',
	'HR':          'Haryana',
	'GJ':          'Gujarat',
	'KA':          'Karnataka',
	'TN':          'Tamil Nadu',
	'WB':          'West Bengal',
};

/** Expand abbreviation to full state name for search prompts */
function stateLabel(s) {
	return STATE_LABELS[s?.toUpperCase()] ?? s ?? 'India';
}

/** RERA portal search API / page URL for each state */
function reraPortalUrl(stateCode, reraRegNo) {
	const code = stateCode?.toUpperCase();
	if (!reraRegNo) return null;
	switch (code) {
		case 'UP': return `https://www.uprera.in/ProjectDetails?regnum=${reraRegNo}`;
		case 'DL': return `https://rera.delhi.gov.in`;
		case 'MH': return `https://maharera.mahaonline.gov.in`;
		case 'PB': return `https://rera.punjab.gov.in`;
		case 'TS': return `https://rera.telangana.gov.in`;
		case 'MP': return `https://rera.mp.gov.in`;
		case 'RJ': return `https://rera.rajasthan.gov.in`;
		default:   return null;
	}
}

/**
 * Directly fetch the RERA portal page and strip HTML tags to plain text.
 * Many portals serve server-side rendered HTML that contains the project data
 * even though the browser view is JS-enhanced. Returns null on failure.
 */
async function fetchReraPageText(url) {
	try {
		const res = await fetch(url, {
			headers: {
				'User-Agent': 'Mozilla/5.0 (compatible; RERADataBot/1.0)',
				'Accept': 'text/html,application/xhtml+xml'
			},
			signal: AbortSignal.timeout(8000)
		});
		if (!res.ok) return null;
		const html = await res.text();
		// Strip scripts, styles, comments
		const stripped = html
			.replace(/<script[\s\S]*?<\/script>/gi, '')
			.replace(/<style[\s\S]*?<\/style>/gi, '')
			.replace(/<!--[\s\S]*?-->/g, '')
			.replace(/<[^>]+>/g, ' ')          // remove all tags
			.replace(/&nbsp;/gi, ' ')
			.replace(/&amp;/gi, '&')
			.replace(/&lt;/gi, '<')
			.replace(/&gt;/gi, '>')
			.replace(/\s{2,}/g, ' ')           // collapse whitespace
			.trim();
		// Only useful if it has meaningful content (JS-only pages are ~empty)
		return stripped.length > 200 ? stripped.slice(0, 6000) : null;
	} catch {
		return null;
	}
}

// ── Prompts ───────────────────────────────────────────────────────────────────

const SEARCH_SYSTEM = `You are a real estate data extraction specialist for Indian RERA-registered properties.

TASK: Search the web and extract structured data for the EXACT project given.

STEP 1 — Search the official state RERA portal (URL will be provided in the user message):
- The RERA portal page lists: project address, district, PIN code, project type, and registration status
- READ THE PAGE CONTENT carefully — the data is in the page tables

STEP 2 — Also search property portals for supporting info:
- Search "[PROJECT_NAME] [BUILDER] [DISTRICT] RERA" on 99acres, magicbricks, housing.com
- These often list area/locality, PIN code, and construction status

EXTRACTION RULES:
- Extract district, area/locality, and PIN code directly from what you read on the page
- Project type mapping: "Residential Group Housing" → "Residential", "Plotted Development" → "Plot", etc.
- Construction status: map portal status to one of: Under Construction | Ready to Move | Completed | New Launch
- "Sector 137, Noida" → area = "Sector 137", district = "Gautam Buddha Nagar"
- PIN codes are always 6 digits, found near addresses on official pages

STRICT ANTI-HALLUCINATION RULES:
- ONLY return data you actually read from page content. Return null for anything not confirmed.
- Multiple projects can share the same name — the RERA registration number identifies the EXACT one.
- Never guess or infer a PIN code. Only include it if you explicitly saw it on a page.
- confidence: "high" if data from official RERA portal, "medium" if from property sites, "low" if uncertain

Return ONLY this JSON — no markdown, no prose, no explanation before or after:
{
  "area": "locality/sector name or null",
  "pinCode": "6-digit PIN code or null",
  "district": "district name or null",
  "projectType": "Residential|Commercial|Mixed|Plot|Villa|Township or null",
  "constructionStatus": "Under Construction|Ready to Move|Completed|New Launch or null",
  "location": "full address string or null",
  "confidence": "high|medium|low",
  "sources": ["url1", "url2"]
}`;

const FALLBACK_SYSTEM = `You are a real estate data assistant for Indian RERA-registered properties.
You have NO internet access. Infer ONLY what is clearly implied by the provided details.
Never guess PIN codes. Return null for uncertain fields.
Return ONLY valid JSON — no markdown, no explanation:
{
  "area": null,
  "pinCode": null,
  "district": null,
  "projectType": null,
  "constructionStatus": null,
  "location": null,
  "confidence": "low",
  "sources": []
}`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractJson(text) {
	// Greedy match — finds the outermost { ... } block in the response
	const match = text.match(/\{[\s\S]*\}/);
	if (!match) throw new Error('No JSON object found in response');
	return JSON.parse(match[0]);
}

/** Count how many of the key fields are non-null in an enriched object */
function countFields(obj) {
	if (!obj) return 0;
	return ['area', 'pinCode', 'district', 'projectType', 'constructionStatus', 'location']
		.filter((k) => obj[k] != null && obj[k] !== '').length;
}

function buildUserMessage({ projectName, companyName, reraRegNo, stateCode, district, address, existingArea, existingPinCode, reraPageText }) {
	const stateName = stateLabel(stateCode);

	const searchLines = [];
	if (reraRegNo) {
		// Property portals index RERA numbers and have static, searchable pages
		searchLines.push(`Search these queries to find the project details:`);
		searchLines.push(`  1. "${reraRegNo}" site:99acres.com`);
		searchLines.push(`  2. "${reraRegNo}" site:magicbricks.com`);
		searchLines.push(`  3. "${reraRegNo}" site:housing.com`);
		searchLines.push(`  4. "${reraRegNo} ${stateName} RERA project address"`);
		searchLines.push(`Note: The official RERA portal pages are JavaScript-rendered and may be empty — property portals are more reliable for search.`);
	} else {
		searchLines.push(`Search: "${projectName} ${companyName} ${stateName} RERA project area pincode"`);
	}

	const lines = [
		'Find verified RERA details for this specific project by searching the web:',
		'',
		`RERA Registration No : ${reraRegNo || 'Not provided'}`,
		`Project Name         : ${projectName}`,
		`Builder / Promoter   : ${companyName || 'Not provided'}`,
		`State                : ${stateName}`,
		district        ? `Known District       : ${district}` : null,
		address         ? `Builder Address      : ${address}` : null,
		existingArea    ? `Currently known Area : ${existingArea} (verify or correct)` : null,
		existingPinCode ? `Currently known PIN  : ${existingPinCode} (verify or correct)` : null,
	];

	// If we fetched the RERA page directly, inject the raw text
	if (reraPageText) {
		lines.push('');
		lines.push('--- RERA PORTAL PAGE CONTENT (fetched directly) ---');
		lines.push(reraPageText);
		lines.push('--- END OF RERA PAGE ---');
		lines.push('Extract area, district, PIN code, project type, and status from the above page content.');
	} else {
		lines.push('');
		lines.push(...searchLines);
		lines.push('');
		lines.push('Extract: area/locality, PIN code, district, project type, construction status, and full address from search results.');
	}

	return lines.filter((l) => l !== null).join('\n');
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST({ request }) {
	console.log('\n[enrich-project] ▶ POST received');

	const apiKey = env.OPENAI_API_KEY;
	if (!apiKey) {
		console.error('[enrich-project] ✗ OPENAI_API_KEY not configured');
		return json({ success: false, error: 'OPENAI_API_KEY not configured.' }, { status: 500 });
	}

	let body;
	try { body = await request.json(); }
	catch { return json({ success: false, error: 'Invalid JSON body.' }, { status: 400 }); }

	const {
		projectName,
		companyName     = '',
		reraRegNo       = '',
		state           = 'UP',   // raw state code from DB/JSON (e.g. 'UP', 'DL', 'MH')
		district        = '',
		address         = '',
		existingArea    = '',
		existingPinCode = '',
		saveToDb        = false
	} = body;

	// stateCode = the raw code used in DB; stateName = human-readable for search prompts
	const stateCode = state;

	if (!projectName) return json({ success: false, error: 'projectName is required.' }, { status: 400 });

	console.log('[enrich-project] Project:', projectName, '| RERA:', reraRegNo, '| Company:', companyName, '| State:', stateCode);

	let enriched = null;
	let usedSearch = false;
	let usedDirectFetch = false;

	// ── Step 1: Direct fetch of RERA portal page (bypasses JS-rendering problem) ─
	// The RERA portals often have server-side rendered HTML even if the browser
	// view is enhanced with JS. We strip the HTML and pass raw text to AI.
	const portalUrl = reraPortalUrl(stateCode, reraRegNo);
	let reraPageText = null;

	if (portalUrl && reraRegNo) {
		console.log('[enrich-project] Fetching RERA page directly:', portalUrl);
		reraPageText = await fetchReraPageText(portalUrl);
		if (reraPageText) {
			console.log('[enrich-project] RERA page fetched, length:', reraPageText.length, '— using direct-parse path');
			usedDirectFetch = true;
		} else {
			console.log('[enrich-project] RERA page empty or JS-only — will use web search');
		}
	}

	const userMessage = buildUserMessage({ projectName, companyName, reraRegNo, stateCode, district, address, existingArea, existingPinCode, reraPageText });

	// ── Step 2: AI extraction (with or without direct page text) ─────────────
	// If we have the raw RERA page text, use a plain (non-search) model to extract
	// structured data from it — cheaper and more accurate than search.
	// If we don't, use search models to find it on property portals.

	if (reraPageText) {
		// Direct-parse path: page content is in the message, no web search needed
		const extractModel = env.OPENAI_MODEL || 'gpt-4o-mini';
		console.log('[enrich-project] Extracting from direct page text using', extractModel);
		try {
			const res = await fetch('https://api.openai.com/v1/chat/completions', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
				body: JSON.stringify({
					model: extractModel,
					messages: [
						{ role: 'system', content: SEARCH_SYSTEM },
						{ role: 'user',   content: userMessage }
					],
					response_format: { type: 'json_object' },
					max_tokens: 600,
					temperature: 0
				})
			});
			console.log('[enrich-project] Direct-parse model status:', res.status);
			if (res.ok) {
				const data = await res.json();
				const content = data.choices?.[0]?.message?.content ?? '{}';
				console.log('[enrich-project] Direct-parse response:', content.slice(0, 300));
				enriched = JSON.parse(content);
				enriched.sources    = enriched.sources ?? [portalUrl];
				enriched.confidence = enriched.confidence ?? 'high';
				usedSearch = false; // direct fetch, not web search
			} else {
				const err = await res.text();
				console.warn('[enrich-project] Direct-parse failed:', err.slice(0, 200));
			}
		} catch (err) {
			console.warn('[enrich-project] Direct-parse threw:', err.message);
		}
	}

	// ── Step 3: Web search via gpt-4o-mini-search-preview ────────────────────
	// Used when direct page fetch failed or returned empty (JS-rendered portal).
	// Searches property portals (99acres, magicbricks) which ARE indexed.
	if (!enriched || (enriched && countFields(enriched) === 0)) {
		const SEARCH_MODELS = ['gpt-4o-mini-search-preview', 'gpt-4o-search-preview'];
		// Re-build message without the (empty) page text so it uses the search queries
		const searchMessage = buildUserMessage({ projectName, companyName, reraRegNo, stateCode, district, address, existingArea, existingPinCode, reraPageText: null });

		for (const model of SEARCH_MODELS) {
			console.log('[enrich-project] Trying search model:', model);
			try {
				const res = await fetch('https://api.openai.com/v1/chat/completions', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
					body: JSON.stringify({
						model,
						web_search_options: { search_context_size: 'high' },
						messages: [
							{ role: 'system', content: SEARCH_SYSTEM },
							{ role: 'user',   content: searchMessage }
						],
						max_tokens: 800
					})
				});

				console.log('[enrich-project]', model, 'status:', res.status);

				if (!res.ok) {
					const err = await res.text();
					console.warn('[enrich-project]', model, 'failed:', err.slice(0, 200));
					continue;
				}

				const data = await res.json();
				const content = data.choices?.[0]?.message?.content ?? '';
				console.log('[enrich-project] Search response:', content.slice(0, 400));

				if (content.trim()) {
					const candidate = extractJson(content);
					// Only use search result if it found MORE fields than direct parse
					if (!enriched || countFields(candidate) >= countFields(enriched)) {
						enriched = candidate;
						enriched.sources = enriched.sources ?? [];
						const annotations = data.choices?.[0]?.message?.annotations ?? [];
						for (const ann of annotations) {
							if (ann.type === 'url_citation' && ann.url_citation?.url) {
								enriched.sources.push(ann.url_citation.url);
							}
						}
						enriched.sources = [...new Set(enriched.sources)];
					}
					usedSearch = true;
					console.log('[enrich-project] ✓ Web search via', model, '| confidence:', enriched.confidence, '| fields:', countFields(enriched));
					break;
				}
			} catch (err) {
				console.warn('[enrich-project]', model, 'threw:', err.message);
			}
		}
	}

	// ── Step 4: Fallback — plain inference, no web ─────────────────────────────
	if (!enriched) {
		const fallbackModel = env.OPENAI_MODEL || 'gpt-4o-mini';
		console.log('[enrich-project] All methods failed — fallback to', fallbackModel);
		const fallbackMessage = buildUserMessage({ projectName, companyName, reraRegNo, stateCode, district, address, existingArea, existingPinCode, reraPageText: null });
		try {
			const res = await fetch('https://api.openai.com/v1/chat/completions', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
				body: JSON.stringify({
					model: fallbackModel,
					messages: [
						{ role: 'system', content: FALLBACK_SYSTEM },
						{ role: 'user',   content: fallbackMessage }
					],
					response_format: { type: 'json_object' },
					max_tokens: 400,
					temperature: 0.1
				})
			});

			console.log('[enrich-project] Fallback status:', res.status);

			if (!res.ok) {
				const err = await res.text();
				console.error('[enrich-project] Fallback failed:', err.slice(0, 300));
				return json({ success: false, error: `OpenAI error: ${err}` }, { status: 502 });
			}

			const data = await res.json();
			const content = data.choices?.[0]?.message?.content ?? '{}';
			console.log('[enrich-project] Fallback response:', content.slice(0, 300));
			enriched = JSON.parse(content);
			enriched.sources    = enriched.sources    ?? [];
			enriched.confidence = enriched.confidence ?? 'low';
		} catch (err) {
			console.error('[enrich-project] Fallback threw:', err.message);
			return json({ success: false, error: err.message }, { status: 500 });
		}
	}

	if (!Array.isArray(enriched.sources)) enriched.sources = [];

	// ── Data integrity: sanitise AI output before returning / persisting ──────

	// 1. PIN code must be exactly 6 digits — reject anything else
	if (enriched.pinCode && !/^\d{6}$/.test(String(enriched.pinCode).trim())) {
		console.warn('[enrich-project] Invalid pinCode rejected:', enriched.pinCode);
		enriched.pinCode = null;
	}

	// 2. If no real data source was used (no direct fetch AND no web search),
	//    nullify all fields to prevent pure inference hallucinations
	if (!usedDirectFetch && !usedSearch) {
		console.warn('[enrich-project] No data source used — nullifying fields to prevent hallucination');
		enriched.area               = null;
		enriched.pinCode            = null;
		enriched.projectType        = null;
		enriched.constructionStatus = null;
		enriched.location           = null;
		if (!district) enriched.district = null;
		enriched.confidence = 'low';
	}

	// 3. Low confidence + no sources = pure guess — clear location-specific fields
	if (enriched.confidence === 'low' && (enriched.sources ?? []).length === 0) {
		enriched.area     = null;
		enriched.pinCode  = null;
		enriched.location = null;
	}

	// 4. Downgrade confidence if no fields were actually filled
	//    Prevents "confidence: high" + zero data (the JS-rendered page problem)
	const fieldsFound = countFields(enriched);
	if (fieldsFound === 0 && enriched.confidence !== 'low') {
		console.warn('[enrich-project] Search ran but found 0 fields — downgrading confidence from', enriched.confidence, 'to low');
		enriched.confidence = 'low';
	}

	// ── Step 4: Persist to MongoDB (upsert so JSON-only projects are created) ──
	let dbSaved = false;
	let dbError = null;

	if (saveToDb && fieldsFound === 0) {
		console.log('[enrich-project] Skipping DB save — no fields enriched (fieldsFound=0)');
	}

	if (saveToDb && fieldsFound > 0) {
		console.log('[enrich-project] Saving to DB — stateCode:', stateCode, '| RERA:', reraRegNo || '(none)', '| fields:', fieldsFound);
		try {
			const baseData = {
				...(enriched.area               && { area:               enriched.area }),
				...(enriched.pinCode            && { pinCode:            enriched.pinCode }),
				...(enriched.district           && { district:           enriched.district }),
				...(enriched.projectType        && { projectType:        enriched.projectType }),
				...(enriched.constructionStatus && { constructionStatus: enriched.constructionStatus }),
				...(enriched.location           && { location:           enriched.location }),
				scrapedAt: new Date()
			};

			if (reraRegNo) {
				// Try update first; if no rows matched, create the record
				const updated = await prisma.project.updateMany({
					where: { state: stateCode, reraRegNo },
					data: baseData
				});
				console.log('[enrich-project] updateMany count:', updated.count, '(state:', stateCode, ')');

				if (updated.count === 0) {
					// Project not in DB yet — create it
					await prisma.project.create({
						data: {
							state:    stateCode,
							reraRegNo,
							name:     projectName,
							...baseData,
							rawData:  { projectName, companyName, reraRegNo, aiEnriched: true }
						}
					});
					console.log('[enrich-project] Created new DB record');
				}
				dbSaved = true;
			} else {
				console.log('[enrich-project] No RERA number — skipping DB save');
			}
		} catch (dbErr) {
			console.error('[enrich-project] DB error:', dbErr.message);
			dbError = dbErr.message;
		}
	}

	console.log('[enrich-project] ✓ Done — usedSearch:', usedSearch, '| dbSaved:', dbSaved, '| confidence:', enriched.confidence, '| fieldsFound:', fieldsFound);
	return json({ success: true, data: enriched, usedSearch, dbSaved, fieldsFound, ...(dbError && { dbError }) });
}
