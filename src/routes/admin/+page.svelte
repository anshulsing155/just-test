<script>
	import { onMount } from 'svelte';
	import { fade, slide } from 'svelte/transition';

	// ── State ──
	let stats = null;
	let loading = true;
	let error = ''; 
//
	// Data browser
	let activeModel = 'agent';
	let activeState = '';
	let searchTerm = '';
	let browseData = [];
	let browseTotal = 0;
	let browsePage = 1;
	let browsePageSize = 25;
	let browseLoading = false;

	// Scrape actions
	let scrapeRunning = {};
	let scrapeMessages = {};

	// Detail modal
	let detailRecord = null;
	let detailEntity = null;
	let detailEntityType = '';
	let detailLoading = false;

	// ── Computed ──
	$: totalBrowsePages = Math.max(1, Math.ceil(browseTotal / browsePageSize));
	$: stateList = stats ? Object.keys(stats.states).sort() : [];
	$: browsePageRange = (() => {
		const range = [];
		const max = 5;
		let start = Math.max(1, browsePage - Math.floor(max / 2));
		let end = Math.min(totalBrowsePages, start + max - 1);
		if (end - start + 1 < max) start = Math.max(1, end - max + 1);
		for (let i = start; i <= end; i++) range.push(i);
		return range;
	})();

	// ── Scraper definitions ──
	const scrapers = [
		{ id: 'up-agents', label: 'UP Agents', url: '/api/up-rera-agents?refresh=true', state: 'UP' },
		{ id: 'up-promoters', label: 'UP Promoters', url: '/api/up-rera-promoters?refresh=true', state: 'UP' },
		{ id: 'up-projects', label: 'UP Projects', url: '/api/up-rera-projects?action=scrape-all&refresh=true', state: 'UP' },
		{ id: 'delhi-agents', label: 'Delhi Agents', url: '/api/delhi-rera-agents?refresh=true', state: 'Delhi' },
		{ id: 'delhi-promoters', label: 'Delhi Promoters', url: '/api/delhi-rera-promoters?refresh=true', state: 'Delhi' },
		{ id: 'mp-agents', label: 'MP Agents', url: '/api/mp-rera-agents?refresh=true', state: 'MP' },
		{ id: 'mp-promoters', label: 'MP Promoters', url: '/api/mp-rera-promoters?refresh=true', state: 'MP' },
		{ id: 'mp-projects', label: 'MP Projects', url: '/api/mp-rera-projects?action=scrape-all&refresh=true', state: 'MP' },
		{ id: 'punjab-agents', label: 'Punjab Agents', url: '/api/punjab-rera-agents?refresh=true', state: 'Punjab' },
		{ id: 'punjab-promoters', label: 'Punjab Promoters', url: '/api/punjab-rera-promoters?refresh=true', state: 'Punjab' },
		{ id: 'punjab-projects', label: 'Punjab Projects', url: '/api/punjab-rera-projects?action=scrape-all&refresh=true', state: 'Punjab' },
		{ id: 'rajasthan-agents', label: 'Rajasthan Agents', url: '/api/rajasthan-rera-agents?refresh=true', state: 'Rajasthan' }
	];

	// ── Fetchers ──
	async function fetchStats() {
		loading = true;
		try {
			const res = await fetch('/api/admin/stats');
			const result = await res.json();
			if (result.success) stats = result;
			else error = result.error;
		} catch (e) {
			error = e.message;
		} finally {
			loading = false;
		}
	}

	async function fetchBrowseData() {
		browseLoading = true;
		try {
			const params = new URLSearchParams({
				model: activeModel,
				page: String(browsePage),
				take: String(browsePageSize)
			});
			if (activeState) params.set('state', activeState);
			if (searchTerm) params.set('search', searchTerm);
			const res = await fetch(`/api/admin/data?${params}`);
			const result = await res.json();
			if (result.success) {
				browseData = result.data;
				browseTotal = result.total;
			}
		} catch (e) {
			console.error('Browse error:', e);
		} finally {
			browseLoading = false;
		}
	}

	function switchModel(model) {
		activeModel = model;
		browsePage = 1;
		fetchBrowseData();
	}

	function switchState(state) {
		activeState = state;
		browsePage = 1;
		fetchBrowseData();
	}

	function goToPage(page) {
		browsePage = Math.max(1, Math.min(page, totalBrowsePages));
		fetchBrowseData();
	}

	let searchTimeout;
	function onSearchInput() {
		clearTimeout(searchTimeout);
		searchTimeout = setTimeout(() => {
			browsePage = 1;
			fetchBrowseData();
		}, 400);
	}

	async function triggerScrape(scraper) {
		scrapeRunning[scraper.id] = true;
		scrapeMessages[scraper.id] = '';
		try {
			const res = await fetch(scraper.url);
			const result = await res.json();
			if (result.success) {
				const count = result.scraped || result.total || result.data?.length || 0;
				scrapeMessages[scraper.id] = `Done — ${count} records`;
				fetchStats();
				fetchBrowseData();
			} else {
				scrapeMessages[scraper.id] = `Error: ${result.error}`;
			}
		} catch (e) {
			scrapeMessages[scraper.id] = `Failed: ${e.message}`;
		} finally {
			scrapeRunning[scraper.id] = false;
		}
	}

	async function showEntity(entityType, record) {
		detailRecord = record;
		detailEntity = null;
		detailEntityType = entityType;
		detailLoading = true;

		if (entityType === 'company' || entityType === 'agent' || entityType === 'project') {
			try {
				const params = new URLSearchParams({
					model: 'detail',
					id: record.id,
					entityType
				});
				const res = await fetch(`/api/admin/data?${params}`);
				const result = await res.json();
				if (result.success) {
					detailEntity = result.entity;
					detailEntityType = result.entityType;
				}
			} catch (e) {
				console.error('Detail fetch error:', e);
			}
		}

		detailLoading = false;
	}

	function showDetail(record) {
		return showEntity(activeModel, record);
	}

	function closeDetail() {
		detailRecord = null;
		detailEntity = null;
		detailEntityType = '';
	}

	function formatDate(d) {
		if (!d) return '—';
		return new Date(d).toLocaleString('en-IN', {
			day: '2-digit',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function formatDuration(ms) {
		if (!ms) return '—';
		if (ms < 1000) return ms + 'ms';
		if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
		return (ms / 60000).toFixed(1) + 'min';
	}

	onMount(() => {
		fetchStats().then(() => fetchBrowseData());
	});
</script>

<svelte:head>
	<title>Data Management — RERA Toolkit</title>
</svelte:head>

<div class="mx-auto max-w-7xl space-y-8 p-4 sm:p-6">
	<!-- Header -->
	<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
		<div>
			<h1 class="text-2xl font-bold tracking-tight text-slate-900">Data Management</h1>
			<p class="mt-1 text-sm text-slate-500">Database overview, scraping controls, and data browser</p>
		</div>
		<button
			on:click={fetchStats}
			class="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 transition-colors"
		>
			<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
			</svg>
			Refresh
		</button>
	</div>

	{#if loading}
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
			{#each Array(3) as _}
				<div class="animate-pulse rounded-xl border border-slate-200 bg-white p-6">
					<div class="h-4 w-24 rounded bg-slate-100"></div>
					<div class="mt-3 h-8 w-16 rounded bg-slate-100"></div>
				</div>
			{/each}
		</div>
	{:else if error}
		<div class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
			<p class="font-medium">Error: {error}</p>
			<button on:click={fetchStats} class="mt-2 font-semibold text-red-800 hover:text-red-900">Retry</button>
		</div>
	{:else if stats}
		<!-- ═══════════════════════════════════════════════════ -->
		<!-- SECTION 1: Overview Cards                          -->
		<!-- ═══════════════════════════════════════════════════ -->
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
			<div class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
				<div class="flex items-center gap-3">
					<div class="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50">
						<svg class="h-5 w-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
						</svg>
					</div>
					<div>
						<p class="text-sm font-medium text-slate-500">Agents</p>
						<p class="text-2xl font-bold text-slate-900">{stats.totals.agents.toLocaleString()}</p>
					</div>
				</div>
			</div>
			<div class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
				<div class="flex items-center gap-3">
					<div class="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50">
						<svg class="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
						</svg>
					</div>
					<div>
						<p class="text-sm font-medium text-slate-500">Companies</p>
						<p class="text-2xl font-bold text-slate-900">{stats.totals.companies.toLocaleString()}</p>
					</div>
				</div>
			</div>
			<div class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
				<div class="flex items-center gap-3">
					<div class="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50">
						<svg class="h-5 w-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
						</svg>
					</div>
					<div>
						<p class="text-sm font-medium text-slate-500">Projects</p>
						<p class="text-2xl font-bold text-slate-900">{stats.totals.projects.toLocaleString()}</p>
					</div>
				</div>
			</div>
		</div>

		<!-- ═══════════════════════════════════════════════════ -->
		<!-- SECTION 2: State Breakdown                         -->
		<!-- ═══════════════════════════════════════════════════ -->
		<div class="rounded-xl border border-slate-200 bg-white shadow-sm">
			<div class="border-b border-slate-100 px-6 py-4">
				<h2 class="text-base font-semibold text-slate-900">State-wise Breakdown</h2>
			</div>
			<div class="overflow-x-auto">
				<table class="w-full text-left text-sm">
					<thead class="border-b border-slate-100 bg-slate-50/50">
						<tr>
							<th class="px-6 py-3 font-semibold text-slate-700">State</th>
							<th class="px-6 py-3 font-semibold text-slate-700 text-right">Agents</th>
							<th class="px-6 py-3 font-semibold text-slate-700 text-right">Companies</th>
							<th class="px-6 py-3 font-semibold text-slate-700 text-right">Projects</th>
							<th class="px-6 py-3 font-semibold text-slate-700 text-right">Total Records</th>
							<th class="px-6 py-3 font-semibold text-slate-700">Actions</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-50">
						{#each stateList as state}
							{@const s = stats.states[state]}
							{@const total = s.agents + s.companies + s.projects}
							<tr class="hover:bg-slate-50/80 transition-colors">
								<td class="px-6 py-3.5">
									<span class="inline-flex items-center gap-2 font-medium text-slate-900">
										<span class="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-50 text-xs font-bold text-indigo-600">
											{state.charAt(0)}
										</span>
										{state}
									</span>
								</td>
								<td class="px-6 py-3.5 text-right tabular-nums text-slate-700">{s.agents.toLocaleString()}</td>
								<td class="px-6 py-3.5 text-right tabular-nums text-slate-700">{s.companies.toLocaleString()}</td>
								<td class="px-6 py-3.5 text-right tabular-nums text-slate-700">{s.projects.toLocaleString()}</td>
								<td class="px-6 py-3.5 text-right">
									<span class="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
										{total.toLocaleString()}
									</span>
								</td>
								<td class="px-6 py-3.5">
									<button
										on:click={() => switchState(state)}
										class="text-xs font-medium text-indigo-600 hover:text-indigo-800"
									>
										Browse
									</button>
								</td>
							</tr>
						{/each}
						<!-- Totals row -->
						<tr class="bg-slate-50 font-semibold">
							<td class="px-6 py-3.5 text-slate-900">Total</td>
							<td class="px-6 py-3.5 text-right tabular-nums text-slate-900">{stats.totals.agents.toLocaleString()}</td>
							<td class="px-6 py-3.5 text-right tabular-nums text-slate-900">{stats.totals.companies.toLocaleString()}</td>
							<td class="px-6 py-3.5 text-right tabular-nums text-slate-900">{stats.totals.projects.toLocaleString()}</td>
							<td class="px-6 py-3.5 text-right">
								<span class="inline-flex items-center rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-bold text-indigo-700">
									{(stats.totals.agents + stats.totals.companies + stats.totals.projects).toLocaleString()}
								</span>
							</td>
							<td class="px-6 py-3.5"></td>
						</tr>
					</tbody>
				</table>
			</div>
		</div>

		<!-- ═══════════════════════════════════════════════════ -->
		<!-- SECTION 3: Scrape Controls                         -->
		<!-- ═══════════════════════════════════════════════════ -->
		<div class="rounded-xl border border-slate-200 bg-white shadow-sm">
			<div class="border-b border-slate-100 px-6 py-4">
				<h2 class="text-base font-semibold text-slate-900">Scraper Controls</h2>
				<p class="mt-0.5 text-xs text-slate-500">Trigger data scraping for each source. Long-running scrapes run in the background.</p>
			</div>
			<div class="grid grid-cols-1 gap-3 p-6 sm:grid-cols-2 lg:grid-cols-4">
				{#each scrapers as scraper}
					<div class="rounded-lg border border-slate-200 p-4 transition-colors {scrapeRunning[scraper.id] ? 'bg-indigo-50 border-indigo-200' : 'bg-white hover:bg-slate-50'}">
						<div class="flex items-center justify-between">
							<div>
								<p class="text-sm font-medium text-slate-900">{scraper.label}</p>
								<p class="text-xs text-slate-500">{scraper.state}</p>
							</div>
							<button
								on:click={() => triggerScrape(scraper)}
								disabled={scrapeRunning[scraper.id]}
								class="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors
									{scrapeRunning[scraper.id]
										? 'bg-indigo-100 text-indigo-600 cursor-wait'
										: 'bg-indigo-600 text-white hover:bg-indigo-500'}"
							>
								{#if scrapeRunning[scraper.id]}
									<svg class="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
										<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
										<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
									</svg>
									Running...
								{:else}
									Run
								{/if}
							</button>
						</div>
						{#if scrapeMessages[scraper.id]}
							<p class="mt-2 text-xs {scrapeMessages[scraper.id].startsWith('Error') || scrapeMessages[scraper.id].startsWith('Failed') ? 'text-red-600' : 'text-emerald-600'}" transition:fade>
								{scrapeMessages[scraper.id]}
							</p>
						{/if}
					</div>
				{/each}
			</div>
		</div>

		<!-- ═══════════════════════════════════════════════════ -->
		<!-- SECTION 4: Recent Scrape Logs                      -->
		<!-- ═══════════════════════════════════════════════════ -->
		<div class="rounded-xl border border-slate-200 bg-white shadow-sm">
			<div class="border-b border-slate-100 px-6 py-4">
				<h2 class="text-base font-semibold text-slate-900">Recent Scrape Logs</h2>
			</div>
			<div class="overflow-x-auto">
				<table class="w-full text-left text-sm">
					<thead class="border-b border-slate-100 bg-slate-50/50">
						<tr>
							<th class="px-6 py-3 font-semibold text-slate-700">Source</th>
							<th class="px-6 py-3 font-semibold text-slate-700">State</th>
							<th class="px-6 py-3 font-semibold text-slate-700">Status</th>
							<th class="px-6 py-3 font-semibold text-slate-700 text-right">Items</th>
							<th class="px-6 py-3 font-semibold text-slate-700 text-right">Duration</th>
							<th class="px-6 py-3 font-semibold text-slate-700">Started</th>
							<th class="px-6 py-3 font-semibold text-slate-700">Error</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-50">
						{#each (stats.scrapeLogs || []).slice(0, 20) as log}
							<tr class="hover:bg-slate-50/80 transition-colors">
								<td class="px-6 py-3 font-mono text-xs text-slate-700">{log.source}</td>
								<td class="px-6 py-3 text-slate-700">{log.state}</td>
								<td class="px-6 py-3">
									<span class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium
										{log.status === 'success' ? 'bg-emerald-50 text-emerald-700' :
										 log.status === 'running' ? 'bg-blue-50 text-blue-700' :
										 'bg-red-50 text-red-700'}">
										{#if log.status === 'running'}
											<span class="mr-1 h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse"></span>
										{/if}
										{log.status}
									</span>
								</td>
								<td class="px-6 py-3 text-right tabular-nums text-slate-700">{log.totalItems?.toLocaleString() || '—'}</td>
								<td class="px-6 py-3 text-right tabular-nums text-slate-500">{formatDuration(log.duration)}</td>
								<td class="px-6 py-3 text-slate-500 text-xs">{formatDate(log.startedAt)}</td>
								<td class="px-6 py-3 text-xs text-red-600 max-w-xs truncate" title={log.error || ''}>{log.error || '—'}</td>
							</tr>
						{/each}
						{#if !stats.scrapeLogs?.length}
							<tr><td colspan="7" class="px-6 py-8 text-center text-sm text-slate-400">No scrape logs yet</td></tr>
						{/if}
					</tbody>
				</table>
			</div>
		</div>

		<!-- ═══════════════════════════════════════════════════ -->
		<!-- SECTION 5: Data Browser                            -->
		<!-- ═══════════════════════════════════════════════════ -->
		<div class="rounded-xl border border-slate-200 bg-white shadow-sm">
			<div class="border-b border-slate-100 px-6 py-4">
				<h2 class="text-base font-semibold text-slate-900">Data Browser</h2>
				<p class="mt-0.5 text-xs text-slate-500">Browse and inspect all records in the database</p>
			</div>

			<!-- Model Tabs + State Filter + Search -->
			<div class="border-b border-slate-100 px-6 py-3 space-y-3">
				<div class="flex flex-wrap items-center gap-3">
					<!-- Model tabs -->
					<div class="flex gap-1 rounded-lg bg-slate-100 p-1">
						{#each [
							{ key: 'agent', label: 'Agents' },
							{ key: 'company', label: 'Companies' },
							{ key: 'project', label: 'Projects' },
							{ key: 'scrapeLog', label: 'Scrape Logs' }
						] as tab}
							<button
								on:click={() => switchModel(tab.key)}
								class="rounded-md px-3 py-1.5 text-xs font-medium transition-all
									{activeModel === tab.key
										? 'bg-white text-slate-900 shadow-sm'
										: 'text-slate-600 hover:text-slate-900'}"
							>
								{tab.label}
							</button>
						{/each}
					</div>

					<!-- State filter -->
					{#if activeModel !== 'scrapeLog'}
						<select
							bind:value={activeState}
							on:change={() => { browsePage = 1; fetchBrowseData(); }}
							class="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
						>
							<option value="">All States</option>
							{#each stateList as state}
								<option value={state}>{state}</option>
							{/each}
						</select>
					{/if}

					<!-- Search -->
					<div class="relative flex-1 min-w-[200px]">
						<div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
							<svg class="h-3.5 w-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
							</svg>
						</div>
						<input
							type="text"
							bind:value={searchTerm}
							on:input={onSearchInput}
							placeholder="Search records..."
							class="block w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-9 pr-3 text-xs placeholder-slate-400 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
						/>
					</div>

					<!-- Page size -->
					<select
						bind:value={browsePageSize}
						on:change={() => { browsePage = 1; fetchBrowseData(); }}
						class="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 shadow-sm"
					>
						<option value={10}>10</option>
						<option value={25}>25</option>
						<option value={50}>50</option>
						<option value={100}>100</option>
					</select>
				</div>
			</div>

			<!-- Data Table -->
			<div class="overflow-x-auto">
				{#if activeModel === 'agent'}
					<table class="w-full text-left text-xs">
						<thead class="border-b border-slate-100 bg-slate-50/50">
							<tr>
								<th class="px-4 py-3 font-semibold text-slate-700 w-8">#</th>
								<th class="px-4 py-3 font-semibold text-slate-700">State</th>
								<th class="px-4 py-3 font-semibold text-slate-700">RERA Reg No</th>
								<th class="px-4 py-3 font-semibold text-slate-700">Name</th>
								<th class="px-4 py-3 font-semibold text-slate-700">District</th>
								<th class="px-4 py-3 font-semibold text-slate-700">Firm Type</th>
								<th class="px-4 py-3 font-semibold text-slate-700">Mobile</th>
								<th class="px-4 py-3 font-semibold text-slate-700">Status</th>
								<th class="px-4 py-3 font-semibold text-slate-700">Scraped</th>
								<th class="px-4 py-3 font-semibold text-slate-700 w-8"></th>
							</tr>
						</thead>
						<tbody class="divide-y divide-slate-50">
							{#if browseLoading}
								{#each Array(5) as _}
									<tr class="animate-pulse">
										{#each Array(10) as _}<td class="px-4 py-3"><div class="h-3 w-3/4 rounded bg-slate-100"></div></td>{/each}
									</tr>
								{/each}
							{:else if browseData.length === 0}
								<tr><td colspan="10" class="px-4 py-12 text-center text-sm text-slate-400">No records found</td></tr>
							{:else}
								{#each browseData as row, i}
									<tr class="hover:bg-slate-50/80 transition-colors">
										<td class="px-4 py-2.5 text-slate-400">{(browsePage - 1) * browsePageSize + i + 1}</td>
										<td class="px-4 py-2.5"><span class="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">{row.state}</span></td>
										<td class="px-4 py-2.5 font-mono text-slate-700">{row.reraRegNo || '—'}</td>
										<td class="px-4 py-2.5 text-slate-900 max-w-[200px] truncate" title={row.name}>{row.name || '—'}</td>
										<td class="px-4 py-2.5 text-slate-600">{row.district || '—'}</td>
										<td class="px-4 py-2.5 text-slate-600">{row.firmType || '—'}</td>
										<td class="px-4 py-2.5 text-slate-600">{row.mobile || '—'}</td>
										<td class="px-4 py-2.5">
											{#if row.status}
												<span class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium {row.status === 'Approved' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}">{row.status}</span>
											{:else}
												<span class="text-slate-400">—</span>
											{/if}
										</td>
										<td class="px-4 py-2.5 text-slate-400">{formatDate(row.scrapedAt)}</td>
										<td class="px-4 py-2.5">
											<button on:click={() => showDetail(row)} class="text-indigo-600 hover:text-indigo-800">
												<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
											</button>
										</td>
									</tr>
								{/each}
							{/if}
						</tbody>
					</table>
				{:else if activeModel === 'company'}
					<table class="w-full text-left text-xs">
						<thead class="border-b border-slate-100 bg-slate-50/50">
							<tr>
								<th class="px-4 py-3 font-semibold text-slate-700 w-8">#</th>
								<th class="px-4 py-3 font-semibold text-slate-700">State</th>
								<th class="px-4 py-3 font-semibold text-slate-700">RERA Reg No</th>
								<th class="px-4 py-3 font-semibold text-slate-700">Name</th>
								<th class="px-4 py-3 font-semibold text-slate-700">Type</th>
								<th class="px-4 py-3 font-semibold text-slate-700">Mobile</th>
								<th class="px-4 py-3 font-semibold text-slate-700">Email</th>
								<th class="px-4 py-3 font-semibold text-slate-700">Projects</th>
								<th class="px-4 py-3 font-semibold text-slate-700">Scraped</th>
								<th class="px-4 py-3 font-semibold text-slate-700 w-8"></th>
							</tr>
						</thead>
						<tbody class="divide-y divide-slate-50">
							{#if browseLoading}
								{#each Array(5) as _}
									<tr class="animate-pulse">
										{#each Array(10) as _}<td class="px-4 py-3"><div class="h-3 w-3/4 rounded bg-slate-100"></div></td>{/each}
									</tr>
								{/each}
							{:else if browseData.length === 0}
								<tr><td colspan="10" class="px-4 py-12 text-center text-sm text-slate-400">No records found</td></tr>
							{:else}
								{#each browseData as row, i}
									<tr class="hover:bg-slate-50/80 transition-colors">
										<td class="px-4 py-2.5 text-slate-400">{(browsePage - 1) * browsePageSize + i + 1}</td>
										<td class="px-4 py-2.5"><span class="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">{row.state}</span></td>
										<td class="px-4 py-2.5 font-mono text-slate-700">{row.reraRegNo || '—'}</td>
										<td class="px-4 py-2.5 text-slate-900 max-w-[200px] truncate" title={row.name}>{row.name || '—'}</td>
										<td class="px-4 py-2.5 text-slate-600">{row.legalType || '—'}</td>
										<td class="px-4 py-2.5 text-slate-600">{row.mobile || '—'}</td>
										<td class="px-4 py-2.5 text-slate-600 max-w-[150px] truncate" title={row.email}>{row.email || '—'}</td>
										<td class="px-4 py-2.5 text-center">
											{#if row._count?.projectLinks > 0}
												<span class="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-600">{row._count.projectLinks}</span>
											{:else}
												<span class="text-slate-400">0</span>
											{/if}
										</td>
										<td class="px-4 py-2.5 text-slate-400">{formatDate(row.scrapedAt)}</td>
										<td class="px-4 py-2.5">
											<button on:click={() => showDetail(row)} class="text-indigo-600 hover:text-indigo-800">
												<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
											</button>
										</td>
									</tr>
								{/each}
							{/if}
						</tbody>
					</table>
				{:else if activeModel === 'project'}
					<table class="w-full text-left text-xs">
						<thead class="border-b border-slate-100 bg-slate-50/50">
							<tr>
								<th class="px-4 py-3 font-semibold text-slate-700 w-8">#</th>
								<th class="px-4 py-3 font-semibold text-slate-700">State</th>
								<th class="px-4 py-3 font-semibold text-slate-700">RERA Reg No</th>
								<th class="px-4 py-3 font-semibold text-slate-700">Project Name</th>
								<th class="px-4 py-3 font-semibold text-slate-700">District</th>
								<th class="px-4 py-3 font-semibold text-slate-700">Type</th>
								<th class="px-4 py-3 font-semibold text-slate-700">Status</th>
								<th class="px-4 py-3 font-semibold text-slate-700">Valid Until</th>
								<th class="px-4 py-3 font-semibold text-slate-700">Companies</th>
								<th class="px-4 py-3 font-semibold text-slate-700">Scraped</th>
								<th class="px-4 py-3 font-semibold text-slate-700 w-8"></th>
							</tr>
						</thead>
						<tbody class="divide-y divide-slate-50">
							{#if browseLoading}
								{#each Array(5) as _}
									<tr class="animate-pulse">
										{#each Array(11) as _}<td class="px-4 py-3"><div class="h-3 w-3/4 rounded bg-slate-100"></div></td>{/each}
									</tr>
								{/each}
							{:else if browseData.length === 0}
								<tr><td colspan="11" class="px-4 py-12 text-center text-sm text-slate-400">No records found</td></tr>
							{:else}
								{#each browseData as row, i}
									<tr class="hover:bg-slate-50/80 transition-colors">
										<td class="px-4 py-2.5 text-slate-400">{(browsePage - 1) * browsePageSize + i + 1}</td>
										<td class="px-4 py-2.5"><span class="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">{row.state}</span></td>
										<td class="px-4 py-2.5 font-mono text-slate-700">{row.reraRegNo || '—'}</td>
										<td class="px-4 py-2.5 text-slate-900 max-w-[250px] truncate" title={row.name}>{row.name || '—'}</td>
										<td class="px-4 py-2.5 text-slate-600">{row.district || '—'}</td>
										<td class="px-4 py-2.5 text-slate-600">{row.projectType || '—'}</td>
										<td class="px-4 py-2.5">
											{#if row.constructionStatus}
												<span class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium
													{row.constructionStatus.toLowerCase().includes('complet') ? 'bg-emerald-50 text-emerald-700' :
													 row.constructionStatus.toLowerCase().includes('going') || row.constructionStatus.toLowerCase().includes('progress') ? 'bg-amber-50 text-amber-700' :
													 'bg-slate-100 text-slate-700'}">
													{row.constructionStatus}
												</span>
											{:else}
												<span class="text-slate-400">—</span>
											{/if}
										</td>
										<td class="px-4 py-2.5 text-slate-600">{row.validUntil || '—'}</td>
										<td class="px-4 py-2.5 text-center">
											{#if row._count?.companyLinks > 0}
												<span class="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-600">{row._count.companyLinks}</span>
											{:else}
												<span class="text-slate-400">0</span>
											{/if}
										</td>
										<td class="px-4 py-2.5 text-slate-400">{formatDate(row.scrapedAt)}</td>
										<td class="px-4 py-2.5">
											<button on:click={() => showDetail(row)} class="text-indigo-600 hover:text-indigo-800">
												<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
											</button>
										</td>
									</tr>
								{/each}
							{/if}
						</tbody>
					</table>
				{:else if activeModel === 'scrapeLog'}
					<table class="w-full text-left text-xs">
						<thead class="border-b border-slate-100 bg-slate-50/50">
							<tr>
								<th class="px-4 py-3 font-semibold text-slate-700 w-8">#</th>
								<th class="px-4 py-3 font-semibold text-slate-700">Source</th>
								<th class="px-4 py-3 font-semibold text-slate-700">State</th>
								<th class="px-4 py-3 font-semibold text-slate-700">Status</th>
								<th class="px-4 py-3 font-semibold text-slate-700 text-right">Items</th>
								<th class="px-4 py-3 font-semibold text-slate-700 text-right">Duration</th>
								<th class="px-4 py-3 font-semibold text-slate-700">Started</th>
								<th class="px-4 py-3 font-semibold text-slate-700">Finished</th>
								<th class="px-4 py-3 font-semibold text-slate-700">Error</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-slate-50">
							{#if browseLoading}
								{#each Array(5) as _}
									<tr class="animate-pulse">
										{#each Array(9) as _}<td class="px-4 py-3"><div class="h-3 w-3/4 rounded bg-slate-100"></div></td>{/each}
									</tr>
								{/each}
							{:else if browseData.length === 0}
								<tr><td colspan="9" class="px-4 py-12 text-center text-sm text-slate-400">No scrape logs</td></tr>
							{:else}
								{#each browseData as row, i}
									<tr class="hover:bg-slate-50/80 transition-colors">
										<td class="px-4 py-2.5 text-slate-400">{(browsePage - 1) * browsePageSize + i + 1}</td>
										<td class="px-4 py-2.5 font-mono text-slate-700">{row.source}</td>
										<td class="px-4 py-2.5"><span class="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">{row.state}</span></td>
										<td class="px-4 py-2.5">
											<span class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium
												{row.status === 'success' ? 'bg-emerald-50 text-emerald-700' :
												 row.status === 'running' ? 'bg-blue-50 text-blue-700' :
												 'bg-red-50 text-red-700'}">
												{row.status}
											</span>
										</td>
										<td class="px-4 py-2.5 text-right tabular-nums text-slate-700">{row.totalItems?.toLocaleString() || '—'}</td>
										<td class="px-4 py-2.5 text-right tabular-nums text-slate-500">{formatDuration(row.duration)}</td>
										<td class="px-4 py-2.5 text-slate-500">{formatDate(row.startedAt)}</td>
										<td class="px-4 py-2.5 text-slate-500">{formatDate(row.finishedAt)}</td>
										<td class="px-4 py-2.5 text-red-600 max-w-[200px] truncate" title={row.error || ''}>{row.error || '—'}</td>
									</tr>
								{/each}
							{/if}
						</tbody>
					</table>
				{/if}
			</div>

			<!-- Pagination -->
			{#if browseTotal > 0}
				<div class="border-t border-slate-100 bg-slate-50/50 px-6 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<p class="text-xs text-slate-500">
						Showing <span class="font-semibold text-slate-700">{(browsePage - 1) * browsePageSize + 1}</span>
						to <span class="font-semibold text-slate-700">{Math.min(browsePage * browsePageSize, browseTotal)}</span>
						of <span class="font-semibold text-slate-700">{browseTotal.toLocaleString()}</span>
					</p>
					{#if totalBrowsePages > 1}
						<nav class="flex items-center gap-1">
							<button
								on:click={() => goToPage(browsePage - 1)}
								disabled={browsePage === 1}
								class="inline-flex h-7 w-7 items-center justify-center rounded-md text-xs text-slate-600 hover:bg-slate-200 disabled:opacity-40"
							>
								<svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" /></svg>
							</button>
							{#each browsePageRange as pg}
								<button
									on:click={() => goToPage(pg)}
									class="inline-flex h-7 w-7 items-center justify-center rounded-md text-xs font-medium
										{pg === browsePage ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-200'}"
								>
									{pg}
								</button>
							{/each}
							<button
								on:click={() => goToPage(browsePage + 1)}
								disabled={browsePage === totalBrowsePages}
								class="inline-flex h-7 w-7 items-center justify-center rounded-md text-xs text-slate-600 hover:bg-slate-200 disabled:opacity-40"
							>
								<svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
							</button>
						</nav>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</div>

<!-- ═══════════════════════════════════════════════════════════ -->
<!-- Detail Modal                                               -->
<!-- ═══════════════════════════════════════════════════════════ -->
{#if detailRecord}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
		on:click={closeDetail}
		transition:fade={{ duration: 150 }}
	>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="relative max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-2xl"
			on:click|stopPropagation
		>
			<!-- Modal header -->
			<div class="flex items-center justify-between border-b border-slate-100 px-6 py-4">
				<div>
					<h3 class="text-base font-semibold text-slate-900">
						{detailRecord.name || detailRecord.source || 'Record Detail'}
					</h3>
					<p class="text-xs text-slate-500">
						{detailEntityType || activeModel} &middot; {detailRecord.id}
					</p>
				</div>
				<button on:click={closeDetail} class="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
					<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
				</button>
			</div>

			<!-- Modal body -->
			<div class="overflow-y-auto max-h-[calc(90vh-80px)]">
				<!-- Basic fields grid -->
				<div class="px-6 py-4 grid grid-cols-2 gap-x-6 gap-y-2.5 border-b border-slate-100">
					{#each Object.entries(detailEntity ?? detailRecord) as [key, value]}
						{#if key !== '_count' && key !== 'id' && typeof value !== 'object' && value !== null && value !== undefined}
							<div class="py-1">
								<dt class="text-[11px] font-medium text-slate-400 uppercase tracking-wider">{key}</dt>
								<dd class="text-sm text-slate-800 break-all">
									{#if typeof value === 'string' && value.startsWith('http')}
										<a href={value} target="_blank" rel="noopener noreferrer" class="text-indigo-600 hover:text-indigo-800 underline">{value}</a>
									{:else}
										{value}
									{/if}
								</dd>
							</div>
						{/if}
					{/each}
				</div>

				<!-- Relations: Projects (for company/agent) -->
				{#if detailLoading}
					<div class="px-6 py-6">
						<div class="animate-pulse space-y-3">
							<div class="h-4 w-40 rounded bg-slate-100"></div>
							<div class="h-16 rounded bg-slate-50"></div>
							<div class="h-16 rounded bg-slate-50"></div>
						</div>
					</div>
				{:else if detailEntity && (detailEntityType === 'company' || detailEntityType === 'agent')}
					{@const projectLinks = detailEntity.projectLinks || []}
					<div class="px-6 py-4">
						<h4 class="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
							<svg class="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
							Linked Projects
							<span class="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-600">{projectLinks.length}</span>
						</h4>
						{#if projectLinks.length === 0}
							<p class="text-sm text-slate-400 py-4 text-center">No linked projects</p>
						{:else}
							<div class="space-y-2 max-h-[400px] overflow-y-auto">
								{#each projectLinks as pl, i}
									{@const proj = pl.project}
									<div class="rounded-lg border border-slate-100 p-3 hover:bg-slate-50/80 transition-colors">
										<div class="flex items-start justify-between gap-3">
											<div class="min-w-0 flex-1">
												<div class="flex items-center gap-2">
													<span class="text-xs text-slate-400 font-medium w-5">{i + 1}.</span>
													<p class="text-sm font-medium text-slate-900 truncate" title={proj.name}>{proj.name || 'Unnamed'}</p>
												</div>
												<div class="mt-1 ml-7 flex flex-wrap items-center gap-2">
													<span class="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-600">{proj.reraRegNo}</span>
													{#if proj.district}
														<span class="text-[11px] text-slate-500">{proj.district}</span>
													{/if}
													{#if proj.projectType}
														<span class="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-600">{proj.projectType}</span>
													{/if}
													{#if pl.role && pl.role !== 'promoter'}
														<span class="inline-flex items-center rounded-full bg-purple-50 px-2 py-0.5 text-[10px] font-medium text-purple-600">{pl.role}</span>
													{/if}
												</div>
												{#if proj.location}
													<p class="mt-1 ml-7 text-[11px] text-slate-400 truncate">{proj.location}</p>
												{/if}
											</div>
											<div class="flex flex-col items-end gap-1 flex-shrink-0">
												{#if proj.constructionStatus}
													<span class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium
														{proj.constructionStatus.toLowerCase().includes('complet') ? 'bg-emerald-50 text-emerald-700' :
														 proj.constructionStatus.toLowerCase().includes('going') || proj.constructionStatus.toLowerCase().includes('progress') ? 'bg-amber-50 text-amber-700' :
														 'bg-slate-100 text-slate-700'}">
														{proj.constructionStatus}
													</span>
												{/if}
												{#if proj.validUntil}
													<span class="text-[10px] text-slate-400">Until {proj.validUntil}</span>
												{/if}
												<button type="button" on:click={() => showEntity('project', proj)} class="inline-flex items-center gap-1 text-[10px] font-medium text-indigo-600 hover:text-indigo-800">
													<svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 3h7v7m0-7L10 14m-4 7h8a2 2 0 002-2v-6M8 3H6a2 2 0 00-2 2v8" /></svg>
													Open
												</button>
												{#if proj.certificateUrl}
													<a href={proj.certificateUrl} target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-[10px] font-medium text-indigo-600 hover:text-indigo-800">
														<svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
														PDF
													</a>
												{/if}
											</div>
										</div>
									</div>
								{/each}
							</div>
						{/if}
					</div>

				<!-- Relations: Companies & Agents (for project) -->
				{:else if detailEntity && detailEntityType === 'project'}
					<div class="px-6 py-4 space-y-4">
						<!-- Companies -->
						{#if (detailEntity.companyLinks || []).length > 0}
							<div>
								<h4 class="text-sm font-semibold text-slate-900 mb-2 flex items-center gap-2">
									<svg class="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5" /></svg>
									Promoters / Builders
									<span class="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-600">{detailEntity.companyLinks.length}</span>
								</h4>
								{#each detailEntity.companyLinks as cl}
									{@const comp = cl.company}
									<div class="rounded-lg border border-slate-100 p-3 mb-2">
										<div class="flex items-start justify-between gap-3">
											<div>
												<p class="text-sm font-medium text-slate-900">{comp.name}</p>
												<div class="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
													{#if comp.reraRegNo}<span class="font-mono bg-slate-50 rounded px-1">{comp.reraRegNo}</span>{/if}
													{#if comp.legalType}<span>{comp.legalType}</span>{/if}
													{#if cl.role}<span class="text-indigo-600 font-medium">{cl.role}</span>{/if}
												</div>
												{#if comp.mobile || comp.email}
													<p class="mt-1 text-[11px] text-slate-400">
														{comp.mobile || ''}{comp.mobile && comp.email ? ' | ' : ''}{comp.email || ''}
													</p>
												{/if}
												{#if comp.address}
													<p class="mt-1 text-[11px] text-slate-400 truncate max-w-md">{comp.address}</p>
												{/if}
											</div>
											<button type="button" on:click={() => showEntity('company', comp)} class="shrink-0 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-indigo-600 hover:bg-indigo-50">
												Open
											</button>
										</div>
									</div>
								{/each}
							</div>
						{/if}

						<!-- Agents -->
						{#if (detailEntity.agentLinks || []).length > 0}
							<div>
								<h4 class="text-sm font-semibold text-slate-900 mb-2 flex items-center gap-2">
									<svg class="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
									Agents
									<span class="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-600">{detailEntity.agentLinks.length}</span>
								</h4>
								{#each detailEntity.agentLinks as al}
									{@const agent = al.agent}
									<div class="rounded-lg border border-slate-100 p-3 mb-2">
										<div class="flex items-start justify-between gap-3">
											<p class="text-sm font-medium text-slate-900">{agent.name}</p>
											<button type="button" on:click={() => showEntity('agent', agent)} class="shrink-0 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-indigo-600 hover:bg-indigo-50">
												Open
											</button>
										</div>
										<div class="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
											{#if agent.reraRegNo}<span class="font-mono bg-slate-50 rounded px-1">{agent.reraRegNo}</span>{/if}
											{#if agent.firmType}<span>{agent.firmType}</span>{/if}
											{#if agent.district}<span>{agent.district}</span>{/if}
										</div>
										{#if agent.mobile || agent.email}
											<p class="mt-1 text-[11px] text-slate-400">{agent.mobile || ''}{agent.mobile && agent.email ? ' | ' : ''}{agent.email || ''}</p>
										{/if}
									</div>
								{/each}
							</div>
						{/if}

						<!-- Bank tieups -->
						{#if (detailEntity.bankTieups || []).length > 0}
							<div>
								<h4 class="text-sm font-semibold text-slate-900 mb-2">Bank Tieups ({detailEntity.bankTieups.length})</h4>
								<div class="overflow-x-auto">
									<table class="w-full text-xs">
										<thead><tr class="border-b border-slate-100">
											<th class="px-3 py-2 text-left font-medium text-slate-500">Bank</th>
											<th class="px-3 py-2 text-right font-medium text-slate-500">Rate</th>
											<th class="px-3 py-2 text-right font-medium text-slate-500">Max Loan</th>
											<th class="px-3 py-2 text-left font-medium text-slate-500">Remarks</th>
										</tr></thead>
										<tbody>
											{#each detailEntity.bankTieups as bt}
												<tr class="border-b border-slate-50">
													<td class="px-3 py-2 text-slate-800">{bt.bankName}</td>
													<td class="px-3 py-2 text-right text-slate-600">{bt.interestRate || '—'}</td>
													<td class="px-3 py-2 text-right text-slate-600">{bt.maxLoanPct ? bt.maxLoanPct + '%' : '—'}</td>
													<td class="px-3 py-2 text-slate-500">{bt.remarks || '—'}</td>
												</tr>
											{/each}
										</tbody>
									</table>
								</div>
							</div>
						{/if}
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}
