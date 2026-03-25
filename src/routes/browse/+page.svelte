<script>
	import { onMount } from 'svelte';
	import { fade, slide } from 'svelte/transition';

	// ── Filter state ──
	let states = [];
	let districts = [];
	let stateCounts = {};
	let selectedState = '';
	let selectedDistrict = '';
	let entityType = 'promoter'; // 'promoter' | 'agent'
	let searchTerm = '';

	// ── Entities (companies / agents) ──
	let entities = [];
	let entityTotal = 0;
	let entityPage = 1;
	let entityPageSize = 20;
	let entityLoading = false;

	// ── Selected entity & projects ──
	let selectedEntity = null;
	let projects = [];
	let projectTotal = 0;
	let projectPage = 1;
	let projectPageSize = 20;
	let projectLoading = false;

	// ── Detail panel ──
	let entityDetail = null;
	let detailLoading = false;

	// ── Init loading ──
	let filtersLoading = true;

	// ── Computed ──
	$: totalEntityPages = Math.max(1, Math.ceil(entityTotal / entityPageSize));
	$: totalProjectPages = Math.max(1, Math.ceil(projectTotal / projectPageSize));
	$: currentStateCounts = stateCounts[selectedState] || null;

	$: entityPageRange = pageRange(entityPage, totalEntityPages);
	$: projectPageRange = pageRange(projectPage, totalProjectPages);

	function pageRange(current, total) {
		const range = [];
		const max = 5;
		let start = Math.max(1, current - Math.floor(max / 2));
		let end = Math.min(total, start + max - 1);
		if (end - start + 1 < max) start = Math.max(1, end - max + 1);
		for (let i = start; i <= end; i++) range.push(i);
		return range;
	}

	// ── API helpers ──
	async function fetchFilters() {
		filtersLoading = true;
		const params = new URLSearchParams({ action: 'filters' });
		if (selectedState) params.set('state', selectedState);
		const res = await fetch(`/api/browse?${params}`);
		const result = await res.json();
		if (result.success) {
			states = result.states;
			districts = result.districts || [];
			stateCounts = result.stateCounts || {};
		}
		filtersLoading = false;
	}

	async function fetchEntities() {
		entityLoading = true;
		selectedEntity = null;
		projects = [];
		projectTotal = 0;
		const params = new URLSearchParams({
			action: 'entities',
			type: entityType,
			page: String(entityPage),
			take: String(entityPageSize)
		});
		if (selectedState) params.set('state', selectedState);
		if (selectedDistrict) params.set('district', selectedDistrict);
		if (searchTerm) params.set('search', searchTerm);

		const res = await fetch(`/api/browse?${params}`);
		const result = await res.json();
		if (result.success) {
			entities = result.data;
			entityTotal = result.total;
		}
		entityLoading = false;
	}

	async function fetchProjects(entity) {
		selectedEntity = entity;
		projectLoading = true;
		projectPage = 1;
		const params = new URLSearchParams({
			action: 'projects',
			type: entityType,
			entityId: entity.id,
			page: '1',
			take: String(projectPageSize)
		});
		if (selectedState) params.set('state', selectedState);

		const res = await fetch(`/api/browse?${params}`);
		const result = await res.json();
		if (result.success) {
			projects = result.data;
			projectTotal = result.total;
		}
		projectLoading = false;
	}

	async function fetchProjectPage(pg) {
		if (!selectedEntity) return;
		projectPage = pg;
		projectLoading = true;
		const params = new URLSearchParams({
			action: 'projects',
			type: entityType,
			entityId: selectedEntity.id,
			page: String(pg),
			take: String(projectPageSize)
		});
		if (selectedState) params.set('state', selectedState);

		const res = await fetch(`/api/browse?${params}`);
		const result = await res.json();
		if (result.success) {
			projects = result.data;
			projectTotal = result.total;
		}
		projectLoading = false;
	}

	async function fetchEntityDetail(entity) {
		detailLoading = true;
		const params = new URLSearchParams({
			action: 'entity-detail',
			type: entityType,
			entityId: entity.id
		});
		const res = await fetch(`/api/browse?${params}`);
		const result = await res.json();
		if (result.success) entityDetail = result.entity;
		detailLoading = false;
	}

	// ── Handlers ──
	function onStateChange() {
		selectedDistrict = '';
		entityPage = 1;
		selectedEntity = null;
		projects = [];
		fetchFilters().then(fetchEntities);
	}

	function onDistrictChange() {
		entityPage = 1;
		selectedEntity = null;
		projects = [];
		fetchEntities();
	}

	function onTypeChange(type) {
		entityType = type;
		entityPage = 1;
		selectedEntity = null;
		projects = [];
		fetchEntities();
	}

	let searchTimeout;
	function onSearchInput() {
		clearTimeout(searchTimeout);
		searchTimeout = setTimeout(() => {
			entityPage = 1;
			fetchEntities();
		}, 350);
	}

	function onEntityPageChange(pg) {
		entityPage = Math.max(1, Math.min(pg, totalEntityPages));
		fetchEntities();
	}

	function selectEntity(entity) {
		fetchProjects(entity);
		fetchEntityDetail(entity);
	}

	function clearSelection() {
		selectedEntity = null;
		entityDetail = null;
		projects = [];
		projectTotal = 0;
	}

	function clearAllFilters() {
		selectedState = '';
		selectedDistrict = '';
		searchTerm = '';
		entityPage = 1;
		selectedEntity = null;
		projects = [];
		fetchFilters().then(fetchEntities);
	}

	onMount(() => {
		fetchFilters().then(fetchEntities);
	});
</script>

<svelte:head>
	<title>Browse RERA Data — RERA Toolkit</title>
</svelte:head>

<div class="mx-auto max-w-7xl p-4 sm:p-6">
	<!-- Header -->
	<div class="mb-6">
		<h1 class="text-2xl font-bold tracking-tight text-slate-900">Browse RERA Data</h1>
		<p class="mt-1 text-sm text-slate-500">Filter by state, city, and entity type to explore builders, agents, and their projects</p>
	</div>

	<!-- ════════════════════════════════════════════════════ -->
	<!-- FILTER BAR                                          -->
	<!-- ════════════════════════════════════════════════════ -->
	<div class="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
		<div class="flex flex-wrap items-end gap-4">
			<!-- State -->
			<div class="min-w-[160px]">
				<label for="state-select" class="block text-xs font-medium text-slate-600 mb-1.5">State</label>
				<select
					id="state-select"
					bind:value={selectedState}
					on:change={onStateChange}
					class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
				>
					<option value="">All States</option>
					{#each states as s}
						<option value={s}>
							{s}
							{#if stateCounts[s]}
								({entityType === 'agent'
									? stateCounts[s].agents.toLocaleString() + ' agents'
									: stateCounts[s].companies.toLocaleString() + ' companies'})
							{/if}
						</option>
					{/each}
				</select>
			</div>

			<!-- District -->
			<div class="min-w-[180px]">
				<label for="district-select" class="block text-xs font-medium text-slate-600 mb-1.5">District / City</label>
				<select
					id="district-select"
					bind:value={selectedDistrict}
					on:change={onDistrictChange}
					disabled={!selectedState || districts.length === 0}
					class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:bg-slate-50 disabled:text-slate-400"
				>
					<option value="">{districts.length === 0 && selectedState ? 'No districts' : 'All Districts'}</option>
					{#each districts as d}
						<option value={d}>{d}</option>
					{/each}
				</select>
			</div>

			<!-- Entity Type Toggle -->
			<div>
				<label class="block text-xs font-medium text-slate-600 mb-1.5">Type</label>
				<div class="flex rounded-lg bg-slate-100 p-0.5">
					<button
						on:click={() => onTypeChange('promoter')}
						class="rounded-md px-4 py-1.5 text-sm font-medium transition-all
							{entityType === 'promoter'
								? 'bg-white text-slate-900 shadow-sm'
								: 'text-slate-600 hover:text-slate-900'}"
					>
						<span class="flex items-center gap-1.5">
							<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
							Builder / Promoter
						</span>
					</button>
					<button
						on:click={() => onTypeChange('agent')}
						class="rounded-md px-4 py-1.5 text-sm font-medium transition-all
							{entityType === 'agent'
								? 'bg-white text-slate-900 shadow-sm'
								: 'text-slate-600 hover:text-slate-900'}"
					>
						<span class="flex items-center gap-1.5">
							<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
							Agent
						</span>
					</button>
				</div>
			</div>

			<!-- Search -->
			<div class="flex-1 min-w-[200px]">
				<label for="search-input" class="block text-xs font-medium text-slate-600 mb-1.5">Search</label>
				<div class="relative">
					<div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
						<svg class="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
					</div>
					<input
						id="search-input"
						type="text"
						bind:value={searchTerm}
						on:input={onSearchInput}
						placeholder="Name, RERA number, phone..."
						class="block w-full rounded-lg border border-slate-200 bg-white py-2 pl-10 pr-3 text-sm placeholder-slate-400 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
					/>
				</div>
			</div>

			<!-- Clear -->
			{#if selectedState || selectedDistrict || searchTerm}
				<button
					on:click={clearAllFilters}
					class="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
				>
					Clear all
				</button>
			{/if}
		</div>

		<!-- Active filter badges -->
		{#if selectedState || selectedDistrict}
			<div class="flex flex-wrap items-center gap-2">
				<span class="text-xs text-slate-500">Filters:</span>
				{#if selectedState}
					<span class="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
						{selectedState}
						<button on:click={() => { selectedState = ''; onStateChange(); }} class="ml-0.5 hover:text-indigo-900">&times;</button>
					</span>
				{/if}
				{#if selectedDistrict}
					<span class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
						{selectedDistrict}
						<button on:click={() => { selectedDistrict = ''; onDistrictChange(); }} class="ml-0.5 hover:text-emerald-900">&times;</button>
					</span>
				{/if}
				{#if currentStateCounts}
					<span class="text-xs text-slate-400 ml-2">
						{currentStateCounts.agents.toLocaleString()} agents,
						{currentStateCounts.companies.toLocaleString()} companies,
						{currentStateCounts.projects.toLocaleString()} projects
					</span>
				{/if}
			</div>
		{/if}
	</div>

	<!-- ════════════════════════════════════════════════════ -->
	<!-- MAIN CONTENT: Entities list + Projects panel        -->
	<!-- ════════════════════════════════════════════════════ -->
	<div class="grid grid-cols-1 gap-6 {selectedEntity ? 'lg:grid-cols-5' : ''}">
		<!-- LEFT: Entity list -->
		<div class="{selectedEntity ? 'lg:col-span-2' : ''}">
			<div class="rounded-xl border border-slate-200 bg-white shadow-sm">
				<!-- Header -->
				<div class="border-b border-slate-100 px-5 py-3.5 flex items-center justify-between">
					<div>
						<h2 class="text-sm font-semibold text-slate-900">
							{entityType === 'promoter' ? 'Builders & Promoters' : 'Agents'}
						</h2>
						<p class="text-xs text-slate-500 mt-0.5">
							{entityTotal.toLocaleString()} results
							{#if selectedState}in {selectedState}{/if}
							{#if selectedDistrict}, {selectedDistrict}{/if}
						</p>
					</div>
				</div>

				<!-- Entity rows -->
				<div class="divide-y divide-slate-50 max-h-[600px] overflow-y-auto">
					{#if entityLoading}
						{#each Array(6) as _}
							<div class="animate-pulse px-5 py-4">
								<div class="h-4 w-2/3 rounded bg-slate-100"></div>
								<div class="mt-2 h-3 w-1/3 rounded bg-slate-50"></div>
							</div>
						{/each}
					{:else if entities.length === 0}
						<div class="px-5 py-12 text-center">
							<svg class="mx-auto h-10 w-10 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
							<p class="mt-3 text-sm text-slate-500">No {entityType === 'promoter' ? 'builders/promoters' : 'agents'} found</p>
							{#if searchTerm}
								<button on:click={() => { searchTerm = ''; fetchEntities(); }} class="mt-2 text-xs font-medium text-indigo-600 hover:text-indigo-800">Clear search</button>
							{/if}
						</div>
					{:else}
						{#each entities as entity (entity.id)}
							<button
								class="w-full text-left px-5 py-3.5 transition-colors hover:bg-slate-50 {selectedEntity?.id === entity.id ? 'bg-indigo-50 border-l-2 border-l-indigo-500' : ''}"
								on:click={() => selectEntity(entity)}
							>
								<div class="flex items-start justify-between gap-3">
									<div class="min-w-0 flex-1">
										<p class="text-sm font-medium text-slate-900 truncate" title={entity.name}>
											{entity.name || 'Unnamed'}
										</p>
										<div class="mt-1 flex flex-wrap items-center gap-2">
											{#if entity.reraRegNo}
												<span class="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-600">{entity.reraRegNo}</span>
											{/if}
											{#if entity.state}
												<span class="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-600">{entity.state}</span>
											{/if}
											{#if entity.district}
												<span class="text-[11px] text-slate-500">{entity.district}</span>
											{/if}
										</div>
										{#if entity.mobile || entity.email}
											<p class="mt-1 text-[11px] text-slate-400 truncate">
												{entity.mobile || ''}{entity.mobile && entity.email ? ' | ' : ''}{entity.email || ''}
											</p>
										{/if}
									</div>
									<div class="flex flex-col items-end gap-1 flex-shrink-0">
										{#if entity._count?.projectLinks > 0}
											<span class="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
												{entity._count.projectLinks} projects
											</span>
										{/if}
										{#if entityType === 'agent' && entity.status}
											<span class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium {entity.status === 'Approved' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}">
												{entity.status}
											</span>
										{/if}
										{#if entityType === 'promoter' && entity.legalType}
											<span class="text-[10px] text-slate-400">{entity.legalType}</span>
										{/if}
									</div>
								</div>
							</button>
						{/each}
					{/if}
				</div>

				<!-- Pagination -->
				{#if entityTotal > entityPageSize}
					<div class="border-t border-slate-100 bg-slate-50/50 px-5 py-2.5 flex items-center justify-between">
						<p class="text-[11px] text-slate-500">
							{(entityPage - 1) * entityPageSize + 1}–{Math.min(entityPage * entityPageSize, entityTotal)} of {entityTotal.toLocaleString()}
						</p>
						<nav class="flex items-center gap-0.5">
							<button on:click={() => onEntityPageChange(entityPage - 1)} disabled={entityPage === 1} class="h-6 w-6 rounded flex items-center justify-center text-slate-500 hover:bg-slate-200 disabled:opacity-40">
								<svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" /></svg>
							</button>
							{#each entityPageRange as pg}
								<button on:click={() => onEntityPageChange(pg)} class="h-6 w-6 rounded flex items-center justify-center text-[11px] font-medium {pg === entityPage ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-200'}">
									{pg}
								</button>
							{/each}
							<button on:click={() => onEntityPageChange(entityPage + 1)} disabled={entityPage === totalEntityPages} class="h-6 w-6 rounded flex items-center justify-center text-slate-500 hover:bg-slate-200 disabled:opacity-40">
								<svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
							</button>
						</nav>
					</div>
				{/if}
			</div>
		</div>

		<!-- RIGHT: Entity detail + Projects panel -->
		{#if selectedEntity}
			<div class="lg:col-span-3 space-y-5" transition:fade={{ duration: 150 }}>
				<!-- Entity detail card -->
				<div class="rounded-xl border border-slate-200 bg-white shadow-sm">
					<div class="border-b border-slate-100 px-5 py-3.5 flex items-center justify-between">
						<div>
							<h3 class="text-sm font-semibold text-slate-900 truncate max-w-md" title={selectedEntity.name}>
								{selectedEntity.name}
							</h3>
							<p class="text-xs text-slate-500 mt-0.5">
								{entityType === 'promoter' ? 'Builder / Promoter' : 'Agent'} &middot; {selectedEntity.state}
								{#if selectedEntity.district}&middot; {selectedEntity.district}{/if}
							</p>
						</div>
						<button on:click={clearSelection} class="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
							<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
						</button>
					</div>

					{#if detailLoading}
						<div class="p-5 animate-pulse space-y-3">
							<div class="h-3 w-1/2 rounded bg-slate-100"></div>
							<div class="h-3 w-2/3 rounded bg-slate-100"></div>
							<div class="h-3 w-1/3 rounded bg-slate-100"></div>
						</div>
					{:else if entityDetail}
						<div class="p-5 grid grid-cols-2 gap-x-6 gap-y-3">
							{#if entityDetail.reraRegNo}
								<div><dt class="text-[11px] font-medium text-slate-400">RERA Reg No</dt><dd class="text-sm text-slate-800 font-mono">{entityDetail.reraRegNo}</dd></div>
							{/if}
							{#if entityDetail.legalType || entityDetail.firmType}
								<div><dt class="text-[11px] font-medium text-slate-400">Type</dt><dd class="text-sm text-slate-800">{entityDetail.legalType || entityDetail.firmType}</dd></div>
							{/if}
							{#if entityDetail.mobile}
								<div><dt class="text-[11px] font-medium text-slate-400">Mobile</dt><dd class="text-sm text-slate-800"><a href="tel:{entityDetail.mobile}" class="text-indigo-600 hover:underline">{entityDetail.mobile}</a></dd></div>
							{/if}
							{#if entityDetail.email}
								<div><dt class="text-[11px] font-medium text-slate-400">Email</dt><dd class="text-sm text-slate-800 truncate"><a href="mailto:{entityDetail.email}" class="text-indigo-600 hover:underline">{entityDetail.email}</a></dd></div>
							{/if}
							{#if entityDetail.address}
								<div class="col-span-2"><dt class="text-[11px] font-medium text-slate-400">Address</dt><dd class="text-sm text-slate-700">{entityDetail.address}</dd></div>
							{/if}
							{#if entityDetail.website}
								<div><dt class="text-[11px] font-medium text-slate-400">Website</dt><dd class="text-sm"><a href={entityDetail.website.startsWith('http') ? entityDetail.website : 'https://' + entityDetail.website} target="_blank" rel="noopener noreferrer" class="text-indigo-600 hover:underline">{entityDetail.website}</a></dd></div>
							{/if}
							{#if entityDetail.contactPerson}
								<div><dt class="text-[11px] font-medium text-slate-400">Contact Person</dt><dd class="text-sm text-slate-800">{entityDetail.contactPerson}</dd></div>
							{/if}
							{#if entityDetail.pan}
								<div><dt class="text-[11px] font-medium text-slate-400">PAN</dt><dd class="text-sm text-slate-800 font-mono">{entityDetail.pan}</dd></div>
							{/if}
							{#if entityDetail.validUpto}
								<div><dt class="text-[11px] font-medium text-slate-400">Valid Until</dt><dd class="text-sm text-slate-800">{entityDetail.validUpto}</dd></div>
							{/if}
							{#if entityDetail.status}
								<div><dt class="text-[11px] font-medium text-slate-400">Status</dt>
									<dd><span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium {entityDetail.status === 'Approved' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}">{entityDetail.status}</span></dd>
								</div>
							{/if}
							{#if entityDetail.certificateUrl}
								<div><dt class="text-[11px] font-medium text-slate-400">Certificate</dt>
									<dd><a href={entityDetail.certificateUrl} target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800">
										<svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
										Download PDF
									</a></dd>
								</div>
							{/if}
						</div>
					{/if}
				</div>

				<!-- Projects list -->
				<div class="rounded-xl border border-slate-200 bg-white shadow-sm">
					<div class="border-b border-slate-100 px-5 py-3.5">
						<h3 class="text-sm font-semibold text-slate-900">
							Projects
							{#if projectTotal > 0}
								<span class="ml-1.5 inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-600">{projectTotal}</span>
							{/if}
						</h3>
						<p class="text-xs text-slate-500 mt-0.5">
							{entityType === 'promoter' ? 'Projects by this builder/promoter' : 'Projects linked to this agent'}
						</p>
					</div>

					{#if projectLoading}
						<div class="p-5 space-y-3">
							{#each Array(3) as _}
								<div class="animate-pulse rounded-lg border border-slate-100 p-4">
									<div class="h-4 w-2/3 rounded bg-slate-100"></div>
									<div class="mt-2 h-3 w-1/3 rounded bg-slate-50"></div>
								</div>
							{/each}
						</div>
					{:else if projects.length === 0}
						<div class="px-5 py-10 text-center">
							<svg class="mx-auto h-8 w-8 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
							<p class="mt-2 text-sm text-slate-500">No linked projects found</p>
							<p class="text-xs text-slate-400 mt-1">Projects are linked during scraping via the registration number</p>
						</div>
					{:else}
						<div class="divide-y divide-slate-50">
							{#each projects as project (project.id)}
								<div class="px-5 py-4 hover:bg-slate-50/80 transition-colors" transition:fade={{ duration: 100 }}>
									<div class="flex items-start justify-between gap-3">
										<div class="min-w-0 flex-1">
											<p class="text-sm font-medium text-slate-900">{project.name || 'Unnamed Project'}</p>
											<div class="mt-1 flex flex-wrap items-center gap-2">
												<span class="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-600">{project.reraRegNo}</span>
												{#if project.district}
													<span class="text-[11px] text-slate-500">{project.district}</span>
												{/if}
												{#if project.projectType}
													<span class="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-600">{project.projectType}</span>
												{/if}
											</div>
											{#if project.location}
												<p class="mt-1 text-[11px] text-slate-400 truncate">{project.location}</p>
											{/if}
										</div>
										<div class="flex flex-col items-end gap-1 flex-shrink-0">
											{#if project.constructionStatus}
												<span class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium
													{project.constructionStatus.toLowerCase().includes('complet') ? 'bg-emerald-50 text-emerald-700' :
													 project.constructionStatus.toLowerCase().includes('going') || project.constructionStatus.toLowerCase().includes('progress') ? 'bg-amber-50 text-amber-700' :
													 'bg-slate-100 text-slate-700'}">
													{project.constructionStatus}
												</span>
											{/if}
											{#if project.validUntil}
												<span class="text-[10px] text-slate-400">Until {project.validUntil}</span>
											{/if}
											{#if project.certificateUrl}
												<a href={project.certificateUrl} target="_blank" rel="noopener noreferrer" class="text-[10px] font-medium text-indigo-600 hover:text-indigo-800" on:click|stopPropagation>PDF</a>
											{/if}
										</div>
									</div>

									<!-- Linked entities -->
									{#if project.companyLinks?.length > 0 || project.agentLinks?.length > 0}
										<div class="mt-2 flex flex-wrap gap-1.5">
											{#each project.companyLinks || [] as cl}
												<span class="inline-flex items-center gap-1 rounded-full bg-slate-50 border border-slate-100 px-2 py-0.5 text-[10px] text-slate-600">
													<svg class="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16" /></svg>
													{cl.company.name}
													{#if cl.role !== 'promoter'}<span class="text-slate-400">({cl.role})</span>{/if}
												</span>
											{/each}
											{#each project.agentLinks || [] as al}
												<span class="inline-flex items-center gap-1 rounded-full bg-slate-50 border border-slate-100 px-2 py-0.5 text-[10px] text-slate-600">
													<svg class="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
													{al.agent.name}
												</span>
											{/each}
										</div>
									{/if}
								</div>
							{/each}
						</div>

						<!-- Project pagination -->
						{#if projectTotal > projectPageSize}
							<div class="border-t border-slate-100 bg-slate-50/50 px-5 py-2.5 flex items-center justify-between">
								<p class="text-[11px] text-slate-500">
									{(projectPage - 1) * projectPageSize + 1}–{Math.min(projectPage * projectPageSize, projectTotal)} of {projectTotal}
								</p>
								<nav class="flex items-center gap-0.5">
									<button on:click={() => fetchProjectPage(projectPage - 1)} disabled={projectPage === 1} class="h-6 w-6 rounded flex items-center justify-center text-slate-500 hover:bg-slate-200 disabled:opacity-40">
										<svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" /></svg>
									</button>
									{#each projectPageRange as pg}
										<button on:click={() => fetchProjectPage(pg)} class="h-6 w-6 rounded flex items-center justify-center text-[11px] font-medium {pg === projectPage ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-200'}">
											{pg}
										</button>
									{/each}
									<button on:click={() => fetchProjectPage(projectPage + 1)} disabled={projectPage === totalProjectPages} class="h-6 w-6 rounded flex items-center justify-center text-slate-500 hover:bg-slate-200 disabled:opacity-40">
										<svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
									</button>
								</nav>
							</div>
						{/if}
					{/if}
				</div>
			</div>
		{/if}
	</div>
</div>
