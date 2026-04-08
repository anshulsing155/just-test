<script>
	import { onMount, onDestroy } from 'svelte';
	import { fade, slide } from 'svelte/transition';

	let promoters = [];
	let projects = [];
	let projectDetails = null;
	let districts = [];

	let loadingPromoters = false;
	let loadingProjects = false;
	let loadingDetails = false;

	let errorPromoters = '';
	let errorProjects = '';
	let errorDetails = '';

	let selectedDistrict = '';
	let searchTerm = '';
	let activeTab = 'promoters'; // 'promoters' | 'projects'
	let showDetailsModal = false;
	let promoterDetails = null;
	let showPromoterModal = false;
	let loadingPromoterDetail = false;
	// Scrape messages
	let scrapeProjectMsg = '';
	let scrapePromoterMsg = '';

	// Browser-session state — promoters
	let browserOpenPromoters = false;
	let tableReadyPromoters  = false;
	let scrapingPromoters    = false;
	let pollPromoters        = null;

	// Browser-session state — projects
	let browserOpenProjects = false;
	let tableReadyProjects  = false;
	let scrapingAllProjects = false;
	let pollProjects        = null;

	// Pagination
	let currentPage = 1;
	let pageSize = 20;

	// Promoter search — data from CompanyService (DB fields: name, reraRegNo, legalType, address, mobile, email)
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
			(p.district && p.district.toLowerCase().includes(s))
		);
	});

	// Project search — data from ProjectService or raw scraped
	$: filteredProjects = projects.filter((p) => {
		if (!searchTerm) return true;
		const s = searchTerm.toLowerCase();
		return (
			(p.projectName && p.projectName.toLowerCase().includes(s)) ||
			(p.promoterName && p.promoterName.toLowerCase().includes(s)) ||
			(p.district && p.district.toLowerCase().includes(s)) ||
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

	function getPromoterName(p) {
		return p.name || p.promoterName || 'N/A';
	}
	function getPromoterType(p) {
		return p.legalType || p.applicantType || '';
	}

	async function fetchPromoters() {
		loadingPromoters = true;
		errorPromoters = '';
		try {
			const res = await fetch('/api/punjab-rera-promoters');
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
			const res = await fetch('/api/punjab-rera-projects?action=districts');
			const result = await res.json();
			if (result.success) {
				districts = result.data;
			}
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
				`/api/punjab-rera-projects?action=list&district=${encodeURIComponent(selectedDistrict)}`
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

	// ── Promoters: open-browser → poll → scrape ──────────────────────────────

	function stopPollPromoters() {
		if (pollPromoters) { clearInterval(pollPromoters); pollPromoters = null; }
	}

	async function openBrowserPromoters() {
		errorPromoters = '';
		scrapePromoterMsg = '';
		tableReadyPromoters = false;
		try {
			const res = await fetch('/api/punjab-rera-promoters?action=open-browser');
			const data = await res.json();
			if (!data.success) throw new Error(data.error);
			browserOpenPromoters = true;
			stopPollPromoters();
			// Just check session is still alive — user clicks Scrape Now manually
			pollPromoters = setInterval(async () => {
				try {
					const r = await fetch('/api/punjab-rera-promoters?action=check-ready');
					const d = await r.json();
					if (d.sessionExpired) {
						stopPollPromoters();
						browserOpenPromoters = false;
						tableReadyPromoters  = false;
						errorPromoters = 'Session expired — open the browser again.';
					}
				} catch {}
			}, 5000);
		} catch (e) {
			errorPromoters = 'Failed to open browser: ' + e.message;
		}
	}

	async function scrapePromoters() {
		scrapingPromoters = true;
		errorPromoters = '';
		scrapePromoterMsg = '';
		try {
			const res = await fetch('/api/punjab-rera-promoters?refresh=true');
			const result = await res.json();
			if (result.success) {
				promoters = result.data;
				scrapePromoterMsg = `Done! ${result.scraped ?? 0} rows scraped, ${result.total ?? promoters.length} in database.`;
				browserOpenPromoters = false;
				tableReadyPromoters  = false;
			} else {
				throw new Error(result.error);
			}
		} catch (e) {
			errorPromoters = 'Scrape failed: ' + e.message;
		} finally {
			scrapingPromoters = false;
		}
	}

	async function closeBrowserPromoters() {
		stopPollPromoters();
		await fetch('/api/punjab-rera-promoters?action=close-browser').catch(() => {});
		browserOpenPromoters = false;
		tableReadyPromoters  = false;
	}

	// ── Projects: open-browser → poll → scrape ───────────────────────────────

	function stopPollProjects() {
		if (pollProjects) { clearInterval(pollProjects); pollProjects = null; }
	}

	async function openBrowserProjects() {
		errorProjects = '';
		scrapeProjectMsg = '';
		tableReadyProjects = false;
		const districtParam = selectedDistrict ? `&district=${encodeURIComponent(selectedDistrict)}` : '';
		try {
			const res = await fetch(`/api/punjab-rera-projects?action=open-browser${districtParam}`);
			const data = await res.json();
			if (!data.success) throw new Error(data.error);
			browserOpenProjects = true;
			stopPollProjects();
			// Just check session is still alive — user clicks Scrape Now manually
			pollProjects = setInterval(async () => {
				try {
					const r = await fetch('/api/punjab-rera-projects?action=check-ready');
					const d = await r.json();
					if (d.sessionExpired) {
						stopPollProjects();
						browserOpenProjects = false;
						tableReadyProjects  = false;
						errorProjects = 'Session expired — open the browser again.';
					}
				} catch {}
			}, 5000);
		} catch (e) {
			errorProjects = 'Failed to open browser: ' + e.message;
		}
	}

	async function scrapeProjects() {
		scrapingAllProjects = true;
		errorProjects = '';
		scrapeProjectMsg = '';
		try {
			const res = await fetch('/api/punjab-rera-projects?refresh=true');
			const result = await res.json();
			if (result.success) {
				projects = result.data;
				scrapeProjectMsg = `Done! ${result.scraped ?? 0} rows scraped, ${result.total ?? projects.length} in database.`;
				browserOpenProjects = false;
				tableReadyProjects  = false;
			} else {
				throw new Error(result.error);
			}
		} catch (e) {
			errorProjects = 'Scrape failed: ' + e.message;
		} finally {
			scrapingAllProjects = false;
		}
	}

	async function closeBrowserProjects() {
		stopPollProjects();
		await fetch('/api/punjab-rera-projects?action=close-browser').catch(() => {});
		browserOpenProjects = false;
		tableReadyProjects  = false;
	}

	async function loadAllProjects() {
		loadingProjects = true;
		errorProjects = '';
		selectedDistrict = '';
		try {
			const res = await fetch('/api/punjab-rera-projects?action=list');
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

	async function viewProjectDetails(project) {
		loadingDetails = true;
		errorDetails = '';
		projectDetails = null;
		showDetailsModal = true;
		try {
			const projectId = project.projectID || project.rawData?.rawProjectID || '';
			const promoterId = project.promoterID || project.rawData?.rawPromoterID || '';
			const promoterType = project.promoterType || project.rawData?.rawPromoterType || '';

			if (!projectId) {
				throw new Error('No project ID available for detail view');
			}

			const res = await fetch(
				`/api/punjab-rera-projects?action=details&projectId=${encodeURIComponent(projectId)}&promoterId=${encodeURIComponent(promoterId)}&promoterType=${encodeURIComponent(promoterType)}`
			);
			const result = await res.json();
			if (result.success) {
				projectDetails = result.data;
			} else {
				throw new Error(result.error);
			}
		} catch (e) {
			errorDetails = e.message || 'Failed to fetch project details';
		} finally {
			loadingDetails = false;
		}
	}

	function closeModal() {
		showDetailsModal = false;
		projectDetails = null;
		errorDetails = '';
	}

	async function viewPromoterDetails(promoter) {
		showPromoterModal = true;
		loadingPromoterDetail = true;
		promoterDetails = null;

		const raw = promoter.rawData || promoter;

		// Show basic info + linked projects from DB
		const linkedProjects = (promoter.projectLinks || []).map(link => ({
			projectName: link.project?.name || '',
			registrationNo: link.project?.reraRegNo || '',
			role: link.role || 'promoter'
		}));

		promoterDetails = {
			name: getPromoterName(promoter),
			type: getPromoterType(promoter),
			address: promoter.address || raw.address || '',
			district: promoter.district || raw.district || '',
			email: promoter.email || raw.email || '',
			mobile: promoter.mobile || raw.mobile || '',
			reraRegNo: promoter.reraRegNo || '',
			contactPerson: promoter.contactPerson || '',
			pan: promoter.pan || '',
			gstin: promoter.gstin || '',
			website: promoter.website || '',
			projects: linkedProjects.length > 0 ? linkedProjects : (raw.projects || [])
		};
		loadingPromoterDetail = false;
	}

	function closePromoterModal() {
		showPromoterModal = false;
		promoterDetails = null;
	}

	function goToPage(page) {
		currentPage = Math.max(1, Math.min(page, totalPages));
	}

	function switchTab(tab) {
		activeTab = tab;
		searchTerm = '';
		currentPage = 1;
	}

	onMount(() => {
		fetchPromoters();
		fetchDistricts();
		loadAllProjects();
	});

	onDestroy(() => {
		stopPollPromoters();
		stopPollProjects();
	});
</script>

<svelte:head>
	<title>Punjab RERA Promoters & Projects</title>
</svelte:head>

<div class="space-y-6">
	<!-- Header -->
	<div class="flex items-start justify-between gap-4">
		<div>
			<h1 class="text-2xl font-bold tracking-tight text-slate-900">Punjab RERA Promoters & Projects</h1>
			<p class="mt-1 text-sm text-slate-500">
				Browse registered builders/promoters and their projects in Punjab
			</p>
		</div>
		<div class="flex gap-2 flex-shrink-0">
			{#if activeTab === 'promoters'}
				{#if browserOpenPromoters}
					<button
						on:click={closeBrowserPromoters}
						class="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors"
					>Cancel</button>
				{/if}
				<button
					on:click={browserOpenPromoters ? scrapePromoters : openBrowserPromoters}
					disabled={scrapingPromoters}
					class="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
				>
					{#if scrapingPromoters}
						<svg class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
						Scraping…
					{:else if browserOpenPromoters}
						<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
						Scrape Now
					{:else}
						<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" /></svg>
						Open Browser
					{/if}
				</button>
			{:else}
				{#if browserOpenProjects}
					<button
						on:click={closeBrowserProjects}
						class="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors"
					>Cancel</button>
				{/if}
				<button
					on:click={browserOpenProjects ? scrapeProjects : openBrowserProjects}
					disabled={scrapingAllProjects || (browserOpenProjects && !tableReadyProjects)}
					class="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
				>
					{#if scrapingAllProjects}
						<svg class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
						Scraping…
					{:else if browserOpenProjects && tableReadyProjects}
						<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
						Scrape Now
					{:else if browserOpenProjects}
						<svg class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
						Waiting for CAPTCHA…
					{:else}
						<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" /></svg>
						Open Browser
					{/if}
				</button>
			{/if}
		</div>
	</div>

	<!-- Success Messages -->
	{#if scrapePromoterMsg}
		<div class="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800 shadow-sm" transition:fade={{ duration: 200 }}>
			<div class="flex items-center gap-3">
				<svg class="h-5 w-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
				</svg>
				<p class="font-medium">{scrapePromoterMsg}</p>
			</div>
		</div>
	{/if}
	{#if scrapeProjectMsg}
		<div class="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800 shadow-sm" transition:fade={{ duration: 200 }}>
			<div class="flex items-center gap-3">
				<svg class="h-5 w-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
				</svg>
				<p class="font-medium">{scrapeProjectMsg}</p>
			</div>
		</div>
	{/if}

	<!-- Tab Navigation -->
	<div class="flex gap-1 rounded-lg bg-slate-100 p-1">
		<button
			class="flex-1 rounded-md px-4 py-2.5 text-sm font-medium transition-all {activeTab === 'promoters'
				? 'bg-white text-slate-900 shadow-sm'
				: 'text-slate-600 hover:text-slate-900'}"
			on:click={() => switchTab('promoters')}
		>
			Promoters / Builders
			{#if promoters.length > 0}
				<span class="ml-1.5 inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-600">
					{promoters.length}
				</span>
			{/if}
		</button>
		<button
			class="flex-1 rounded-md px-4 py-2.5 text-sm font-medium transition-all {activeTab === 'projects'
				? 'bg-white text-slate-900 shadow-sm'
				: 'text-slate-600 hover:text-slate-900'}"
			on:click={() => switchTab('projects')}
		>
			Projects by District
			{#if projects.length > 0}
				<span class="ml-1.5 inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-600">
					{projects.length}
				</span>
			{/if}
		</button>
	</div>

	<!-- District Selector (Projects Tab) -->
	{#if activeTab === 'projects'}
		<div class="flex flex-col gap-3 sm:flex-row sm:items-end" transition:slide={{ duration: 200 }}>
			<div class="flex-1">
				<label for="district-select" class="block text-sm font-medium text-slate-700 mb-1.5">Filter by District</label>
				<select
					id="district-select"
					bind:value={selectedDistrict}
					on:change={() => { if (selectedDistrict) fetchProjects(); else loadAllProjects(); }}
					class="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
				>
					<option value="">All Districts</option>
					{#each districts as d}
						<option value={d.name}>{d.name}</option>
					{/each}
				</select>
			</div>
			<button
				on:click={() => { if (selectedDistrict) fetchProjects(); else loadAllProjects(); }}
				disabled={loadingProjects || scrapingAllProjects}
				class="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
			>
				{loadingProjects ? 'Loading...' : 'Search Projects'}
			</button>
		</div>
	{/if}

	<!-- Search Bar -->
	<div class="relative">
		<div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
			<svg class="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
			</svg>
		</div>
		<input
			type="text"
			bind:value={searchTerm}
			placeholder={activeTab === 'promoters'
				? 'Search promoters by name, type, address, district...'
				: 'Search projects by name, promoter, district, registration no...'}
			class="block w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm placeholder-slate-400 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
		/>
	</div>

	<!-- Error Messages -->
	{#if activeTab === 'promoters' && errorPromoters}
		<div class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
			<p class="font-medium">{errorPromoters}</p>
			<button on:click={fetchPromoters} class="mt-2 text-sm font-semibold text-red-800 hover:text-red-900">Try again</button>
		</div>
	{/if}
	{#if activeTab === 'projects' && errorProjects}
		<div class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
			{errorProjects}
		</div>
	{/if}

	<!-- PROMOTERS TABLE -->
	{#if activeTab === 'promoters'}
		<div class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
			<div class="overflow-x-auto">
				<table class="w-full text-left text-sm border-collapse">
					<thead class="bg-slate-50 border-b border-slate-200">
						<tr>
							<th class="px-4 py-3.5 font-semibold text-slate-900 whitespace-nowrap w-10">#</th>
							<th class="px-4 py-3.5 font-semibold text-slate-900 whitespace-nowrap">Promoter / Builder Name</th>
							<th class="px-4 py-3.5 font-semibold text-slate-900 whitespace-nowrap">Type</th>
							<th class="px-4 py-3.5 font-semibold text-slate-900 whitespace-nowrap">District</th>
							<th class="px-4 py-3.5 font-semibold text-slate-900 whitespace-nowrap">Contact Details</th>
							<th class="px-4 py-3.5 font-semibold text-slate-900 whitespace-nowrap">Linked Projects</th>
							<th class="px-4 py-3.5 font-semibold text-slate-900 whitespace-nowrap">Actions</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-100">
						{#if loadingPromoters}
							{#each Array(5) as _}
								<tr class="animate-pulse">
									{#each Array(7) as _}
										<td class="px-4 py-3.5"><div class="h-4 w-3/4 rounded bg-slate-100"></div></td>
									{/each}
								</tr>
							{/each}
						{:else if paginatedData.length === 0}
							<tr>
								<td colspan="7" class="px-4 py-16 text-center">
									<div class="flex flex-col items-center gap-3">
										<svg class="h-12 w-12 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
										</svg>
										<p class="text-sm font-medium text-slate-500">
											{searchTerm ? 'No promoters match your search.' : 'No promoters loaded yet. Click "Scrape All Promoters" to import.'}
										</p>
									</div>
								</td>
							</tr>
						{:else}
							{#each paginatedData as promoter, i (promoter.id || promoter.reraRegNo || i)}
								<tr class="hover:bg-slate-50/80 transition-colors" in:fade={{ duration: 150 }}>
									<td class="px-4 py-3.5 text-slate-500">{(currentPage - 1) * pageSize + i + 1}</td>
									<td class="px-4 py-3.5">
										<div class="font-medium text-slate-900">{getPromoterName(promoter)}</div>
										{#if promoter.reraRegNo}
											<div class="text-xs text-slate-400 mt-0.5 font-mono">{promoter.reraRegNo}</div>
										{/if}
									</td>
									<td class="px-4 py-3.5">
										{#if getPromoterType(promoter)}
											<span class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium
												{getPromoterType(promoter).toLowerCase().includes('company')
													? 'bg-purple-50 text-purple-700'
													: getPromoterType(promoter).toLowerCase().includes('individual')
														? 'bg-blue-50 text-blue-700'
														: getPromoterType(promoter).toLowerCase().includes('partner')
															? 'bg-amber-50 text-amber-700'
															: 'bg-slate-100 text-slate-700'}">
												{getPromoterType(promoter)}
											</span>
										{:else}
											<span class="text-slate-400">N/A</span>
										{/if}
									</td>
									<td class="px-4 py-3.5 text-slate-600">{promoter.district || 'N/A'}</td>
									<td class="px-4 py-3.5">
										<div class="flex flex-col gap-0.5 text-xs text-slate-600">
											{#if promoter.mobile}
												<span>{promoter.mobile}</span>
											{/if}
											{#if promoter.email}
												<span class="text-indigo-600 truncate max-w-[200px]" title={promoter.email}>{promoter.email}</span>
											{/if}
											{#if !promoter.mobile && !promoter.email}
												<span class="text-slate-400">N/A</span>
											{/if}
										</div>
									</td>
									<td class="px-4 py-3.5">
										{#if promoter.projectLinks && promoter.projectLinks.length > 0}
											<span class="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
												{promoter.projectLinks.length} project{promoter.projectLinks.length !== 1 ? 's' : ''}
											</span>
										{:else}
											<span class="text-xs text-slate-400">None</span>
										{/if}
									</td>
									<td class="px-4 py-3.5">
										<button
											on:click={() => viewPromoterDetails(promoter)}
											class="inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-600 transition-colors hover:bg-indigo-100"
										>
											<svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
											</svg>
											View
										</button>
									</td>
								</tr>
							{/each}
						{/if}
					</tbody>
				</table>
			</div>

			<!-- Pagination -->
			{#if !loadingPromoters && currentData.length > 0}
				<div class="border-t border-slate-100 bg-slate-50 px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<p class="text-xs text-slate-500">
						Showing <span class="font-semibold text-slate-700">{(currentPage - 1) * pageSize + 1}</span>
						to <span class="font-semibold text-slate-700">{Math.min(currentPage * pageSize, currentData.length)}</span>
						of <span class="font-semibold text-slate-700">{currentData.length}</span> promoters
					</p>
					{#if totalPages > 1}
						<nav class="flex items-center gap-1">
							<button on:click={() => goToPage(currentPage - 1)} disabled={currentPage === 1}
								class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-sm text-slate-600 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed">
								<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" /></svg>
							</button>
							{#each pageRange as page}
								<button on:click={() => goToPage(page)}
									class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-xs font-medium {page === currentPage ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-200'}">
									{page}
								</button>
							{/each}
							<button on:click={() => goToPage(currentPage + 1)} disabled={currentPage === totalPages}
								class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-sm text-slate-600 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed">
								<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
							</button>
						</nav>
					{/if}
				</div>
			{/if}
		</div>
	{/if}

	<!-- PROJECTS TABLE -->
	{#if activeTab === 'projects'}
		<div class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
			<div class="overflow-x-auto">
				<table class="w-full text-left text-sm border-collapse">
					<thead class="bg-slate-50 border-b border-slate-200">
						<tr>
							<th class="px-4 py-3.5 font-semibold text-slate-900 whitespace-nowrap w-10">#</th>
							<th class="px-4 py-3.5 font-semibold text-slate-900 whitespace-nowrap">Project Name</th>
							<th class="px-4 py-3.5 font-semibold text-slate-900 whitespace-nowrap">Registration No.</th>
							<th class="px-4 py-3.5 font-semibold text-slate-900 whitespace-nowrap">Promoter / Builder</th>
							<th class="px-4 py-3.5 font-semibold text-slate-900 whitespace-nowrap">District</th>
							<th class="px-4 py-3.5 font-semibold text-slate-900 whitespace-nowrap">Valid Upto</th>
							<th class="px-4 py-3.5 font-semibold text-slate-900 whitespace-nowrap">Actions</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-100">
						{#if loadingProjects || scrapingAllProjects}
							{#each Array(5) as _}
								<tr class="animate-pulse">
									{#each Array(7) as _}
										<td class="px-4 py-3.5"><div class="h-4 w-3/4 rounded bg-slate-100"></div></td>
									{/each}
								</tr>
							{/each}
							{#if scrapingAllProjects}
								<tr>
									<td colspan="7" class="px-4 py-4 text-center">
										<p class="text-sm text-indigo-600 font-medium">Scraping projects across all Punjab districts... This may take several minutes due to CAPTCHA.</p>
									</td>
								</tr>
							{/if}
						{:else if paginatedData.length === 0}
							<tr>
								<td colspan="7" class="px-4 py-16 text-center">
									<div class="flex flex-col items-center gap-3">
										<svg class="h-12 w-12 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
										</svg>
										<p class="text-sm font-medium text-slate-500">
											{searchTerm
												? 'No projects match your search.'
												: selectedDistrict
													? `No projects found for ${selectedDistrict}`
													: 'No projects loaded yet. Click "Scrape All Projects" to import.'}
										</p>
									</div>
								</td>
							</tr>
						{:else}
							{#each paginatedData as project, i (project.reraRegNo || project.registrationNo || i)}
								<tr class="hover:bg-slate-50/80 transition-colors" in:fade={{ duration: 150 }}>
									<td class="px-4 py-3.5 text-slate-500">{(currentPage - 1) * pageSize + i + 1}</td>
									<td class="px-4 py-3.5 font-medium text-slate-900">{project.projectName || project.name || 'N/A'}</td>
									<td class="px-4 py-3.5">
										{#if project.registrationNo || project.reraRegNo}
											<span class="font-mono text-xs text-slate-600">{project.registrationNo || project.reraRegNo}</span>
										{:else}
											<span class="text-slate-400">N/A</span>
										{/if}
									</td>
									<td class="px-4 py-3.5 text-slate-600">{project.promoterName || (project.companyLinks && project.companyLinks[0]?.company?.name) || 'N/A'}</td>
									<td class="px-4 py-3.5 text-slate-600">{project.district || selectedDistrict}</td>
									<td class="px-4 py-3.5 text-slate-600">{project.validUpto || project.validUntil || 'N/A'}</td>
									<td class="px-4 py-3.5">
										{#if project.projectID || project.rawData?.rawProjectID}
											<button
												on:click={() => viewProjectDetails(project)}
												class="inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-600 transition-colors hover:bg-indigo-100"
											>
												<svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
													<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
													<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
												</svg>
												View Details
											</button>
										{:else}
											<span class="text-xs text-slate-400">N/A</span>
										{/if}
									</td>
								</tr>
							{/each}
						{/if}
					</tbody>
				</table>
			</div>

			<!-- Pagination for projects -->
			{#if !loadingProjects && !scrapingAllProjects && currentData.length > 0}
				<div class="border-t border-slate-100 bg-slate-50 px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<p class="text-xs text-slate-500">
						Showing <span class="font-semibold text-slate-700">{(currentPage - 1) * pageSize + 1}</span>
						to <span class="font-semibold text-slate-700">{Math.min(currentPage * pageSize, currentData.length)}</span>
						of <span class="font-semibold text-slate-700">{currentData.length}</span> projects
					</p>
					{#if totalPages > 1}
						<nav class="flex items-center gap-1">
							<button on:click={() => goToPage(currentPage - 1)} disabled={currentPage === 1}
								class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-sm text-slate-600 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed">
								<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" /></svg>
							</button>
							{#each pageRange as page}
								<button on:click={() => goToPage(page)}
									class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-xs font-medium {page === currentPage ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-200'}">
									{page}
								</button>
							{/each}
							<button on:click={() => goToPage(currentPage + 1)} disabled={currentPage === totalPages}
								class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-sm text-slate-600 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed">
								<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
							</button>
						</nav>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</div>

<!-- PROMOTER DETAILS MODAL -->
{#if showPromoterModal}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" on:click|self={closePromoterModal} transition:fade={{ duration: 150 }}>
		<div class="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl bg-white shadow-xl" transition:slide={{ duration: 200 }}>
			<div class="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4 rounded-t-2xl">
				<h2 class="text-lg font-bold text-slate-900">Promoter Details</h2>
				<button on:click={closePromoterModal} class="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600">
					<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
				</button>
			</div>

			<div class="px-6 py-5 space-y-5">
				{#if loadingPromoterDetail}
					<div class="flex items-center justify-center py-12">
						<svg class="animate-spin h-8 w-8 text-indigo-600" fill="none" viewBox="0 0 24 24">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
						</svg>
					</div>
				{:else if promoterDetails}
					<!-- Basic Info -->
					<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
						<div>
							<p class="text-xs font-medium text-slate-400 uppercase">Name</p>
							<p class="mt-0.5 text-sm font-semibold text-slate-900">{promoterDetails.name}</p>
						</div>
						{#if promoterDetails.type}
							<div>
								<p class="text-xs font-medium text-slate-400 uppercase">Type</p>
								<p class="mt-0.5 text-sm text-slate-700">{promoterDetails.type}</p>
							</div>
						{/if}
						{#if promoterDetails.district}
							<div>
								<p class="text-xs font-medium text-slate-400 uppercase">District</p>
								<p class="mt-0.5 text-sm text-slate-700">{promoterDetails.district}</p>
							</div>
						{/if}
						{#if promoterDetails.reraRegNo}
							<div>
								<p class="text-xs font-medium text-slate-400 uppercase">RERA Reg. No.</p>
								<p class="mt-0.5 text-sm font-mono text-slate-700">{promoterDetails.reraRegNo}</p>
							</div>
						{/if}
						{#if promoterDetails.email}
							<div>
								<p class="text-xs font-medium text-slate-400 uppercase">Email</p>
								<p class="mt-0.5 text-sm text-indigo-600">{promoterDetails.email}</p>
							</div>
						{/if}
						{#if promoterDetails.mobile}
							<div>
								<p class="text-xs font-medium text-slate-400 uppercase">Phone</p>
								<p class="mt-0.5 text-sm text-slate-700">{promoterDetails.mobile}</p>
							</div>
						{/if}
						{#if promoterDetails.address}
							<div class="sm:col-span-2">
								<p class="text-xs font-medium text-slate-400 uppercase">Address</p>
								<p class="mt-0.5 text-sm text-slate-700">{promoterDetails.address}</p>
							</div>
						{/if}
						{#if promoterDetails.website}
							<div>
								<p class="text-xs font-medium text-slate-400 uppercase">Website</p>
								<a href={promoterDetails.website.startsWith('http') ? promoterDetails.website : `https://${promoterDetails.website}`}
									target="_blank" rel="noopener noreferrer"
									class="mt-0.5 text-sm text-indigo-600 hover:underline">
									{promoterDetails.website}
								</a>
							</div>
						{/if}
					</div>

					<!-- Linked Projects -->
					{#if promoterDetails.projects && promoterDetails.projects.length > 0}
						<div class="border-t border-slate-100 pt-4">
							<h3 class="text-sm font-bold text-slate-900 mb-3">Linked Projects ({promoterDetails.projects.length})</h3>
							<div class="space-y-2">
								{#each promoterDetails.projects as proj, idx}
									<div class="rounded-lg border border-slate-100 bg-slate-50 p-3">
										<div class="flex items-start justify-between gap-2">
											<div>
												<p class="text-sm font-medium text-slate-900">{proj.projectName || proj.name || 'N/A'}</p>
												{#if proj.registrationNo || proj.reraRegNo}
													<p class="text-xs font-mono text-slate-500 mt-0.5">{proj.registrationNo || proj.reraRegNo}</p>
												{/if}
											</div>
											{#if proj.role}
												<span class="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600 capitalize">{proj.role}</span>
											{/if}
										</div>
										{#if proj.district}
											<p class="text-xs text-slate-500 mt-1">District: {proj.district}</p>
										{/if}
										{#if proj.validUpto}
											<p class="text-xs text-slate-500 mt-0.5">Valid Upto: {proj.validUpto}</p>
										{/if}
									</div>
								{/each}
							</div>
						</div>
					{/if}
				{/if}
			</div>
		</div>
	</div>
{/if}

<!-- PROJECT DETAILS MODAL -->
{#if showDetailsModal}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" on:click|self={closeModal} transition:fade={{ duration: 150 }}>
		<div class="relative w-full max-w-3xl max-h-[85vh] overflow-y-auto rounded-2xl bg-white shadow-xl" transition:slide={{ duration: 200 }}>
			<div class="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4 rounded-t-2xl">
				<h2 class="text-lg font-bold text-slate-900">Project Details</h2>
				<button on:click={closeModal} class="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600">
					<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
				</button>
			</div>

			<div class="px-6 py-5 space-y-5">
				{#if loadingDetails}
					<div class="flex items-center justify-center py-12">
						<svg class="animate-spin h-8 w-8 text-indigo-600" fill="none" viewBox="0 0 24 24">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
						</svg>
					</div>
				{:else if errorDetails}
					<div class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{errorDetails}</div>
				{:else if projectDetails}
					<!-- Project Info -->
					{#if projectDetails.projectInfo && Object.keys(projectDetails.projectInfo).length > 0}
						<div>
							<h3 class="text-sm font-bold text-slate-900 mb-3">Project Information</h3>
							<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
								{#each Object.entries(projectDetails.projectInfo) as e}
									<div class="rounded-lg bg-slate-50 px-3 py-2">
										<p class="text-xs font-medium text-slate-400">{e[0]}</p>
										<p class="text-sm text-slate-700 mt-0.5">{e[1]}</p>
									</div>
								{/each}
							</div>
						</div>
					{/if}

					<!-- Promoter Info -->
					{#if projectDetails.promoterInfo && Object.keys(projectDetails.promoterInfo).length > 0}
						<div class="border-t border-slate-100 pt-4">
							<h3 class="text-sm font-bold text-slate-900 mb-3">Promoter Information</h3>
							<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
								{#each Object.entries(projectDetails.promoterInfo) as e}
									<div class="rounded-lg bg-slate-50 px-3 py-2">
										<p class="text-xs font-medium text-slate-400">{e[0]}</p>
										<p class="text-sm text-slate-700 mt-0.5">{e[1]}</p>
									</div>
								{/each}
							</div>
						</div>
					{/if}

					<!-- Location Info -->
					{#if projectDetails.locationInfo && Object.keys(projectDetails.locationInfo).length > 0}
						<div class="border-t border-slate-100 pt-4">
							<h3 class="text-sm font-bold text-slate-900 mb-3">Location Details</h3>
							<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
								{#each Object.entries(projectDetails.locationInfo) as e}
									<div class="rounded-lg bg-slate-50 px-3 py-2">
										<p class="text-xs font-medium text-slate-400">{e[0]}</p>
										<p class="text-sm text-slate-700 mt-0.5">{e[1]}</p>
									</div>
								{/each}
							</div>
						</div>
					{/if}

					<!-- Financial Info -->
					{#if projectDetails.financialInfo && Object.keys(projectDetails.financialInfo).length > 0}
						<div class="border-t border-slate-100 pt-4">
							<h3 class="text-sm font-bold text-slate-900 mb-3">Financial Details</h3>
							<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
								{#each Object.entries(projectDetails.financialInfo) as e}
									<div class="rounded-lg bg-slate-50 px-3 py-2">
										<p class="text-xs font-medium text-slate-400">{e[0]}</p>
										<p class="text-sm text-slate-700 mt-0.5">{e[1]}</p>
									</div>
								{/each}
							</div>
						</div>
					{/if}

					<!-- Property Details (tables) -->
					{#if projectDetails.propertyDetails && Object.keys(projectDetails.propertyDetails).length > 0}
						<div class="border-t border-slate-100 pt-4">
							<h3 class="text-sm font-bold text-slate-900 mb-3">Property Details</h3>
							{#each Object.entries(projectDetails.propertyDetails) as propEntry}
								<p class="text-xs font-semibold text-slate-600 mb-2 mt-3">{propEntry[0]}</p>
								<div class="overflow-x-auto rounded-lg border border-slate-200">
									<table class="w-full text-xs">
										<thead class="bg-slate-50">
											<tr>
												{#each Object.keys(propEntry[1][0] || {}) as header}
													<th class="px-3 py-2 text-left font-medium text-slate-600">{header}</th>
												{/each}
											</tr>
										</thead>
										<tbody class="divide-y divide-slate-100">
											{#each propEntry[1] as row}
												<tr>
													{#each Object.values(row) as val}
														<td class="px-3 py-2 text-slate-700">{val}</td>
													{/each}
												</tr>
											{/each}
										</tbody>
									</table>
								</div>
							{/each}
						</div>
					{/if}

					<!-- All Fields (fallback) -->
					{#if projectDetails.allFields && Object.keys(projectDetails.allFields).length > 0 && !projectDetails.projectInfo}
						<div>
							<h3 class="text-sm font-bold text-slate-900 mb-3">All Details</h3>
							<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
								{#each Object.entries(projectDetails.allFields) as e}
									<div class="rounded-lg bg-slate-50 px-3 py-2">
										<p class="text-xs font-medium text-slate-400">{e[0]}</p>
										<p class="text-sm text-slate-700 mt-0.5">{e[1]}</p>
									</div>
								{/each}
							</div>
						</div>
					{/if}
				{/if}
			</div>
		</div>
	</div>
{/if}
