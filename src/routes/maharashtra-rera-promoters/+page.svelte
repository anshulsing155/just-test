<script>
	import { onMount } from 'svelte';
	import { fade, slide } from 'svelte/transition';

	let promoters = [];
	let projects = [];
	let districts = [];

	let loadingPromoters = false;
	let loadingProjects = false;

	let errorPromoters = '';
	let errorProjects = '';

	let selectedDistrict = '';
	let searchTerm = '';
	let activeTab = 'promoters'; // 'promoters' | 'projects'

	let scrapingAllProjects = false;
	let scrapeProjectMsg = '';
	let scrapingPromoters = false;
	let scrapePromoterMsg = '';
	let promoterScrapePhase = ''; // 'list' | 'all'

	let showPromoterModal = false;
	let promoterDetails = null;

	// Pagination
	let currentPage = 1;
	let pageSize = 20;

	$: filteredPromoters = promoters.filter((p) => {
		if (!searchTerm) return true;
		const s = searchTerm.toLowerCase();
		return (
			(p.name && p.name.toLowerCase().includes(s)) ||
			(p.reraRegNo && p.reraRegNo.toLowerCase().includes(s)) ||
			(p.mobile && p.mobile.toLowerCase().includes(s)) ||
			(p.address && p.address.toLowerCase().includes(s)) ||
			(p.legalType && p.legalType.toLowerCase().includes(s)) ||
			(p.email && p.email.toLowerCase().includes(s)) ||
			(p.district && p.district.toLowerCase().includes(s)) ||
			(p.area && p.area.toLowerCase().includes(s)) ||
			(p.pinCode && p.pinCode.includes(s))
		);
	});

	$: filteredProjects = projects.filter((p) => {
		if (!searchTerm) return true;
		const s = searchTerm.toLowerCase();
		return (
			(p.projectName && p.projectName.toLowerCase().includes(s)) ||
			(p.promoterName && p.promoterName.toLowerCase().includes(s)) ||
			(p.district && p.district.toLowerCase().includes(s)) ||
			(p.area && p.area.toLowerCase().includes(s)) ||
			(p.pinCode && p.pinCode.includes(s)) ||
			(p.name && p.name.toLowerCase().includes(s)) ||
			(p.reraRegNo && p.reraRegNo.toLowerCase().includes(s)) ||
			(p.registrationNo && p.registrationNo.toLowerCase().includes(s))
		);
	});

	$: currentData = activeTab === 'promoters' ? filteredPromoters : filteredProjects;
	$: totalPages = Math.max(1, Math.ceil(currentData.length / pageSize));
	$: if (currentPage > totalPages) currentPage = totalPages;
	$: paginatedData = currentData.slice((currentPage - 1) * pageSize, currentPage * pageSize);
	let lastResetKey = '';
	$: {
		const resetKey = `${activeTab}::${selectedDistrict}::${searchTerm}`;
		if (resetKey !== lastResetKey) {
			currentPage = 1;
			lastResetKey = resetKey;
		}
	}

	$: pageRange = (() => {
		const range = [];
		const maxVisible = 5;
		let start = Math.max(1, currentPage - Math.floor(maxVisible / 2));
		let end = Math.min(totalPages, start + maxVisible - 1);
		if (end - start + 1 < maxVisible) start = Math.max(1, end - maxVisible + 1);
		for (let i = start; i <= end; i++) range.push(i);
		return range;
	})();

	function getPromoterName(p) { return p.name || p.promoterName || 'N/A'; }
	function getPromoterType(p) { return p.legalType || p.applicantType || ''; }

	async function fetchPromoters() {
		loadingPromoters = true;
		errorPromoters = '';
		try {
			const res = await fetch('/api/maharashtra-rera-promoters');
			const result = await res.json();
			if (result.success) {
				promoters = result.data;
			} else {
				throw new Error(result.error);
			}
		} catch (e) {
			errorPromoters = e.message || 'Failed to fetch promoters';
		} finally {
			loadingPromoters = false;
		}
	}

	async function fetchDistricts() {
		try {
			const res = await fetch('/api/maharashtra-rera-projects?action=districts');
			const result = await res.json();
			if (result.success) districts = result.data;
		} catch (e) {
			console.error('Failed to fetch districts:', e);
		}
	}

	async function fetchProjects() {
		if (!selectedDistrict) return;
		loadingProjects = true;
		errorProjects = '';
		projects = [];
		try {
			const res = await fetch(
				`/api/maharashtra-rera-projects?action=list&district=${encodeURIComponent(selectedDistrict)}`
			);
			const result = await res.json();
			if (result.success) {
				projects = result.data;
			} else {
				throw new Error(result.error);
			}
		} catch (e) {
			errorProjects = e.message || 'Failed to fetch projects';
		} finally {
			loadingProjects = false;
		}
	}

	async function loadAllProjects() {
		loadingProjects = true;
		errorProjects = '';
		selectedDistrict = '';
		try {
			const res = await fetch('/api/maharashtra-rera-projects?action=list');
			const result = await res.json();
			if (result.success) {
				projects = result.data;
			} else {
				throw new Error(result.error);
			}
		} catch (e) {
			errorProjects = e.message || 'Failed to fetch projects';
		} finally {
			loadingProjects = false;
		}
	}

	async function scrapeAllProjects() {
		scrapingAllProjects = true;
		scrapeProjectMsg = '';
		errorProjects = '';
		projects = [];
		selectedDistrict = '';
		try {
			const res = await fetch('/api/maharashtra-rera-projects?action=scrape-all&refresh=true');
			const result = await res.json();
			if (result.success) {
				projects = result.data;
				scrapeProjectMsg = `Scrape complete! ${result.scraped || result.total || projects.length} projects loaded.`;
			} else {
				throw new Error(result.error);
			}
		} catch (e) {
			errorProjects = 'Scrape failed: ' + (e.message || 'Unknown error');
		} finally {
			scrapingAllProjects = false;
		}
	}

	async function scrapePromotersList() {
		scrapingPromoters = true;
		promoterScrapePhase = 'list';
		scrapePromoterMsg = '';
		errorPromoters = '';
		try {
			const res = await fetch('/api/maharashtra-rera-promoters?refresh=true');
			const result = await res.json();
			if (result.success) {
				promoters = result.data;
				scrapePromoterMsg = `List scraped! ${result.uniquePromoters || result.total || promoters.length} promoters found (basic info).`;
			} else {
				throw new Error(result.error);
			}
		} catch (e) {
			errorPromoters = 'Scrape failed: ' + (e.message || 'Unknown error');
		} finally {
			scrapingPromoters = false;
			promoterScrapePhase = '';
		}
	}

	async function scrapeAllPromoters() {
		scrapingPromoters = true;
		promoterScrapePhase = 'all';
		scrapePromoterMsg = '';
		errorPromoters = '';
		try {
			const res = await fetch('/api/maharashtra-rera-promoters?action=scrape-all&refresh=true');
			const result = await res.json();
			if (result.success) {
				promoters = result.data;
				if (result.phase === 'list-complete-details-background') {
					scrapePromoterMsg = result.message || `Phase 1 done: ${result.uniquePromoters || promoters.length} promoters saved. Phase 2 running in background — refresh periodically.`;
				} else {
					scrapePromoterMsg = `Scrape complete! ${result.uniquePromoters || result.total || promoters.length} promoters loaded.`;
				}
			} else {
				throw new Error(result.error);
			}
		} catch (e) {
			errorPromoters = 'Scrape failed: ' + (e.message || 'Unknown error');
		} finally {
			scrapingPromoters = false;
			promoterScrapePhase = '';
		}
	}

	function viewPromoterDetails(promoter) {
		const raw = promoter.rawData || promoter;
		const linkedProjects = (promoter.projectLinks || []).map(link => ({
			projectName:    link.project?.name || '',
			registrationNo: link.project?.reraRegNo || '',
			role:           link.role || 'promoter'
		}));
		promoterDetails = {
			name:          getPromoterName(promoter),
			type:          getPromoterType(promoter),
			address:       promoter.address || raw.address || '',
			district:      promoter.district || raw.district || '',
			area:          promoter.area || raw.area || '',
			pinCode:       promoter.pinCode || raw.pinCode || '',
			email:         promoter.email || raw.email || '',
			mobile:        promoter.mobile || raw.mobile || '',
			reraRegNo:     promoter.reraRegNo || '',
			contactPerson: promoter.contactPerson || '',
			pan:           promoter.pan || '',
			gstin:         promoter.gstin || '',
			website:       promoter.website || '',
			projects:      linkedProjects.length > 0 ? linkedProjects : (raw.projects || [])
		};
		showPromoterModal = true;
	}

	function closePromoterModal() {
		showPromoterModal = false;
		promoterDetails = null;
	}

	function goToPage(p) { currentPage = Math.max(1, Math.min(p, totalPages)); }
	function switchTab(tab) { activeTab = tab; searchTerm = ''; currentPage = 1; }

	onMount(() => {
		fetchPromoters();
		fetchDistricts();
		loadAllProjects();
	});
</script>

<svelte:head>
	<title>Maharashtra RERA Promoters & Projects — RERA Toolkit</title>
</svelte:head>

<div class="space-y-6">
	<!-- Page header -->
	<div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
		<div class="flex flex-wrap items-start justify-between gap-4">
			<div>
				<h1 class="text-2xl font-bold text-slate-900">Maharashtra RERA — Promoters & Projects</h1>
				<p class="mt-1 text-sm text-slate-500">
					Registered promoters and projects under MahaRERA across all 36 districts.
				</p>
			</div>

			<div class="flex flex-wrap gap-2">
				<!-- Scrape List (Fast) — Phase 1 only -->
				<button
					on:click={scrapePromotersList}
					disabled={scrapingPromoters || scrapingAllProjects}
					class="inline-flex items-center gap-2 rounded-xl bg-slate-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed"
					title="Paginates the public MahaRERA listing. Fast, no CAPTCHA."
				>
					{#if scrapingPromoters && promoterScrapePhase === 'list'}
						<svg class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
						</svg>
						Scraping List…
					{:else}
						<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
						</svg>
						Scrape List (Fast)
					{/if}
				</button>

				<!-- Scrape All — Phase 1 + Phase 2 CAPTCHA -->
				<button
					on:click={scrapeAllPromoters}
					disabled={scrapingPromoters || scrapingAllProjects}
					class="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
					title="Full scrape: list + detail pages via CAPTCHA solving."
				>
					{#if scrapingPromoters && promoterScrapePhase === 'all'}
						<svg class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
						</svg>
						Scraping All…
					{:else}
						<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
						</svg>
						Scrape All (CAPTCHA)
					{/if}
				</button>

				<!-- Scrape All Projects -->
				<button
					on:click={scrapeAllProjects}
					disabled={scrapingAllProjects || scrapingPromoters}
					class="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
					title="Scrape all project listings across all 36 districts."
				>
					{#if scrapingAllProjects}
						<svg class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
						</svg>
						Scraping Projects…
					{:else}
						<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
						</svg>
						Scrape All Projects
					{/if}
				</button>
			</div>
		</div>

		<!-- Active scrape phase banner -->
		{#if scrapingPromoters}
			<div class="mt-4 rounded-xl border px-4 py-3 text-sm flex items-center gap-3
				{promoterScrapePhase === 'all' ? 'border-indigo-200 bg-indigo-50 text-indigo-800' : 'border-slate-200 bg-slate-50 text-slate-700'}"
				transition:slide>
				<svg class="animate-spin h-4 w-4 shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
					<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
					<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
				</svg>
				{#if promoterScrapePhase === 'list'}
					<span><strong>Phase 1 — Listing:</strong> Paginating MahaRERA to collect promoter names. Fast, no CAPTCHA.</span>
				{:else if promoterScrapePhase === 'all'}
					<span><strong>Phase 1+2 — Full scrape:</strong> Listing then visiting detail pages with CAPTCHA solving. This may take several minutes.</span>
				{/if}
			</div>
		{/if}

		<!-- Status messages -->
		{#if scrapePromoterMsg}
			<div class="mt-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800" transition:slide>
				<div class="flex items-center gap-2">
					<svg class="h-4 w-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
					</svg>
					{scrapePromoterMsg}
				</div>
			</div>
		{/if}
		{#if scrapeProjectMsg}
			<div class="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800" transition:slide>
				<div class="flex items-center gap-2">
					<svg class="h-4 w-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
					</svg>
					{scrapeProjectMsg}
				</div>
			</div>
		{/if}
	</div>

	<!-- Tabs + Search + District filter -->
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div class="flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
			<button
				on:click={() => switchTab('promoters')}
				class="rounded-lg px-4 py-2 text-sm font-semibold transition-all {activeTab === 'promoters' ? 'bg-indigo-600 text-white shadow' : 'text-slate-600 hover:text-slate-900'}"
			>
				Promoters
				{#if promoters.length > 0}
					<span class="ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold {activeTab === 'promoters' ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-500'}">{promoters.length}</span>
				{/if}
			</button>
			<button
				on:click={() => switchTab('projects')}
				class="rounded-lg px-4 py-2 text-sm font-semibold transition-all {activeTab === 'projects' ? 'bg-emerald-600 text-white shadow' : 'text-slate-600 hover:text-slate-900'}"
			>
				Projects
				{#if projects.length > 0}
					<span class="ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold {activeTab === 'projects' ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500'}">{projects.length}</span>
				{/if}
			</button>
		</div>

		<div class="flex flex-wrap items-center gap-2">
			{#if activeTab === 'projects'}
				<select
					bind:value={selectedDistrict}
					on:change={fetchProjects}
					class="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200"
				>
					<option value="">All Districts</option>
					{#each districts as d}
						<option value={d.code}>{d.name}</option>
					{/each}
				</select>
			{/if}
			<input
				type="text"
				placeholder="Search {activeTab}…"
				bind:value={searchTerm}
				class="w-64 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200"
			/>
		</div>
	</div>

	<!-- Error banners -->
	{#if errorPromoters && activeTab === 'promoters'}
		<div class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
			<p class="font-medium">Promoters error: {errorPromoters}</p>
		</div>
	{/if}
	{#if errorProjects && activeTab === 'projects'}
		<div class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
			<p class="font-medium">Projects error: {errorProjects}</p>
		</div>
	{/if}

	<!-- Data table -->
	<div class="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
		{#if (activeTab === 'promoters' && loadingPromoters) || (activeTab === 'projects' && loadingProjects) || scrapingPromoters || scrapingAllProjects}
			<div class="flex items-center justify-center py-20">
				<div class="flex flex-col items-center gap-4">
					<svg class="animate-spin h-8 w-8 text-indigo-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
					</svg>
					<p class="text-sm text-slate-500">
						{scrapingPromoters || scrapingAllProjects ? 'Scraping data from MahaRERA… this may take several minutes.' : 'Loading…'}
					</p>
				</div>
			</div>
		{:else if paginatedData.length === 0}
			<div class="flex flex-col items-center justify-center py-20 text-center">
				<svg class="h-12 w-12 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
				</svg>
				<p class="mt-4 text-sm font-medium text-slate-500">
					{searchTerm ? 'No results match your search.' : `No ${activeTab} data yet. Click "Scrape" to fetch from MahaRERA.`}
				</p>
			</div>
		{:else}

		<!-- Promoters Table -->
		{#if activeTab === 'promoters'}
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead class="bg-slate-50 border-b border-slate-200">
						<tr>
							<th class="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">#</th>
							<th class="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Promoter Name</th>
							<th class="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Type</th>
							<th class="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">District</th>
							<th class="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Area</th>
							<th class="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Pin Code</th>
							<th class="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Mobile</th>
							<th class="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">RERA Reg. No.</th>
							<th class="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Actions</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-100">
						{#each paginatedData as p, i}
							<tr class="hover:bg-slate-50 transition-colors">
								<td class="px-6 py-4 text-slate-400 text-xs">{(currentPage - 1) * pageSize + i + 1}</td>
								<td class="px-6 py-4 font-medium text-slate-900">{getPromoterName(p)}</td>
								<td class="px-6 py-4 text-slate-600">{getPromoterType(p) || '—'}</td>
								<td class="px-6 py-4 text-slate-600">{p.district || '—'}</td>
								<td class="px-6 py-4 text-slate-600">{p.area || '—'}</td>
								<td class="px-6 py-4 text-slate-600">{p.pinCode || '—'}</td>
								<td class="px-6 py-4 text-slate-600">{p.mobile || '—'}</td>
								<td class="px-6 py-4 font-mono text-xs text-slate-600">{p.reraRegNo || '—'}</td>
								<td class="px-6 py-4">
									<button
										on:click={() => viewPromoterDetails(p)}
										class="inline-flex items-center gap-1 rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-100"
									>
										View Details
									</button>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

		<!-- Projects Table -->
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead class="bg-slate-50 border-b border-slate-200">
						<tr>
							<th class="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">#</th>
							<th class="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Project Name</th>
							<th class="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Promoter</th>
							<th class="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">District</th>
							<th class="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Area</th>
							<th class="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Pin Code</th>
							<th class="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Reg. No.</th>
							<th class="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Valid Upto</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-100">
						{#each paginatedData as p, i}
							<tr class="hover:bg-slate-50 transition-colors">
								<td class="px-6 py-4 text-slate-400 text-xs">{(currentPage - 1) * pageSize + i + 1}</td>
								<td class="px-6 py-4 font-medium text-slate-900">{p.projectName || p.name || '—'}</td>
								<td class="px-6 py-4 text-slate-600">{p.promoterName || '—'}</td>
								<td class="px-6 py-4 text-slate-600">{p.district || '—'}</td>
								<td class="px-6 py-4 text-slate-600">{p.area || '—'}</td>
								<td class="px-6 py-4 text-slate-600">{p.pinCode || '—'}</td>
								<td class="px-6 py-4 font-mono text-xs text-slate-600">{p.reraRegNo || p.registrationNo || '—'}</td>
								<td class="px-6 py-4 text-slate-600">{p.validUntil || p.validUpto || '—'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}

		<!-- Pagination -->
		{#if totalPages > 1}
			<div class="flex items-center justify-between border-t border-slate-100 px-6 py-4">
				<p class="text-xs text-slate-500">
					Showing {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, currentData.length)} of {currentData.length}
				</p>
				<div class="flex items-center gap-1">
					<button
						on:click={() => goToPage(currentPage - 1)}
						disabled={currentPage === 1}
						class="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
					>
						Prev
					</button>
					{#each pageRange as pg}
						<button
							on:click={() => goToPage(pg)}
							class="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors {pg === currentPage ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}"
						>
							{pg}
						</button>
					{/each}
					<button
						on:click={() => goToPage(currentPage + 1)}
						disabled={currentPage === totalPages}
						class="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
					>
						Next
					</button>
				</div>
			</div>
		{/if}

		{/if}
	</div>
</div>

<!-- Promoter Details Modal -->
{#if showPromoterModal && promoterDetails}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
		on:click|self={closePromoterModal}
		on:keydown|self={(e) => { if (e.key === 'Escape') closePromoterModal(); }}
		role="presentation"
		transition:fade={{ duration: 200 }}
	>
		<div
			class="relative w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl"
			role="dialog"
			aria-modal="true"
		>
			<div class="flex items-center justify-between border-b border-slate-100 p-6">
				<div>
					<h2 class="text-xl font-bold text-slate-900">{promoterDetails.name}</h2>
					{#if promoterDetails.type}
						<p class="text-xs text-slate-500 mt-0.5">{promoterDetails.type}</p>
					{/if}
				</div>
				<button
					on:click={closePromoterModal}
					class="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
					aria-label="Close"
				>
					<svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>

			<div class="max-h-[70vh] overflow-y-auto p-6 space-y-4">
				<div class="grid grid-cols-2 gap-3">
					{#each [
						['RERA Reg. No.', promoterDetails.reraRegNo],
						['District', promoterDetails.district],
						['Area', promoterDetails.area],
						['Pin Code', promoterDetails.pinCode],
						['Mobile', promoterDetails.mobile],
						['Email', promoterDetails.email],
						['Address', promoterDetails.address],
						['Contact Person', promoterDetails.contactPerson],
						['PAN', promoterDetails.pan],
						['GSTIN', promoterDetails.gstin],
						['Website', promoterDetails.website]
					] as [label, val]}
						{#if val}
							<div class="rounded-xl border border-slate-100 bg-slate-50 p-3">
								<p class="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
								<p class="mt-1 text-sm font-medium text-slate-700 break-words">{val}</p>
							</div>
						{/if}
					{/each}
				</div>

				{#if promoterDetails.projects && promoterDetails.projects.length > 0}
					<div>
						<h3 class="text-sm font-bold text-slate-700 mb-3">Linked Projects ({promoterDetails.projects.length})</h3>
						<div class="rounded-xl border border-slate-200 overflow-hidden">
							<table class="w-full text-xs">
								<thead class="bg-slate-50 border-b border-slate-200">
									<tr>
										<th class="px-3 py-2 text-left font-semibold text-slate-500">Project Name</th>
										<th class="px-3 py-2 text-left font-semibold text-slate-500">Reg. No.</th>
									</tr>
								</thead>
								<tbody class="divide-y divide-slate-100">
									{#each promoterDetails.projects as proj}
										<tr>
											<td class="px-3 py-2 text-slate-700">{proj.projectName || '—'}</td>
											<td class="px-3 py-2 font-mono text-slate-600">{proj.registrationNo || '—'}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</div>
				{/if}
			</div>

			<div class="border-t border-slate-100 p-6 flex justify-end">
				<button
					on:click={closePromoterModal}
					class="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
				>
					Close
				</button>
			</div>
		</div>
	</div>
{/if}
