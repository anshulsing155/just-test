<script>
	import pincodeData from '$lib/data/pincode_IN_all.json';
	import companyData from "$lib/data/companies_with_projects_2026-04-06T06-27-43-033Z.json"
		import projectsData from "$lib/data/projects_UP_only_2026-04-04T12-00-45-596Z.json"
	// import bankNames from '$lib/data/tempBankNames.json';


	const UP_DISTRICTS = Object.keys(pincodeData['Uttar Pradesh']).sort();

	export let data;

	let result = projectsData.length
	

	$:console.log(result,"result")

	// ── state ──────────────────────────────────────────────────────────────────
	let companies = data.companies.map((c) => ({ ...c }));
	let zonesLibrary = data.zonesLibrary ?? {}; // { stateName → { districtName → { zones[] } } }
	let searchTerm = '';
	let currentPage = 1;
	const PER_PAGE = 25;

	// ── Zone filter state ──────────────────────────────────────────────────────
	// Cascade: state → district → zone → projects
	// Maps short state codes from company data ('UP') to full names used by zones library
	const STATE_CODE_TO_NAME = {
		UP: 'Uttar Pradesh', DL: 'Delhi', MH: 'Maharashtra', PB: 'Punjab',
		TS: 'Telangana', MP: 'Madhya Pradesh', RJ: 'Rajasthan', HR: 'Haryana',
		GJ: 'Gujarat', KA: 'Karnataka', TN: 'Tamil Nadu', WB: 'West Bengal'
	};
	const stateCodeToName = (code) => STATE_CODE_TO_NAME[code] ?? code;

	let filterState = '';     // full state name, e.g. 'Uttar Pradesh'
	let filterDistrict = '';
	let filterZone = '';      // zone.name

	// All distinct states present in the company data, as full names
	$: filterStateOptions = [...new Set(companies.map((c) => stateCodeToName(c.state)).filter(Boolean))].sort();

	// Districts available for the chosen state — union of (a) districts found in
	// company project data and (b) districts in the zones library — so the user
	// can pick any district that has either projects or zones (or both).
	$: filterDistrictOptions = (() => {
		if (!filterState) return [];
		const fromData = new Set();
		for (const c of companies) {
			if (stateCodeToName(c.state) !== filterState) continue;
			for (const p of c.projects ?? []) {
				if (p.district) fromData.add(p.district);
			}
		}
		const fromZones = new Set(Object.keys(zonesLibrary[filterState] ?? {}));
		return [...new Set([...fromData, ...fromZones])].sort();
	})();

	// Zones available for the chosen state + district
	$: filterZoneOptions = (() => {
		if (!filterState || !filterDistrict) return [];
		return zonesLibrary[filterState]?.[filterDistrict]?.zones ?? [];
	})();

	// The selected zone object (or null)
	$: selectedZone = filterZoneOptions.find((z) => z.name === filterZone) ?? null;

	// Reset cascading dropdowns when parent changes
	$: if (filterState !== undefined) { /* placeholder for reactivity */ }
	function onStateChange() { filterDistrict = ''; filterZone = ''; currentPage = 1; }
	function onDistrictChange() { filterZone = ''; currentPage = 1; }
	function onZoneChange() { currentPage = 1; }
	function clearZoneFilters() { filterState = ''; filterDistrict = ''; filterZone = ''; currentPage = 1; }

	/** Does this project belong to the selected zone? */
	function projectMatchesZone(project, zone) {
		if (!zone) return true;
		const areaSet = new Set((zone.areas ?? []).map((a) => a.toLowerCase().trim()));
		const pinSet = new Set((zone.pincodes ?? []).map((p) => String(p).trim()));
		const a = (project.area ?? '').toLowerCase().trim();
		const p = String(project.pinCode ?? '').trim();
		return (a && areaSet.has(a)) || (p && pinSet.has(p));
	}

	// modal state
	let editOpen = false;
	let deleteOpen = false;
	let editor = {};
	let deleteTarget = null;
	let deleteStep = 0;

	// save state
	let saving = false;
	let saveMsg = '';

	// projects modal state
	let projectsOpen = false;
	let projectsTarget = null;
	let addProjectOpen = false;
	let newProject = { reraRegNo: '', name: '', district: '', area: '', pinCode: '', projectType: '', constructionStatus: '' };

	// project inline-edit state
	let editingProjectIdx = null;
	let editingProject = {};
	let removeConfirmIdx = null;
	let lenderBankSelection = '';

	// AI enrichment state
	let enrichingIdx = null;      // index of the project currently being enriched
	let enrichingAll = false;     // bulk enrichment in progress
	let enrichProgress = { done: 0, total: 0 };
	let enrichMsg = '';
	let unsavedEnrichCount = 0;   // how many projects enriched but not yet saved to file

	/** CSS class for AI confidence badge */
	function confidenceClass(level) {
		if (level === 'high')   return 'bg-green-50 text-green-700';
		if (level === 'medium') return 'bg-yellow-50 text-yellow-700';
		return 'bg-slate-100 text-slate-500';
	}

	/** Safely get hostname from a URL string */
	function hostname(url) {
		try { return new URL(url).hostname; } catch { return url; }
	}

	/** Enrich a single project with GPT (+ web search) and merge results */
	async function enrichProject(companyId, projectIdx) {
		const company = companies.find((c) => c._id === companyId);
		if (!company) return;
		const project = company.projects?.[projectIdx];
		if (!project) return;

		enrichingIdx = projectIdx;
		enrichMsg = '';
		console.log('[enrich] Starting enrichment for project:', project.name, '| RERA:', project.reraRegNo, '| company:', company.name);
		try {
			const res = await fetch('/api/enrich-project', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					// Core identifiers — used for search and DB lookup
					projectName:     project.name,
					companyName:     company.name,
					reraRegNo:       project.reraRegNo  || '',
					state:           company.state      || project.state || 'UP',
					// Extra context — prevents confusing same-name projects in different locations
					district:        project.district   || company.district || '',
					address:         company.address    || '',
					existingArea:    project.area       || '',
					existingPinCode: project.pinCode    || '',
					saveToDb:        true
				})
			});
			console.log('[enrich] HTTP status:', res.status, res.ok);
			const rawText = await res.text();
			console.log('[enrich] Raw response text:', rawText);
			let result;
			try {
				result = JSON.parse(rawText);
			} catch (parseErr) {
				console.error('[enrich] Failed to parse JSON:', parseErr.message);
				enrichMsg = `✗ Server returned non-JSON (status ${res.status}): ${rawText.slice(0, 100)}`;
				return;
			}
			console.log('[enrich] Parsed result:', result);
			if (result.success) {
				const enriched = result.data;
				const confidence = enriched.confidence ?? 'low';
				const fieldsFound = result.fieldsFound ?? 0;

				/**
				 * Confidence-gated merge — prevents hallucinations from corrupting data:
				 *  high   → apply all non-null enriched fields (RERA portal is authoritative)
				 *  medium → apply only if the existing project field is empty / null
				 *  low    → apply nothing (server already nullified speculative fields,
				 *            but we also skip on the client as an extra safety layer)
				 */
				function mergeField(enrichedVal, existingVal) {
					if (!enrichedVal) return existingVal;            // AI returned null → keep existing
					if (confidence === 'low') return existingVal;   // low confidence → never overwrite
					if (confidence === 'medium') return existingVal || enrichedVal; // only fill blanks
					return enrichedVal;                              // high → authoritative
				}

				companies = companies.map((c) =>
					c._id !== companyId ? c : {
						...c,
						projects: c.projects.map((p, i) =>
							i !== projectIdx ? p : {
								...p,
								area:               mergeField(enriched.area,               p.area),
								pinCode:            mergeField(enriched.pinCode,            p.pinCode),
								district:           mergeField(enriched.district,           p.district),
								projectType:        mergeField(enriched.projectType,        p.projectType),
								constructionStatus: mergeField(enriched.constructionStatus, p.constructionStatus),
								location:           mergeField(enriched.location,           p.location),
								_aiMeta: {
									confidence,
									sources:    enriched.sources ?? [],
									usedSearch: result.usedSearch,
									fieldsFound,
									enrichedAt: new Date().toISOString()
								}
							}
						)
					}
				);
				if (projectsTarget?._id === companyId) {
					projectsTarget = companies.find((c) => c._id === companyId);
				}

				if (fieldsFound > 0 && confidence !== 'low') {
					unsavedEnrichCount++;
				}

				const sourceCount = enriched.sources?.length ?? 0;
				const searchNote = result.usedSearch ? ` · ${sourceCount} source${sourceCount !== 1 ? 's' : ''}` : ' · no web search';
				const fieldsNote = fieldsFound > 0 ? ` · ${fieldsFound} field${fieldsFound !== 1 ? 's' : ''} filled` : ' · no new data';
				enrichMsg = `✓ "${project.name}" · confidence: ${confidence}${searchNote}${fieldsNote}`;
				if (fieldsFound > 0 && confidence !== 'low') {
					saveMsg = `${unsavedEnrichCount} enrichment${unsavedEnrichCount !== 1 ? 's' : ''} pending save — click "Save to file".`;
				}
			} else {
				enrichMsg = `✗ Failed: ${result.error}`;
			}
		} catch (err) {
			console.error('[enrich] Fetch error:', err);
			enrichMsg = `✗ Error: ${err.message}`;
		} finally {
			enrichingIdx = null;
		}
	}

	/** Enrich all projects for the current modal company */
	async function enrichAllProjects() {
		if (!projectsTarget) return;
		const projects = projectsTarget.projects ?? [];
		if (!projects.length) return;
		enrichingAll = true;
		enrichMsg = '';
		enrichProgress = { done: 0, total: projects.length };

		for (let i = 0; i < projects.length; i++) {
			await enrichProject(projectsTarget._id, i);
			enrichProgress = { done: i + 1, total: projects.length };
			// small delay to avoid rate-limiting
			if (i < projects.length - 1) await new Promise(r => setTimeout(r, 800));
		}

		enrichingAll = false;
		enrichMsg = `✓ All ${projects.length} project(s) processed. Auto-saving…`;

		// Auto-save after bulk enrichment so no data is lost on page refresh
		if (unsavedEnrichCount > 0) {
			await saveToFile();
			enrichMsg = `✓ All ${projects.length} project(s) enriched and saved to file.`;
		} else {
			enrichMsg = `✓ All ${projects.length} project(s) processed — no new data found.`;
		}
	}

	function normalizeLenderNames(value) {
		if (Array.isArray(value)) return value;
		if (typeof value === 'string' && value.trim()) return [value.trim()];
		return [];
	}

	// function getAvailableBanks(selectedBanks = []) {
	// 	const selected = new Set(normalizeLenderNames(selectedBanks));
	// 	return bankNames.filter((bank) => !selected.has(bank));
	// }

	function openProjectEdit(idx, project) {
		editingProjectIdx = idx;
		editingProject = { ...project, lenderName: normalizeLenderNames(project.lenderName) };
		lenderBankSelection = '';
		addProjectOpen = false;
	}

	function addLenderBank(bank) {
		if (!bank) return;
		const selectedBanks = normalizeLenderNames(editingProject.lenderName);
		if (selectedBanks.includes(bank)) return;

		editingProject = {
			...editingProject,
			lenderName: [...selectedBanks, bank]
		};
		lenderBankSelection = '';
	}

	function removeLenderBank(bank) {
		editingProject = {
			...editingProject,
			lenderName: normalizeLenderNames(editingProject.lenderName).filter((item) => item !== bank)
		};
	}

	function saveProjectEdit() {
		companies = companies.map((c) =>
			c._id === projectsTarget._id
				? { ...c, projects: c.projects.map((p, i) => (i === editingProjectIdx ? { ...editingProject } : p)) }
				: c
		);
		projectsTarget = companies.find((c) => c._id === projectsTarget._id);
		editingProjectIdx = null;
		editingProject = {};
		lenderBankSelection = '';
		saveMsg = 'Project updated locally. Click "Save to file" to persist.';
	}

	function openProjects(company) {
		projectsTarget = company;
		projectsOpen = true;
		addProjectOpen = false;
		editingProjectIdx = null;
		editingProject = {};
		removeConfirmIdx = null;
		newProject = { reraRegNo: '', name: '', district: '', area: '', pinCode: '', projectType: '', constructionStatus: '' };
	}

	function addProject() {
		if (!newProject.name.trim()) return;
		companies = companies.map((c) =>
			c._id === projectsTarget._id
				? { ...c, projects: [...(c.projects ?? []), { ...newProject, _id: Date.now().toString() }] }
				: c
		);
		projectsTarget = companies.find((c) => c._id === projectsTarget._id);
		newProject = { reraRegNo: '', name: '', district: '', area: '', pinCode: '', projectType: '', constructionStatus: '' };
		addProjectOpen = false;
		saveMsg = 'Project added locally. Click "Save to file" to persist.';
	}

	// ── derived ────────────────────────────────────────────────────────────────
	$: filtered = companies.filter((c) => {
		// 1. State filter
		if (filterState && stateCodeToName(c.state) !== filterState) return false;

		// 2. District filter — company must have AT LEAST ONE project in that district
		if (filterDistrict) {
			const hasDistrict = (c.projects ?? []).some((p) => p.district === filterDistrict);
			if (!hasDistrict) return false;
		}

		// 3. Zone filter — company must have AT LEAST ONE project matching the zone
		if (selectedZone) {
			const hasZoneMatch = (c.projects ?? []).some((p) =>
				p.district === filterDistrict && projectMatchesZone(p, selectedZone)
			);
			if (!hasZoneMatch) return false;
		}

		// 4. Free-text search
		const q = searchTerm.toLowerCase().trim();
		if (!q) return true;
		return (
			(c.name ?? '').toLowerCase().includes(q) ||
			(c.reraRegNo ?? '').toLowerCase().includes(q) ||
			(c.district ?? '').toLowerCase().includes(q) ||
			(c.area ?? '').toLowerCase().includes(q) ||
			(c.pinCode ?? '').toLowerCase().includes(q) ||
			(c.address ?? '').toLowerCase().includes(q) ||
			(c.legalType ?? '').toLowerCase().includes(q)
		);
	});

	// How many projects within filtered companies actually match the zone (for stat display)
	$: matchedProjectCount = (() => {
		if (!selectedZone) return 0;
		let n = 0;
		for (const c of filtered) {
			for (const p of c.projects ?? []) {
				if (p.district === filterDistrict && projectMatchesZone(p, selectedZone)) n++;
			}
		}
		return n;
	})();

	$: totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
	$: if (currentPage > totalPages) currentPage = totalPages;
	$: startIdx = (currentPage - 1) * PER_PAGE;
	$: page = filtered.slice(startIdx, startIdx + PER_PAGE);

	$: pages = (() => {
		const max = 5;
		let s = Math.max(1, currentPage - 2);
		let e = Math.min(totalPages, s + max - 1);
		if (e - s < max - 1) s = Math.max(1, e - max + 1);
		const arr = [];
		for (let i = s; i <= e; i++) arr.push(i);
		return arr;
	})();

	// ── helpers ────────────────────────────────────────────────────────────────
	function go(n) {
		if (n >= 1 && n <= totalPages) currentPage = n;
	}

	function openEdit(company) {
		editor = JSON.parse(JSON.stringify(company));
		editOpen = true;
	}

	function saveEdit() {
		companies = companies.map((c) => (c._id === editor._id ? { ...editor } : c));
		editOpen = false;
		saveMsg = 'Edited locally. Click "Save to file" to persist.';
	}

	function openDelete(company) {
		deleteTarget = company;
		deleteStep = 1;
		deleteOpen = true;
	}

	function confirmDelete() {
		if (deleteStep === 1) { deleteStep = 2; return; }
		companies = companies.filter((c) => c._id !== deleteTarget._id);
		deleteOpen = false;
		deleteTarget = null;
		saveMsg = 'Deleted locally. Click "Save to file" to persist.';
	}

	function cancelDelete() {
		deleteOpen = false;
		deleteTarget = null;
	}

	function deleteStepClass(step) {
		return step === 1
			? 'bg-orange-500 hover:bg-orange-600'
			: 'bg-red-600 hover:bg-red-700';
	}

	async function saveToFile() {
		saving = true;
		saveMsg = '';
		try {
			const res = await fetch('/dashboard/save', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ companies })
			});
			if (!res.ok) throw new Error(await res.text());
			saveMsg = 'File saved successfully!';
		} catch (err) {
			saveMsg = 'Save failed: ' + err.message;
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head><title>UP Builders Dashboard</title></svelte:head>

<!-- ── PAGE ──────────────────────────────────────────────────────────────────── -->
<div class="min-h-screen bg-slate-50 py-8">
	<div class="mx-auto 	 px-4 sm:px-6 lg:px-8">

		<!-- Header -->
		<div class="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
			<div>
				<h1 class="text-2xl font-bold text-slate-900">UP Builders Dashboard</h1>
				<p class="mt-1 text-sm text-slate-500">{companies.length} total builders · {filtered.length} shown</p>
			</div>
			<div class="flex items-center gap-3">
				{#if saveMsg}
					<span class="text-sm {saveMsg.startsWith('Save failed') ? 'text-red-600' : 'text-emerald-600'}">{saveMsg}</span>
				{/if}
				<button
					type="button"
					on:click={saveToFile}
					disabled={saving}
					class="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
				>
					{saving ? 'Saving…' : 'Save to file'}
				</button>
			</div>
		</div>

		<!-- Cascading Zone Filter: State → District → Zone -->
		<div class="mb-4 rounded-2xl bg-white p-4 shadow-sm">
			<div class="mb-2 flex items-center justify-between">
				<h3 class="text-xs font-semibold uppercase tracking-wider text-slate-500">Filter by Zone</h3>
				{#if filterState || filterDistrict || filterZone}
					<button type="button" on:click={clearZoneFilters}
						class="text-xs font-semibold text-indigo-600 hover:text-indigo-800">
						Clear filters
					</button>
				{/if}
			</div>

			<div class="grid grid-cols-1 gap-3 md:grid-cols-3">
				<!-- State -->
				<div>
					<label for="filter-state" class="mb-1 block text-[11px] font-medium text-slate-500">State</label>
					<select id="filter-state" bind:value={filterState} on:change={onStateChange}
						class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100">
						<option value="">All states</option>
						{#each filterStateOptions as s}
							<option value={s}>{s}</option>
						{/each}
					</select>
				</div>

				<!-- District -->
				<div>
					<label for="filter-district" class="mb-1 block text-[11px] font-medium text-slate-500">District</label>
					<select id="filter-district" bind:value={filterDistrict} on:change={onDistrictChange}
						disabled={!filterState}
						class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50 disabled:text-slate-400">
						<option value="">All districts</option>
						{#each filterDistrictOptions as d}
							<option value={d}>{d}</option>
						{/each}
					</select>
				</div>

				<!-- Zone -->
				<div>
					<label for="filter-zone" class="mb-1 block text-[11px] font-medium text-slate-500">
						Zone
						{#if filterDistrict && filterZoneOptions.length === 0}
							<span class="ml-1 text-amber-600">(none yet — generate via Zone Generator)</span>
						{:else if filterZoneOptions.length}
							<span class="ml-1 text-slate-400">({filterZoneOptions.length} available)</span>
						{/if}
					</label>
					<select id="filter-zone" bind:value={filterZone} on:change={onZoneChange}
						disabled={!filterDistrict || !filterZoneOptions.length}
						class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50 disabled:text-slate-400">
						<option value="">All zones</option>
						{#each filterZoneOptions as z}
							<option value={z.name}>{z.name} ({(z.areas ?? []).length} areas)</option>
						{/each}
					</select>
				</div>
			</div>

			{#if selectedZone}
				<div class="mt-3 rounded-xl bg-indigo-50 p-3 text-xs">
					<div class="flex items-start justify-between gap-3">
						<div class="min-w-0">
							<p class="font-semibold text-indigo-900">{selectedZone.name}</p>
							{#if selectedZone.description}
								<p class="mt-0.5 text-indigo-700">{selectedZone.description}</p>
							{/if}
							<p class="mt-1 text-indigo-600">
								<b>{(selectedZone.areas ?? []).length}</b> areas ·
								<b>{(selectedZone.pincodes ?? []).length}</b> pincodes ·
								<b>{matchedProjectCount}</b> matching project{matchedProjectCount !== 1 ? 's' : ''}
							</p>
						</div>
					</div>
					{#if selectedZone.pincodes?.length}
						<div class="mt-2 flex flex-wrap gap-1">
							{#each selectedZone.pincodes as pin}
								<span class="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] text-indigo-700">{pin}</span>
							{/each}
						</div>
					{/if}
				</div>
			{/if}
		</div>

		<!-- Search -->
		<div class="mb-6">
			<input
				id="search"
				type="text"
				bind:value={searchTerm}
				on:input={() => (currentPage = 1)}
				placeholder="Search by name, RERA number, district, address, or type…"
				class="w-full rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm text-slate-900 shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
			/>
		</div>

		<!-- Stats row -->
		<div class="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
			{#each [
				{ label: 'Total builders', value: companies.length },
				{ label: 'Filtered', value: filtered.length },
				{ label: 'Page', value: currentPage + ' / ' + totalPages },
				{ label: 'Per page', value: PER_PAGE }
			] as stat}
				<div class="rounded-2xl bg-white px-5 py-4 shadow-sm">
					<p class="text-xs text-slate-400">{stat.label}</p>
					<p class="mt-1 text-xl font-bold text-slate-900">{stat.value}</p>
				</div>
			{/each}
		</div>

		<!-- Table -->
		<div class="rounded-2xl bg-white shadow-sm">
			{#if page.length === 0}
				<div class="py-16 text-center text-slate-400">No builders match your search.</div>
			{:else}
				<table class="w-full text-sm">
					<thead class="border-b border-slate-100 bg-slate-50 text-xs font-semibold uppercase tracking-widest text-slate-500">
						<tr>
							<th class="px-4 py-3 text-left">#</th>
							<th class="px-4 py-3 text-left">Builder Name</th>
							<th class="px-4 py-3 text-left">RERA No.</th>
							<th class="px-4 py-3 text-left">Type</th>
							<th class="px-4 py-3 text-left">District</th>
							<th class="px-4 py-3 text-left">Area</th>
							<th class="px-4 py-3 text-left">Pin Code</th>
							<th class="px-4 py-3 text-left">Mobile</th>
							<th class="px-4 py-3 text-left">Email</th>						<th class="px-4 py-3 text-left">Projects</th>							<th class="px-4 py-3 text-left">Actions</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-100">
						{#each page as company, i}
							<tr class="hover:bg-slate-50">
								<td class="px-4 py-3 text-slate-400">{startIdx + i + 1}</td>
								<td class="px-4 py-3 font-medium text-slate-900">
									{company.name}
									{#if company.website}
										<a href={company.website} target="_blank" rel="noopener noreferrer" class="ml-1 text-indigo-500 hover:underline text-xs">↗</a>
									{/if}
								</td>
								<td class="px-4 py-3 font-mono text-slate-600">{company.reraRegNo}</td>
								<td class="px-4 py-3">
									{#if company.legalType}
										<span class="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">{company.legalType}</span>
									{:else}
										<span class="text-slate-300">—</span>
									{/if}
								</td>
								<td class="px-4 py-3 text-slate-600">{company.district ?? '—'}</td>
								<td class="px-4 py-3 text-slate-600">{company.area ?? '—'}</td>
								<td class="px-4 py-3 text-slate-600">{company.pinCode ?? '—'}</td>
								<td class="px-4 py-3 text-slate-600">{company.contact?.mobile ?? '—'}</td>
								<td class="px-4 py-3 text-slate-600 max-w-[180px] truncate">{company.contact?.email ?? '—'}</td>
								<td class="px-4 py-3">								{#if (company.projects ?? []).length > 0}
									<span class="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
										{company.projects.length}
									</span>
								{:else}
									<span class="text-slate-300 text-xs">0</span>
								{/if}
							</td>
							<td class="px-4 py-3">									<div class="flex gap-2">
										<button
											type="button"
											on:click={() => openEdit(company)}
											class="rounded-lg bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
										>Edit</button>
										<button
											type="button"
											on:click={() => openDelete(company)}
											class="rounded-lg bg-red-50 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-100"
										>Delete</button>									<button
										type="button"
										on:click={() => openProjects(company)}
										class="rounded-lg bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
									>Projects</button>									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</div>

		<!-- Pagination -->
		{#if totalPages > 1}
			<div class="mt-5 flex flex-wrap items-center justify-between gap-3">
				<p class="text-sm text-slate-500">
					Showing {startIdx + 1}–{Math.min(startIdx + PER_PAGE, filtered.length)} of {filtered.length}
				</p>
				<div class="flex flex-wrap gap-2">
					<button
						type="button"
						on:click={() => go(currentPage - 1)}
						disabled={currentPage === 1}
						class="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
					>← Prev</button>

					{#each pages as p}
						<button
							type="button"
							on:click={() => go(p)}
							class={p === currentPage
								? 'rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white'
								: 'rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50'}
						>{p}</button>
					{/each}

					<button
						type="button"
						on:click={() => go(currentPage + 1)}
						disabled={currentPage === totalPages}
						class="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
					>Next →</button>
				</div>
			</div>
		{/if}

	</div><!-- /max-w -->
</div><!-- /page -->


<!-- ── EDIT MODAL ─────────────────────────────────────────────────────────────── -->
{#if editOpen}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
		<div class="w-full max-w-2xl overflow-hidden rounded-3xl bg-white shadow-2xl">

			<div class="flex items-center justify-between border-b border-slate-100 px-6 py-4">
				<h2 class="text-lg font-bold text-slate-900">Edit Builder</h2>
				<button type="button" on:click={() => (editOpen = false)} class="text-slate-400 hover:text-slate-700 text-xl font-bold">✕</button>
			</div>

			<div class="max-h-[65vh] overflow-y-auto p-6">
				<div class="grid gap-4 sm:grid-cols-2">

					<div>
						<label for="edit-name" class="block text-xs font-semibold text-slate-500 mb-1">Name</label>
						<input id="edit-name" type="text" bind:value={editor.name}
							class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none" />
					</div>

					<div>
						<label for="edit-rera" class="block text-xs font-semibold text-slate-500 mb-1">RERA Reg No.</label>
						<input id="edit-rera" type="text" bind:value={editor.reraRegNo}
							class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none" />
					</div>

					<div>
						<label for="edit-legal" class="block text-xs font-semibold text-slate-500 mb-1">Legal Type</label>
						<input id="edit-legal" type="text" bind:value={editor.legalType}
							class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none" />
					</div>

					<div>
						<label for="edit-district" class="block text-xs font-semibold text-slate-500 mb-1">District</label>
						<input id="edit-district" type="text" bind:value={editor.district}
							class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none" />
					</div>

					<div>
						<label for="edit-area" class="block text-xs font-semibold text-slate-500 mb-1">Area</label>
						<input id="edit-area" type="text" bind:value={editor.area}
							class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none" />
					</div>

					<div>
						<label for="edit-pincode" class="block text-xs font-semibold text-slate-500 mb-1">Pin Code</label>
						<input id="edit-pincode" type="text" bind:value={editor.pinCode}
							class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none" />
					</div>

					<div class="sm:col-span-2">
						<label for="edit-address" class="block text-xs font-semibold text-slate-500 mb-1">Address</label>
						<textarea id="edit-address" rows="2" bind:value={editor.address}
							class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none resize-none"></textarea>
					</div>

					<div>
						<label for="edit-mobile" class="block text-xs font-semibold text-slate-500 mb-1">Mobile</label>
						<input id="edit-mobile" type="text"
							value={editor.contact?.mobile ?? ''}
							on:input={(e) => (editor = { ...editor, contact: { ...(editor.contact ?? {}), mobile: e.target.value } })}
							class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none" />
					</div>

					<div>
						<label for="edit-email" class="block text-xs font-semibold text-slate-500 mb-1">Email</label>
						<input id="edit-email" type="email"
							value={editor.contact?.email ?? ''}
							on:input={(e) => (editor = { ...editor, contact: { ...(editor.contact ?? {}), email: e.target.value } })}
							class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none" />
					</div>

					<div>
						<label for="edit-pan" class="block text-xs font-semibold text-slate-500 mb-1">PAN</label>
						<input id="edit-pan" type="text" bind:value={editor.pan}
							class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none" />
					</div>

					<div>
						<label for="edit-gstin" class="block text-xs font-semibold text-slate-500 mb-1">GSTIN</label>
						<input id="edit-gstin" type="text" bind:value={editor.gstin}
							class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none" />
					</div>

					<div class="sm:col-span-2">
						<label for="edit-website" class="block text-xs font-semibold text-slate-500 mb-1">Website</label>
						<input id="edit-website" type="text" bind:value={editor.website}
							class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none" />
					</div>

				</div>
			</div>

			<div class="flex justify-end gap-3 border-t border-slate-100 px-6 py-4">
				<button type="button" on:click={() => (editOpen = false)}
					class="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
					Cancel
				</button>
				<button type="button" on:click={saveEdit}
					class="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
					Save changes
				</button>
			</div>

		</div>
	</div>
{/if}


<!-- ── PROJECTS MODAL ───────────────────────────────────────────────────────────── -->
{#if projectsOpen && projectsTarget}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
		<div class="w-full max-w-2xl overflow-hidden rounded-3xl bg-white shadow-2xl">

			<div class="flex items-center justify-between border-b border-slate-100 px-6 py-4">
				<div>
					<h2 class="text-lg font-bold text-slate-900">Projects</h2>
					<p class="mt-0.5 text-xs text-slate-500">{projectsTarget.name}</p>
				</div>
				<div class="flex items-center gap-3">
					<button
						type="button"
						on:click={enrichAllProjects}
						disabled={enrichingAll || enrichingIdx !== null || !(projectsTarget?.projects?.length)}
						class="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed"
						title="Send all project names to GPT and auto-fill area, pin code, district etc."
					>
						{#if enrichingAll}
							<span class="inline-flex items-center gap-1.5">
								<svg class="h-3.5 w-3.5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
									<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
									<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
								</svg>
								{enrichProgress.done}/{enrichProgress.total}
							</span>
						{:else}
							✦ AI Enrich All
						{/if}
					</button>
					<button
						type="button"
						on:click={() => (addProjectOpen = true)}
						class="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
					>+ Add Project</button>
					<button type="button" on:click={() => { projectsOpen = false; addProjectOpen = false; enrichMsg = ''; }} class="text-slate-400 hover:text-slate-700 text-xl font-bold">✕</button>
				</div>
			</div>

			<!-- Add Project Form -->
			{#if addProjectOpen}
				<div class="border-b border-slate-100 bg-emerald-50 px-6 py-5">
					<h3 class="mb-3 text-sm font-bold text-slate-800">New Project</h3>
					<div class="grid gap-3 sm:grid-cols-2">
						<div>
							<label for="new-name" class="block text-xs font-semibold text-slate-500 mb-1">Project Name <span class="text-red-500">*</span></label>
							<input id="new-name" type="text" bind:value={newProject.name}
								placeholder="e.g. Green Valley Heights"
								class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 outline-none" />
						</div>
						<div>
							<label for="new-rera" class="block text-xs font-semibold text-slate-500 mb-1">RERA Reg No.</label>
							<input id="new-rera" type="text" bind:value={newProject.reraRegNo}
								placeholder="e.g. UPRERAPRJ12345"
								class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 outline-none" />
						</div>
						<div>
							<label for="new-district" class="block text-xs font-semibold text-slate-500 mb-1">District</label>
							<select id="new-district" bind:value={newProject.district}
								class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 outline-none bg-white">
								<option value="">Select district…</option>
								{#each UP_DISTRICTS as district}
									<option value={district}>{district}</option>
								{/each}
							</select>
						</div>
						<div>
							<label for="new-area" class="block text-xs font-semibold text-slate-500 mb-1">Area</label>
							<input id="new-area" type="text" bind:value={newProject.area}
								placeholder="e.g. Sector 62, Noida"
								class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 outline-none" />
						</div>
						<div>
							<label for="new-pincode" class="block text-xs font-semibold text-slate-500 mb-1">Pin Code</label>
							<input id="new-pincode" type="text" bind:value={newProject.pinCode}
								placeholder="e.g. 201301"
								class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 outline-none" />
						</div>
						<div>
							<label for="new-type" class="block text-xs font-semibold text-slate-500 mb-1">Project Type</label>
							<select id="new-type" bind:value={newProject.projectType}
								class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 outline-none bg-white">
								<option value="">Select type…</option>
								<option value="Residential">Residential</option>
								<option value="Commercial">Commercial</option>
								<option value="Villa">Villa</option>
								<option value="Plot">Plot</option>
							</select>
						</div>
						<div class="sm:col-span-2">
							<label for="new-status" class="block text-xs font-semibold text-slate-500 mb-1">Construction Status</label>
							<select id="new-status" bind:value={newProject.constructionStatus}
								class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 outline-none bg-white">
								<option value="">Select status…</option>
								<option value="Ready to Move">Ready to Move</option>
								<option value="Under Construction">Under Construction</option>
								<option value="Resale">Resale</option>
							</select>
						</div>
					</div>
					<div class="mt-4 flex justify-end gap-3">
						<button type="button" on:click={() => (addProjectOpen = false)}
							class="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">
							Cancel
						</button>
						<button type="button" on:click={addProject} disabled={!newProject.name.trim()}
							class="rounded-xl bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
							Add Project
						</button>
					</div>
				</div>
			{/if}

			<!-- AI enrichment status bar -->
			{#if enrichMsg}
				<div class="border-b border-slate-100 px-6 py-2.5 text-xs font-medium {enrichMsg.startsWith('✓') ? 'bg-violet-50 text-violet-700' : 'bg-red-50 text-red-700'}">
					{enrichMsg}
				</div>
			{/if}

			<!-- Projects List -->
			<div class="max-h-[50vh] overflow-y-auto p-6">
				{#if (projectsTarget.projects ?? []).length === 0}
					<div class="py-10 text-center text-slate-400 text-sm">No projects added yet. Click "+ Add Project" to get started.</div>
				{:else}
					<div class="divide-y divide-slate-100">
						{#each projectsTarget.projects as project, idx}
							<div class="py-3">
								{#if editingProjectIdx === idx}
									<!-- Inline edit form -->
									<div class="rounded-2xl bg-indigo-50 p-4">
										<div class="grid gap-3 sm:grid-cols-2">
											<div>
												<label for="edit-proj-name" class="block text-xs font-semibold text-slate-500 mb-1">Project Name <span class="text-red-500">*</span></label>
												<input id="edit-proj-name" type="text" bind:value={editingProject.name}
													class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none" />
											</div>
											<div>
												<label for="edit-proj-rera" class="block text-xs font-semibold text-slate-500 mb-1">RERA Reg No.</label>
												<input id="edit-proj-rera" type="text" bind:value={editingProject.reraRegNo}
													class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none" />
											</div>
											<div>
												<label for="edit-proj-district" class="block text-xs font-semibold text-slate-500 mb-1">District</label>
												<select id="edit-proj-district" bind:value={editingProject.district}
													class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none bg-white">
													<option value="">Select district…</option>
													{#each UP_DISTRICTS as d}
														<option value={d}>{d}</option>
													{/each}
												</select>
											</div>
											<div>
												<label for="edit-proj-area" class="block text-xs font-semibold text-slate-500 mb-1">Area</label>
												<input id="edit-proj-area" type="text" bind:value={editingProject.area}
													placeholder="e.g. Sector 62, Noida"
													class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none" />
											</div>
											<div>
												<label for="edit-proj-pincode" class="block text-xs font-semibold text-slate-500 mb-1">Pin Code</label>
												<input id="edit-proj-pincode" type="text" bind:value={editingProject.pinCode}
													placeholder="e.g. 201301"
													class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none" />
											</div>
											<div>
												<label for="edit-proj-type" class="block text-xs font-semibold text-slate-500 mb-1">Project Type</label>
												<select id="edit-proj-type" bind:value={editingProject.projectType}
													class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none bg-white">
													<option value="">Select type…</option>
													<option value="Residential">Residential</option>
													<option value="Commercial">Commercial</option>
													<option value="Villa">Villa</option>
													<option value="Plot">Plot</option>
													<option value="Mixed">Mixed</option>
												</select>
											</div>
											<div class="sm:col-span-2">
												<label for="edit-proj-status" class="block text-xs font-semibold text-slate-500 mb-1">Construction Status</label>
												<select id="edit-proj-status" bind:value={editingProject.constructionStatus}
													class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none bg-white">
													<option value="">Select status…</option>
													<option value="Ready to Move">Ready to Move</option>
													<option value="Under Construction">Under Construction</option>
													<option value="Resale">Resale</option>
												</select>
											</div>
										</div>
										<div class="mt-3 flex justify-end gap-2">
											<button type="button" on:click={() => { editingProjectIdx = null; editingProject = {}; lenderBankSelection = ''; }}
												class="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100">
												Cancel
											</button>
											<button type="button" on:click={saveProjectEdit} disabled={!editingProject.name?.trim()}
												class="rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
												Save
											</button>
										</div>
									</div>
								{:else}
									<!-- View row -->
									<div class="flex items-start justify-between">
										<div>
											<p class="text-sm font-semibold text-slate-900">{project.name}</p>
											<div class="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
												{#if project.reraRegNo}<span class="font-mono">{project.reraRegNo}</span>{/if}
												{#if project.district}<span>· {project.district}</span>{/if}
												{#if project.area}<span>· {project.area}</span>{/if}
												{#if project.pinCode}<span>· {project.pinCode}</span>{/if}
												{#if project.projectType}<span class="rounded-full bg-indigo-50 px-2 py-0.5 font-medium text-indigo-700">{project.projectType}</span>{/if}
												{#if project.constructionStatus}<span class="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700">{project.constructionStatus}</span>{/if}
												{#if normalizeLenderNames(project.lenderName).length}
													<span class="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
														{normalizeLenderNames(project.lenderName).join(', ')}
													</span>
												{/if}
												{#if project._aiMeta}
													<span class="rounded-full px-2 py-0.5 font-semibold {confidenceClass(project._aiMeta.confidence)}">
														✦ AI · {project._aiMeta.confidence}{project._aiMeta.usedSearch ? ' 🔍' : ''}
													</span>
												{/if}
											</div>
											{#if project._aiMeta?.sources?.length}
												<div class="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
													{#each project._aiMeta.sources.slice(0, 3) as src}
														<a href={src} target="_blank" rel="noopener noreferrer"
															class="truncate max-w-[200px] text-[10px] text-indigo-400 hover:text-indigo-600 hover:underline"
															title={src}>
															🔗 {hostname(src)}
														</a>
													{/each}
												</div>
											{/if}
										</div>
										<div class="ml-4 flex shrink-0 gap-2">
											<button
												type="button"
												on:click={() => enrichProject(projectsTarget._id, idx)}
												disabled={enrichingIdx === idx || enrichingAll}
												class="rounded-lg bg-violet-50 px-2 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-50 disabled:cursor-not-allowed"
												title="Ask GPT to fill area, pin code, district, type etc."
											>
												{#if enrichingIdx === idx}
													<svg class="inline h-3 w-3 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
														<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
														<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
													</svg>
												{:else}✦ AI{/if}
											</button>
											<button
												type="button"
												on:click={() => { openProjectEdit(idx, project); removeConfirmIdx = null; }}
												class="rounded-lg bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
											>Edit</button>
											{#if removeConfirmIdx === idx}
												<button
													type="button"
													on:click={() => {
														companies = companies.map((c) =>
															c._id === projectsTarget._id
																? { ...c, projects: c.projects.filter((_, i) => i !== idx) }
																: c
														);
														projectsTarget = companies.find((c) => c._id === projectsTarget._id);
														removeConfirmIdx = null;
														saveMsg = 'Project removed locally. Click "Save to file" to persist.';
													}}
													class="rounded-lg bg-red-600 px-2 py-1 text-xs font-semibold text-white hover:bg-red-700"
												>Confirm?</button>
												<button
													type="button"
													on:click={() => (removeConfirmIdx = null)}
													class="rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200"
												>Cancel</button>
											{:else}
												<button
													type="button"
													on:click={() => { removeConfirmIdx = idx; editingProjectIdx = null; }}
													class="rounded-lg bg-red-50 px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-100"
												>Remove</button>
											{/if}
										</div>
									</div>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>

			<div class="flex justify-end border-t border-slate-100 px-6 py-4">
				<button type="button" on:click={() => { projectsOpen = false; addProjectOpen = false; }}
					class="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
					Close
				</button>
			</div>

		</div>
	</div>
{/if}


<!-- ── DELETE MODAL ───────────────────────────────────────────────────────────── -->
{#if deleteOpen && deleteTarget}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
		<div class="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl">

			<div class="border-b border-slate-100 px-6 py-4">
				<h2 class="text-lg font-bold text-slate-900">Delete Builder</h2>
				<p class="mt-1 text-sm text-slate-500">
					{deleteStep === 1 ? 'Step 1 of 2 — please confirm.' : 'Step 2 of 2 — this cannot be undone.'}
				</p>
			</div>

			<div class="p-6">
				<div class="rounded-2xl bg-slate-50 p-4 text-sm">
					<p class="font-semibold text-slate-900">{deleteTarget.name}</p>
					<p class="mt-1 text-slate-500">{deleteTarget.reraRegNo}</p>
				</div>
				{#if deleteStep === 2}
					<p class="mt-4 text-sm font-semibold text-red-600">Are you absolutely sure? This builder will be permanently removed from the list.</p>
				{/if}
			</div>

			<div class="flex justify-end gap-3 border-t border-slate-100 px-6 py-4">
				<button type="button" on:click={cancelDelete}
					class="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
					Cancel
				</button>
				<button type="button" on:click={confirmDelete}
					class="rounded-xl px-5 py-2 text-sm font-semibold text-white {deleteStepClass(deleteStep)}">
					{deleteStep === 1 ? 'Continue' : 'Delete permanently'}
				</button>
			</div>

		</div>
	</div>
{/if}
