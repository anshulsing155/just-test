import { writeFileSync } from 'node:fs';
import path from 'node:path';

export async function POST({ request }) {
	const body = await request.json();
	if (!body || !Array.isArray(body.companies)) {
		return new Response('Invalid payload', { status: 400 });
	}

	const filePath = path.join(
		process.cwd(),
		'companies_with_projects_2026-04-06T06-27-43-033Z.json'
	);

	writeFileSync(filePath, JSON.stringify(body.companies, null, 2), 'utf8');
	return new Response(JSON.stringify({ success: true }), { status: 200 });
}
