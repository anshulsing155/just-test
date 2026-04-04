import { readFileSync } from 'node:fs';
import path from 'node:path';

export function load() {
	const filePath = path.join(
		process.cwd(),
		'companies_filtered_UP_final_2026-04-04T11-49-33-842Z.json'
	);
	const companies = JSON.parse(readFileSync(filePath, 'utf8'));
	return { companies };
}
