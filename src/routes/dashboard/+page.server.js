import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export function load() {
	const filePath = path.join(
		process.cwd(),
		'companies_with_projects_2026-04-06T06-27-43-033Z.json'
	);
	const companies = JSON.parse(readFileSync(filePath, 'utf8'));

	// Load saved zones library (state → district → { zones, ... })
	const zonesPath = path.join(process.cwd(), 'zones_generated.json');
	const zonesLibrary = existsSync(zonesPath)
		? JSON.parse(readFileSync(zonesPath, 'utf8'))
		: {};

	return { companies, zonesLibrary };
}
