/**
 * Maps projects (via rawData.promoterName) to companies (via name).
 * - Matched projects are saved into each company's `projects` array.
 * - Unmatched projects are written to a separate JSON file.
 *
 * Usage:  node scripts/map-projects-to-companies.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROOT = path.join(__dirname, '..');

const COMPANIES_FILE = path.join(
	ROOT,
	'companies_filtered_UP_final_2026-04-04T11-49-33-842Z.json'
);
const PROJECTS_FILE = path.join(
	ROOT,
	'projects_UP_only_2026-04-04T12-00-45-596Z.json'
);

const companies = JSON.parse(fs.readFileSync(COMPANIES_FILE, 'utf8'));
const projects = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8'));
// Build a lookup: UPPERCASED company name → index in companies array
const nameIndex = new Map();
companies.forEach((c, i) => {
	const key = (c.name ?? '').trim().toUpperCase();
	if (key) nameIndex.set(key, i);
});

// Initialise projects array on each company
companies.forEach((c) => {
	if (!Array.isArray(c.projects)) c.projects = [];
});

const unmatched = [];
let matchedCount = 0;

projects.forEach((project) => {
	const promoterName = (project.rawData?.promoterName ?? '').trim();
	const key = promoterName.toUpperCase();

	if (nameIndex.has(key)) {
		const idx = nameIndex.get(key);
		companies[idx].projects.push({
			_id: project._id,
			reraRegNo: project.reraRegNo,
			name: project.name,
			district: project.district,
			projectType: project.projectType,
			constructionStatus: project.constructionStatus,
			validUntil: project.validUntil,
			certificateUrl: project.certificateUrl,
			scrapedAt: project.scrapedAt
		});
		matchedCount++;
	} else {
		unmatched.push({
			...project,
			_unmatchedPromoterName: promoterName
		});
	}
});

// ── Write updated companies file ──────────────────────────────────────────────
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

const companiesOutPath = path.join(
	ROOT,
	`companies_with_projects_${timestamp}.json`
);
fs.writeFileSync(companiesOutPath, JSON.stringify(companies, null, 2), 'utf8');

// ── Write unmatched projects file ─────────────────────────────────────────────
const unmatchedOutPath = path.join(
	ROOT,
	`projects_unmatched_${timestamp}.json`
);
fs.writeFileSync(unmatchedOutPath, JSON.stringify(unmatched, null, 2), 'utf8');

console.log('─'.repeat(55));
console.log(`Total projects   : ${projects.length}`);
console.log(`Matched          : ${matchedCount}`);
console.log(`Unmatched        : ${unmatched.length}`);
console.log(`Companies file   : ${path.basename(companiesOutPath)}`);
console.log(`Unmatched file   : ${path.basename(unmatchedOutPath)}`);
console.log('─'.repeat(55));
