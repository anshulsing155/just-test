import { json } from '@sveltejs/kit';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// ── Storage ───────────────────────────────────────────────────────────────────
// All generated zones live in a single JSON file at the project root,
// keyed by state name → district name → { zones[], summary, savedAt, ... }
//
// Why a single file: matches the existing companies_with_projects_*.json pattern
// in the dashboard, simple to read in +page.server.js, easy to back up to git.

const FILE = path.join(process.cwd(), 'zones_generated.json');

function loadAll() {
	if (!existsSync(FILE)) return {};
	try {
		return JSON.parse(readFileSync(FILE, 'utf8'));
	} catch (err) {
		console.error('[api/zones] failed to read', FILE, err.message);
		return {};
	}
}

function saveAll(data) {
	writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ── GET ───────────────────────────────────────────────────────────────────────
// /api/zones                       → entire library
// /api/zones?state=Uttar+Pradesh   → all districts in that state
// /api/zones?state=...&district=...→ single district entry
export async function GET({ url }) {
	const all = loadAll();
	const state = url.searchParams.get('state');
	const district = url.searchParams.get('district');

	if (state && district) {
		const entry = all[state]?.[district] ?? null;
		return json({ success: true, data: entry });
	}
	if (state) {
		return json({ success: true, data: all[state] ?? {} });
	}
	return json({ success: true, data: all });
}

// ── POST ──────────────────────────────────────────────────────────────────────
// Body: { state, district, payload: { city, summary, zones[], total_areas, total_pincodes } }
// Upserts the entry (overwrites any existing zones for that state+district).
export async function POST({ request }) {
	let body;
	try {
		body = await request.json();
	} catch {
		return json({ success: false, error: 'Invalid JSON body.' }, { status: 400 });
	}

	const { state, district, payload } = body;
	if (!state || !district || !payload || !Array.isArray(payload.zones)) {
		return json(
			{ success: false, error: 'state, district, and payload.zones are required.' },
			{ status: 400 }
		);
	}

	const all = loadAll();
	if (!all[state]) all[state] = {};

	all[state][district] = {
		city:           payload.city ?? district,
		state,
		district,
		summary:        payload.summary ?? '',
		total_areas:    payload.total_areas ?? 0,
		total_pincodes: payload.total_pincodes ?? 0,
		zones:          payload.zones,
		savedAt:        new Date().toISOString()
	};

	try {
		saveAll(all);
		console.log('[api/zones] saved', state, '›', district, '·', payload.zones.length, 'zones');
		return json({ success: true, savedAt: all[state][district].savedAt, zoneCount: payload.zones.length });
	} catch (err) {
		console.error('[api/zones] write failed:', err.message);
		return json({ success: false, error: err.message }, { status: 500 });
	}
}

// ── DELETE ────────────────────────────────────────────────────────────────────
// /api/zones?state=...&district=...
export async function DELETE({ url }) {
	const state = url.searchParams.get('state');
	const district = url.searchParams.get('district');
	if (!state || !district) {
		return json({ success: false, error: 'state and district required' }, { status: 400 });
	}
	const all = loadAll();
	if (all[state]?.[district]) {
		delete all[state][district];
		if (Object.keys(all[state]).length === 0) delete all[state];
		saveAll(all);
	}
	return json({ success: true });
}
