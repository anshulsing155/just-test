<script>
	import { onMount, onDestroy } from 'svelte';
	import { fade, slide } from 'svelte/transition';

	let projects      = [];
	let loading       = false;
	let scraping      = false;
	let checkingReady = false;

	let error        = '';
	let scrapeMsg    = '';
	let readyMsg     = '';

	let searchTerm   = '';
	let currentPage  = 1;
	const pageSize   = 20;

	let showModal    = false;
	let modalProject = null;

	// Progress polling
	let progress  = { done: 0, total: 0, running: false };
	let pollTimer = null;

	// ── Filtering & pagination ─────────────────────────────────────────────────

	$: filtered = projects.filter(p => {
		if (!searchTerm) return true;
		const s = searchTerm.toLowerCase();
		return (
			(p.projectName  && p.projectName.toLowerCase().includes(s))  ||
			(p.name         && p.name.toLowerCase().includes(s))         ||
			(p.promoterName && p.promoterName.toLowerCase().includes(s)) ||
			(p.district     && p.district.toLowerCase().includes(s))     ||
			(p.area         && p.area.toLowerCase().includes(s))         ||
			(p.pinCode      && p.pinCode.toLowerCase().includes(s))      ||
			(p.reraRegNo    && p.reraRegNo.toLowerCase().includes(s))    ||
			(p.projectType  && p.projectType.toLowerCase().includes(s))
		);
	});

	$: totalPages  = Math.max(1, Math.ceil(filtered.length / pageSize));
	$: if (currentPage > totalPages) currentPage = totalPages;
	$: paginated   = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

	let _lastSearch = '';
	$: { if (searchTerm !== _lastSearch) { currentPage = 1; _lastSearch = searchTerm; } }

	$: pageRange = (() => {
		const range = [], max = 5;
		let start = Math.max(1, currentPage - Math.floor(max / 2));
		let end   = Math.min(totalPages, start + max - 1);
		if (end - start + 1 < max) start = Math.max(1, end - max + 1);
		for (let i = start; i <= end; i++) range.push(i);
		return range;
	})();

	// ── Progress polling ───────────────────────────────────────────────────────

	function startPolling() {
		stopPolling();
		pollTimer = setInterval(async () => {
			try {
				const res  = await fetch('/api/telangana-rera-projects?action=scrape-status');
				const data = await res.json();
				if (data.success) {
					progress = data.progress || progress;
					if (!progress.running && progress.done > 0) {
						stopPolling();
						scraping  = false;
						scrapeMsg = `Done! ${progress.done} projects scraped.`;
						await fetchProjects();
					}
				}
			} catch {}
		}, 3000);
	}

	function stopPolling() {
		if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
	}

	// ── API calls ──────────────────────────────────────────────────────────────

	async function fetchProjects() {
		loading = true; error = '';
		try {
			const res    = await fetch('/api/telangana-rera-projects');
			const result = await res.json();
			if (result.success) projects = result.data || [];
			else throw new Error(result.error);
		} catch (e) {
			error = e.message || 'Failed to load projects';
		} finally {
			loading = false;
		}
	}

	async function openBrowser() {
		readyMsg = ''; error = '';
		try {
			const res    = await fetch('/api/telangana-rera-projects?action=open-browser');
			const result = await res.json();
			if (result.success) {
				readyMsg = 'Browser opened. Fill the search form on RERAIT and submit. Then click "Check Ready".';
			} else throw new Error(result.error);
		} catch (e) {
			error = e.message || 'Failed to open browser';
		}
	}

	async function checkReady() {
		checkingReady = true; error = '';
		try {
			const res    = await fetch('/api/telangana-rera-projects?action=check-ready');
			const result = await res.json();
			if (result.sessionExpired) {
				readyMsg = 'Session expired — open the browser again.';
			} else if (result.ready) {
				readyMsg = 'Results table detected! Click "Scrape Now" to begin.';
			} else {
				readyMsg = 'Results not ready yet. Submit the search form on RERAIT, then check again.';
			}
		} catch (e) {
			error = e.message || 'Check failed';
		} finally {
			checkingReady = false;
		}
	}

	async function scrapeNow() {
		scraping = true; scrapeMsg = ''; error = '';
		progress = { done: 0, total: 0, running: true };
		try {
			const res    = await fetch('/api/telangana-rera-projects?refresh=true');
			const result = await res.json();
			if (result.success) {
				projects = result.data || [];
				if (result.scraping) {
					startPolling();
				} else {
					scraping  = false;
					scrapeMsg = `Done! ${result.total ?? projects.length} projects scraped.`;
				}
			} else throw new Error(result.error);
		} catch (e) {
			scraping = false;
			error = e.message || 'Scrape failed';
		}
	}

	async function closeBrowser() {
		await fetch('/api/telangana-rera-projects?action=close-browser').catch(() => {});
		readyMsg = 'Browser closed.';
	}

	// ── Detail modal ───────────────────────────────────────────────────────────

	function viewDetails(project) {
		modalProject = project;
		showModal    = true;
	}

	function closeModal() {
		showModal    = false;
		modalProject = null;
	}

	// ── Helpers ────────────────────────────────────────────────────────────────

	function getName(p)  { return p.projectName || p.name || '—'; }
	function getPromo(p) { return p.promoterName || '—'; }

	/** Flatten all sections from raw detail data into an array of [key, value] */
	function getFlatFields(project) {
		const raw     = project?.rawData;
		const detail  = raw?.detail;
		if (!detail?.sections) return [];
		const pairs   = [];
		const seen    = new Set();
		Object.entries(detail.sections).forEach(([sec, fields]) => {
			Object.entries(fields).forEach(([k, v]) => {
				if (!seen.has(k) && v && v.trim()) { seen.add(k); pairs.push([k, v]); }
			});
		});
		return pairs;
	}

	/** Get all embedded tables from the detail */
	function getDetailTables(project) {
		return project?.rawData?.detail?.tables || [];
	}

	onMount(fetchProjects);
	onDestroy(stopPolling);
</script>

<svelte:head>
	<title>Telangana RERA Projects — RERA Toolkit</title>
</svelte:head>

<div class="space-y-6">

	<!-- Page header ─────────────────────────────────────────────────────────── -->
	<div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
		<div class="flex flex-wrap items-start justify-between gap-4">
			<div>
				<h1 class="text-2xl font-bold text-slate-900">Telangana RERA — Projects</h1>
				<p class="mt-1 text-sm text-slate-500">
					Registered projects from RERAIT — Telangana Real Estate Regulatory Authority.
				</p>
			</div>

			<div class="flex flex-wrap gap-2">
				<button
					on:click={openBrowser}
					disabled={scraping}
					class="inline-flex items-center gap-2 rounded-xl bg-slate-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
					title="Open visible Chrome window pointing at RERAIT search page"
				>
					<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
							d="M15 12H3m0 0l4-4m-4 4l4 4m9-9a9 9 0 11-18 0 9 9 0 0118 0z" />
					</svg>
					Open Browser
				</button>

				<button
					on:click={checkReady}
					disabled={checkingReady || scraping}
					class="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
					title="Check if the search results table has loaded"
				>
					{#if checkingReady}
						<svg class="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
						</svg>
						Checking…
					{:else}
						<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
						</svg>
						Check Ready
					{/if}
				</button>

				<button
					on:click={scrapeNow}
					disabled={scraping || loading}
					class="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
					title="Scrape all rows + click View Details for each — fully dynamic extraction"
				>
					{#if scraping}
						<svg class="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
						</svg>
						Scraping…
					{:else}
						<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
						</svg>
						Scrape Now
					{/if}
				</button>

				<button
					on:click={closeBrowser}
					disabled={scraping}
					class="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 shadow-sm transition-all hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
				>
					<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
					</svg>
					Close Browser
				</button>
			</div>
		</div>

		<!-- Status banners -->
		{#if scraping && progress.total > 0}
			<div class="mt-4 space-y-1.5" transition:slide>
				<div class="flex items-center justify-between text-xs text-slate-500">
					<span>Scraping projects…</span>
					<span>{progress.done} / {progress.total}</span>
				</div>
				<div class="h-2 overflow-hidden rounded-full bg-slate-100">
					<div
						class="h-full rounded-full bg-indigo-500 transition-all duration-500"
						style="width: {Math.round((progress.done / progress.total) * 100)}%"
					></div>
				</div>
			</div>
		{:else if scraping}
			<div class="mt-4 flex items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-800" transition:slide>
				<svg class="h-4 w-4 shrink-0 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
					<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
					<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
				</svg>
				<span><strong>Collecting project rows…</strong> Building the list before opening detail pages.</span>
			</div>
		{/if}

		{#if readyMsg}
			<div class="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" transition:slide>
				{readyMsg}
			</div>
		{/if}

		{#if scrapeMsg}
			<div class="mt-4 flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800" transition:slide>
				<svg class="h-4 w-4 text-green-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
				</svg>
				{scrapeMsg}
			</div>
		{/if}

		{#if error}
			<div class="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" transition:slide>
				<strong>Error:</strong> {error}
			</div>
		{/if}
	</div>

	<!-- How to use ──────────────────────────────────────────────────────────── -->
	<div class="rounded-2xl border border-blue-100 bg-blue-50 p-5 text-sm text-blue-800">
		<p class="font-semibold mb-2">How to scrape Telangana RERA:</p>
		<ol class="list-decimal list-inside space-y-1 text-blue-700">
			<li>Click <strong>Open Browser</strong> — a Chrome window opens on the RERAIT search page.</li>
			<li>Fill in the search criteria (e.g., leave blank for all projects) and submit the form.</li>
			<li>Click <strong>Check Ready</strong> — once results appear, the status will say "Ready".</li>
			<li>Click <strong>Scrape Now</strong> — the tool reads every row and visits "View Details" for each project, capturing all fields dynamically.</li>
			<li>After scraping finishes the browser closes automatically.</li>
		</ol>
	</div>

	<!-- Search ───────────────────────────────────────────────────────────────── -->
	<div class="flex items-center justify-between gap-3">
		<p class="text-sm text-slate-500">
			{filtered.length} project{filtered.length !== 1 ? 's' : ''}
			{searchTerm ? 'matching' : 'total'}
		</p>
		<input
			type="text"
			placeholder="Search projects, promoters, district…"
			bind:value={searchTerm}
			class="w-72 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200"
		/>
	</div>

	<!-- Table ────────────────────────────────────────────────────────────────── -->
	<div class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
		{#if loading}
			<div class="flex items-center justify-center py-20">
				<div class="flex flex-col items-center gap-4">
					<svg class="h-8 w-8 animate-spin text-indigo-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
					</svg>
					<p class="text-sm text-slate-500">Loading…</p>
				</div>
			</div>

		{:else if paginated.length === 0}
			<div class="flex flex-col items-center justify-center py-20 text-center">
				<svg class="h-12 w-12 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
						d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
				</svg>
				<p class="mt-4 text-sm font-medium text-slate-500">
					{searchTerm ? 'No projects match your search.' : 'No data yet — open the browser, submit a search, then scrape.'}
				</p>
			</div>

		{:else}
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead class="border-b border-slate-200 bg-slate-50">
						<tr>
							<th class="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">#</th>
							<th class="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Project Name</th>
							<th class="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Promoter</th>
							<th class="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">District</th>
							<th class="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Area</th>
							<th class="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Pin Code</th>
							<th class="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Type</th>
							<th class="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Status</th>
							<th class="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Completion</th>
							<th class="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Actions</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-100">
						{#each paginated as p, i}
							<tr class="transition-colors hover:bg-slate-50">
								<td class="px-5 py-4 text-xs text-slate-400">{(currentPage - 1) * pageSize + i + 1}</td>
								<td class="px-5 py-4 font-medium text-slate-900">{getName(p)}</td>
								<td class="px-5 py-4 text-slate-600">{getPromo(p)}</td>
								<td class="px-5 py-4 text-slate-600">{p.district || '—'}</td>
								<td class="px-5 py-4 text-slate-600">{p.area || '—'}</td>
								<td class="px-5 py-4 text-slate-600">{p.pinCode || '—'}</td>
								<td class="px-5 py-4 text-slate-600">{p.projectType || '—'}</td>
								<td class="px-5 py-4">
									{#if p.constructionStatus}
										<span class="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold
											{/complete|finish|handover/i.test(p.constructionStatus) ? 'bg-green-100 text-green-700' :
											 /new/i.test(p.constructionStatus) ? 'bg-blue-100 text-blue-700' :
											 'bg-slate-100 text-slate-600'}">
											{p.constructionStatus}
										</span>
									{:else}
										<span class="text-slate-400">—</span>
									{/if}
								</td>
								<td class="px-5 py-4 text-slate-600">{p.validUntil || '—'}</td>
								<td class="px-5 py-4">
									<button
										on:click={() => viewDetails(p)}
										class="inline-flex items-center gap-1 rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-100"
									>
										Details
									</button>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<!-- Pagination -->
			{#if totalPages > 1}
				<div class="flex items-center justify-between border-t border-slate-100 px-5 py-4">
					<p class="text-xs text-slate-500">
						Showing {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filtered.length)} of {filtered.length}
					</p>
					<div class="flex items-center gap-1">
						<button
							on:click={() => currentPage = Math.max(1, currentPage - 1)}
							disabled={currentPage === 1}
							class="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
						>Prev</button>
						{#each pageRange as pg}
							<button
								on:click={() => currentPage = pg}
								class="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors {pg === currentPage ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}"
							>{pg}</button>
						{/each}
						<button
							on:click={() => currentPage = Math.min(totalPages, currentPage + 1)}
							disabled={currentPage === totalPages}
							class="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
						>Next</button>
					</div>
				</div>
			{/if}
		{/if}
	</div>
</div>

<!-- Detail modal ──────────────────────────────────────────────────────────── -->
{#if showModal && modalProject}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
		on:click|self={closeModal}
		on:keydown|self={(e) => { if (e.key === 'Escape') closeModal(); }}
		role="presentation"
		transition:fade={{ duration: 150 }}
	>
		<div
			class="relative flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
			role="dialog"
			aria-modal="true"
			style="max-height: 90vh;"
		>
			<!-- Header -->
			<div class="flex shrink-0 items-start justify-between border-b border-slate-100 p-6">
				<div>
					<h2 class="text-lg font-bold text-slate-900">{getName(modalProject)}</h2>
					<p class="mt-0.5 text-xs text-slate-500">{getPromo(modalProject)}</p>
				</div>
				<button
					on:click={closeModal}
					class="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
					aria-label="Close"
				>
					<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>

			<!-- Body -->
			<div class="flex-1 overflow-y-auto p-6 space-y-6">

				<!-- Top-level summary fields -->
				<div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
					{#each [
						['Project Name',  getName(modalProject)],
						['Promoter',      getPromo(modalProject)],
						['District',      modalProject.district],
						['Area',          modalProject.area],
						['Pin Code',      modalProject.pinCode],
						['Project Type',  modalProject.projectType],
						['Status',        modalProject.constructionStatus],
						['Completion',    modalProject.validUntil],
						['RERA Reg. No.', modalProject.reraRegNo],
						['Location',      modalProject.location]
					] as [label, val]}
						{#if val && val !== '—'}
							<div class="rounded-xl border border-slate-100 bg-slate-50 p-3">
								<p class="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
								<p class="mt-1 break-words text-sm font-medium text-slate-700">{val}</p>
							</div>
						{/if}
					{/each}
				</div>

				<!-- Dynamic sections from the detail page -->
				{#if getFlatFields(modalProject).length > 0}
					<div>
						<h3 class="mb-3 text-sm font-bold text-slate-700">Full Detail (all captured fields)</h3>
						<div class="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
							{#each getFlatFields(modalProject) as [key, val]}
								<div class="flex gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
									<span class="shrink-0 text-xs font-semibold text-slate-400 w-36 truncate" title={key}>{key}</span>
									<span class="text-xs text-slate-700 break-words">{val}</span>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Dynamic tables from the detail page -->
				{#each getDetailTables(modalProject) as tbl, ti}
					{#if tbl.rows && tbl.rows.length > 0}
						<div>
							<h3 class="mb-2 text-sm font-bold text-slate-700">
								{tbl.section || 'Table'} {getDetailTables(modalProject).length > 1 ? `(${ti + 1})` : ''}
							</h3>
							<div class="overflow-x-auto rounded-xl border border-slate-200">
								<table class="w-full text-xs">
									<thead class="border-b border-slate-200 bg-slate-50">
										<tr>
											{#each tbl.headers as h}
												<th class="px-3 py-2 text-left font-semibold text-slate-500">{h}</th>
											{/each}
										</tr>
									</thead>
									<tbody class="divide-y divide-slate-100">
										{#each tbl.rows as row}
											<tr class="hover:bg-slate-50">
												{#each tbl.headers as h}
													<td class="px-3 py-2 text-slate-700">{row[h] ?? '—'}</td>
												{/each}
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						</div>
					{/if}
				{/each}

				<!-- Last modified from raw basic row -->
				{#if modalProject?.rawData?.lastModified}
					<div class="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-500">
						<span class="font-semibold">Last Modified:</span> {modalProject.rawData.lastModified}
					</div>
				{/if}
			</div>

			<!-- Footer -->
			<div class="shrink-0 border-t border-slate-100 px-6 py-4 flex justify-end">
				<button
					on:click={closeModal}
					class="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
				>
					Close
				</button>
			</div>
		</div>
	</div>
{/if}
