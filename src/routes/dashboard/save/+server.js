import { writeFileSync } from 'node:fs';
import path from 'node:path';

export async function POST({ request }) {
	const body = await request.json();
	if (!body || !Array.isArray(body.companies)) {
		return new Response('Invalid payload', { status: 400 });
	}

	// Strip UI-only metadata (_aiMeta) before persisting to file
	const cleaned = body.companies.map((c) => ({
		...c,
		projects: (c.projects ?? []).map(({ _aiMeta, ...p }) => p)
	}));

	const filePath = path.join(
		process.cwd(),
		'companies_with_projects_2026-04-06T06-27-43-033Z.json'
	);

	console.log('[save] Writing', cleaned.length, 'companies to', filePath);
	writeFileSync(filePath, JSON.stringify(cleaned, null, 2), 'utf8');
	console.log('[save] ✓ File saved');
	return new Response(JSON.stringify({ success: true }), { status: 200 });
}
