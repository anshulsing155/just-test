<script>
	import { onMount } from 'svelte';
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
	let scrapingAllProjects = false;
	let scrapeProjectMsg = '';
	let scrapingPromoters = false;
	let scrapePromoterMsg = '';

	// Pagination
	let currentPage = 1;
	let pageSize = 20;

	// Promoter search/filter — data comes from CompanyService (DB fields: name, reraRegNo, legalType, address, mobile, email)
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
			(p.contactPerson && p.contactPerson.toLowerCase().includes(s)) ||
			(p.promoterName && p.promoterName.toLowerCase().includes(s)) ||
			(p.applicantType && p.applicantType.toLowerCase().includes(s)) ||
			(p.area && p.area.toLowerCase().includes(s)) ||
			(p.pinCode && p.pinCode.toLowerCase().includes(s))
		);
	});

	// Project search/filter — data may come from AJAX (projectName, promoterName) or DB (name, reraRegNo)
	$: filteredProjects = projects.filter((p) => {
		if (!searchTerm) return true;
		const s = searchTerm.toLowerCase();
		return (
			(p.projectName && p.projectName.toLowerCase().includes(s)) ||
			(p.promoterName && p.promoterName.toLowerCase().includes(s)) ||
			(p.district && p.district.toLowerCase().includes(s)) ||
			(p.area && p.area.toLowerCase().includes(s)) ||
			(p.pinCode && p.pinCode.toLowerCase().includes(s)) ||
			(p.constructionStatus && p.constructionStatus.toLowerCase().includes(s)) ||
			(p.name && p.name.toLowerCase().includes(s)) ||
			(p.reraRegNo && p.reraRegNo.toLowerCase().includes(s))
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

	// Helper: get promoter display name (handles both DB and raw scraped data)
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
			const res = await fetch('/api/mp-rera-promoters');
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
			const res = await fetch('/api/mp-rera-projects?action=districts');
			const result = await res.json();
			if (result.success) {
				districts = result.data; // Array of { name, code }
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
				`/api/mp-rera-projects?action=list&district=${encodeURIComponent(selectedDistrict)}`
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

	async function scrapeAllProjects() {
		scrapingAllProjects = true;
		scrapeProjectMsg = '';
		errorProjects = '';
		projects = [];
		selectedDistrict = '';
		try {
			const res = await fetch('/api/mp-rera-projects?action=scrape-all&refresh=true');
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

	async function scrapeAllPromoters() {
		scrapingPromoters = true;
		scrapePromoterMsg = '';
		errorPromoters = '';
		try {
			const res = await fetch('/api/mp-rera-promoters?refresh=true');
			const result = await res.json();
			if (result.success) {
				promoters = result.data;
				scrapePromoterMsg = `Scrape complete! ${result.scraped || result.total || promoters.length} promoters loaded.`;
			} else {
				throw new Error(result.error);
			}
		} catch (e) {
			errorPromoters = 'Scrape failed: ' + (e.message || 'Unknown error');
		} finally {
			scrapingPromoters = false;
		}
	}

	async function loadAllProjects() {
		loadingProjects = true;
		errorProjects = '';
		selectedDistrict = '';
		try {
			const res = await fetch('/api/mp-rera-projects?action=list');
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
			const detailUrl = project.detailUrl || '';
			if (!detailUrl) {
				throw new Error('No detail URL available for this project');
			}
			const res = await fetch(
				`/api/mp-rera-projects?action=details&detailUrl=${encodeURIComponent(detailUrl)}`
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

		// rawData from DB contains the full scraped detail (partners, projects, email, etc.)
		const raw = promoter.rawData || promoter;

		// If we already have detail data in rawData, use it directly
		if (raw.partners || raw.projects || raw.partnershipType) {
			promoterDetails = {
				name: getPromoterName(promoter),
				type: getPromoterType(promoter),
				address: promoter.address || raw.address || '',
				district: promoter.district || raw.district || '',
				area: promoter.area || raw.area || '',
				pinCode: promoter.pinCode || raw.pinCode || '',
				email: promoter.email || raw.email || '',
				mobile: promoter.mobile || raw.mobile || '',
				partnershipType: raw.partnershipType || '',
				isNewEntity: raw.isNewEntity || '',
				registrationCertificateUrl: raw.registrationCertificateUrl || '',
				parentName: raw.parentName || '',
				parentExperience: raw.parentExperience || '',
				parentAddress: raw.parentAddress || '',
				partners: raw.partners || [],
				projects: raw.projects || []
			};
			loadingPromoterDetail = false;
			return;
		}

		// Fallback: fetch detail from API if detailUrl is available
		const detailUrl = raw.detailUrl || '';
		if (detailUrl) {
			try {
				const res = await fetch(`/api/mp-rera-promoters?detailUrl=${encodeURIComponent(detailUrl)}`);
				const result = await res.json();
				if (result.success && result.data) {
					const d = result.data;
					promoterDetails = {
						name: getPromoterName(promoter),
						type: getPromoterType(promoter),
						address: promoter.address || raw.address || '',
						district: promoter.district || raw.district || '',
						area: promoter.area || raw.area || '',
						pinCode: promoter.pinCode || raw.pinCode || '',
						email: d.email || promoter.email || '',
						mobile: d.mobile || promoter.mobile || '',
						partnershipType: d.partnershipType || '',
						isNewEntity: d.isNewEntity || '',
						registrationCertificateUrl: d.registrationCertificateUrl || '',
						parentName: d.parentName || '',
						parentExperience: d.parentExperience || '',
						parentAddress: d.parentAddress || '',
						partners: d.partners || [],
						projects: d.projects || []
					};
				} else {
					// Just show basic info
					promoterDetails = {
						name: getPromoterName(promoter),
						type: getPromoterType(promoter),
						address: promoter.address || '',
						district: promoter.district || '',
						area: promoter.area || '',
						pinCode: promoter.pinCode || '',
						email: promoter.email || '',
						mobile: promoter.mobile || '',
						partners: [],
						projects: []
					};
				}
			} catch {
				promoterDetails = {
					name: getPromoterName(promoter),
					type: getPromoterType(promoter),
					address: promoter.address || '',
					area: promoter.area || '',
					pinCode: promoter.pinCode || '',
					email: promoter.email || '',
					mobile: promoter.mobile || '',
					partners: [],
					projects: []
				};
			}
		} else {
			promoterDetails = {
				name: getPromoterName(promoter),
				type: getPromoterType(promoter),
				address: promoter.address || '',
				area: promoter.area || '',
				pinCode: promoter.pinCode || '',
				email: promoter.email || '',
				mobile: promoter.mobile || '',
				partners: [],
				projects: []
			};
		}
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
</script>

<svelte:head>
	<title>MP RERA Promoters & Projects</title>
</svelte:head>

<div class="space-y-6">
	<!-- Header -->
	<div class="flex items-start justify-between gap-4">
		<div>
			<h1 class="text-2xl font-bold tracking-tight text-slate-900">MP RERA Promoters & Projects</h1>
			<p class="mt-1 text-sm text-slate-500">
				Browse registered builders/promoters and their projects in Madhya Pradesh
			</p>
		</div>
		<div class="flex gap-2 flex-shrink-0">
			{#if activeTab === 'promoters'}
				<button
					on:click={scrapeAllPromoters}
					disabled={scrapingPromoters}
					class="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
				>
					{#if scrapingPromoters}
						<svg class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
						</svg>
						Scraping Promoters...
					{:else}
						<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
						</svg>
						Scrape All Promoters
					{/if}
				</button>
			{:else}
				<button
					on:click={scrapeAllProjects}
					disabled={scrapingAllProjects}
					class="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
				>
					{#if scrapingAllProjects}
						<svg class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
						</svg>
						Scraping All Projects...
					{:else}
						<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
						</svg>
						Scrape All Projects
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
				<span
					class="ml-1.5 inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-600"
				>
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
				<span
					class="ml-1.5 inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-600"
				>
					{projects.length}
				</span>
			{/if}
		</button>
	</div>

	<!-- District Selector (Projects Tab) -->
	{#if activeTab === 'projects'}
		<div class="flex flex-col gap-3 sm:flex-row sm:items-end" transition:slide={{ duration: 200 }}>
			<div class="flex-1">
				<label for="district-select" class="block text-sm font-medium text-slate-700 mb-1.5"
					>Filter by District</label
				>
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
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
				/>
			</svg>
		</div>
		<input
			type="text"
			bind:value={searchTerm}
			placeholder={activeTab === 'promoters'
				? 'Search promoters by name, type, address...'
				: 'Search projects by name, promoter, district, status...'}
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
							<th class="px-4 py-3.5 font-semibold text-slate-900 whitespace-nowrap"
								>Promoter / Builder Name</th
							>
							<th class="px-4 py-3.5 font-semibold text-slate-900 whitespace-nowrap"
								>Type</th
							>
							<th class="px-4 py-3.5 font-semibold text-slate-900 whitespace-nowrap"
								>Address</th
							>
							<th class="px-4 py-3.5 font-semibold text-slate-900 whitespace-nowrap"
								>Contact Details</th
							>
							<th class="px-4 py-3.5 font-semibold text-slate-900 whitespace-nowrap"
								>Actions</th
							>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-100">
						{#if loadingPromoters}
							{#each Array(5) as _}
								<tr class="animate-pulse">
									{#each Array(6) as _}
										<td class="px-4 py-3.5"
											><div class="h-4 w-3/4 rounded bg-slate-100"></div></td
										>
									{/each}
								</tr>
							{/each}
						{:else if paginatedData.length === 0}
							<tr>
								<td colspan="8" class="px-4 py-16 text-center">
									<div class="flex flex-col items-center gap-3">
										<svg
											class="h-12 w-12 text-slate-300"
											fill="none"
											viewBox="0 0 24 24"
											stroke="currentColor"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="1.5"
												d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
											/>
										</svg>
										<p class="text-sm font-medium text-slate-500">
											{searchTerm
												? 'No promoters match your search.'
												: 'No promoters loaded yet.'}
										</p>
									</div>
								</td>
							</tr>
						{:else}
							{#each paginatedData as promoter, i (promoter.id || promoter.reraRegNo || i)}
								<tr
									class="hover:bg-slate-50/80 transition-colors"
									in:fade={{ duration: 150 }}
								>
									<td class="px-4 py-3.5 text-slate-500"
										>{(currentPage - 1) * pageSize + i + 1}</td
									>
									<td class="px-4 py-3.5">
										<div class="font-medium text-slate-900">{getPromoterName(promoter)}</div>
										{#if promoter.contactPerson}
											<div class="text-xs text-slate-500 mt-0.5">Chairman: {promoter.contactPerson}</div>
										{/if}
										{#if promoter.reraRegNo}
											<div class="text-xs text-slate-400 mt-0.5 font-mono">{promoter.reraRegNo}</div>
										{/if}
									</td>
									<td class="px-4 py-3.5">
										{#if getPromoterType(promoter)}
											<span
												class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium
												{getPromoterType(promoter).toLowerCase().includes('company')
													? 'bg-purple-50 text-purple-700'
													: getPromoterType(promoter).toLowerCase().includes('individual')
														? 'bg-blue-50 text-blue-700'
														: getPromoterType(promoter).toLowerCase().includes('partner')
															? 'bg-amber-50 text-amber-700'
															: getPromoterType(promoter).toLowerCase().includes('proprietor')
																? 'bg-teal-50 text-teal-700'
																: getPromoterType(promoter).toLowerCase().includes('government')
																	? 'bg-red-50 text-red-700'
																	: 'bg-slate-100 text-slate-700'}"
											>
												{getPromoterType(promoter)}
											</span>
										{:else}
											<span class="text-slate-400">N/A</span>
										{/if}
									</td>
									<td class="px-4 py-3.5 text-slate-600 max-w-xs"
										title={promoter.address || ''}
									>
										<div class="truncate">{promoter.address || 'N/A'}</div>
									</td>
									<td class="px-4 py-3.5">
										<div class="flex flex-col gap-0.5 text-xs text-slate-600">
											{#if promoter.mobile}
												<span>{promoter.mobile}</span>
											{/if}
											{#if promoter.email}
												<span class="text-indigo-600 truncate max-w-[200px]" title={promoter.email}>{promoter.email}</span>
											{/if}
											{#if promoter.website}
												<a href={promoter.website.startsWith('http') ? promoter.website : `https://${promoter.website}`}
													target="_blank" rel="noopener noreferrer"
													class="text-indigo-500 hover:underline truncate max-w-[200px]"
													title={promoter.website}
												>
													{promoter.website.replace(/^https?:\/\//, '')}
												</a>
											{/if}
											{#if !promoter.mobile && !promoter.email}
												<span class="text-slate-400">N/A</span>
											{/if}
										</div>
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
											View Details
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
				<div
					class="border-t border-slate-100 bg-slate-50 px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
				>
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
							<th class="px-4 py-3.5 font-semibold text-slate-900 whitespace-nowrap">Promoter / Builder</th>
							<th class="px-4 py-3.5 font-semibold text-slate-900 whitespace-nowrap">District</th>
							<th class="px-4 py-3.5 font-semibold text-slate-900 whitespace-nowrap">Area</th>
							<th class="px-4 py-3.5 font-semibold text-slate-900 whitespace-nowrap">Pin Code</th>
							<th class="px-4 py-3.5 font-semibold text-slate-900 whitespace-nowrap">Status</th>
							<th class="px-4 py-3.5 font-semibold text-slate-900 whitespace-nowrap">Actions</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-100">
						{#if loadingProjects || scrapingAllProjects}
							{#each Array(5) as _}
								<tr class="animate-pulse">
									{#each Array(8) as _}
										<td class="px-4 py-3.5"><div class="h-4 w-3/4 rounded bg-slate-100"></div></td>
									{/each}
								</tr>
							{/each}
							{#if scrapingAllProjects}
								<tr>
									<td colspan="8" class="px-4 py-4 text-center">
										<p class="text-sm text-indigo-600 font-medium">Scraping all ~8,000+ projects from MP RERA... This may take a few minutes.</p>
									</td>
								</tr>
							{/if}
						{:else if paginatedData.length === 0}
							<tr>
								<td colspan="8" class="px-4 py-16 text-center">
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
							{#each paginatedData as project, i (project.projectRegNo || project.reraRegNo || i)}
								<tr class="hover:bg-slate-50/80 transition-colors" in:fade={{ duration: 150 }}>
									<td class="px-4 py-3.5 text-slate-500">{(currentPage - 1) * pageSize + i + 1}</td>
									<td class="px-4 py-3.5 font-medium text-slate-900">{project.projectName || project.name || 'N/A'}</td>
									<td class="px-4 py-3.5 text-slate-600">{project.promoterName || 'N/A'}</td>
									<td class="px-4 py-3.5 text-slate-600">{project.district || selectedDistrict}</td>
									<td class="px-4 py-3.5 text-slate-600">{project.area || '—'}</td>
									<td class="px-4 py-3.5 text-slate-600">{project.pinCode || '—'}</td>
									<td class="px-4 py-3.5">
										{#if project.constructionStatus}
											<span class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium
												{project.constructionStatus.toLowerCase().includes('progress') || project.constructionStatus.toLowerCase().includes('ongoing')
													? 'bg-amber-50 text-amber-700'
													: project.constructionStatus.toLowerCase().includes('completed')
														? 'bg-emerald-50 text-emerald-700'
														: project.constructionStatus.toLowerCase().includes('reject')
															? 'bg-red-50 text-red-700'
															: project.constructionStatus.toLowerCase().includes('withdraw')
																? 'bg-slate-100 text-slate-600'
																: 'bg-blue-50 text-blue-700'}">
												{project.constructionStatus}
											</span>
										{:else}
											<span class="text-slate-400">N/A</span>
										{/if}
									</td>
									<td class="px-4 py-3.5">
										{#if project.detailUrl}
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
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
		on:click|self={closePromoterModal}
		on:keydown={(e) => { if (e.key === 'Escape') closePromoterModal(); }}
		role="presentation"
		transition:fade={{ duration: 150 }}
	>
		<div class="relative max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl" role="dialog" aria-modal="true">
			<!-- Modal Header -->
			<div class="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
				<h3 class="text-lg font-bold text-slate-900">Promoter Details</h3>
				<button on:click={closePromoterModal}
					class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
					aria-label="Close promoter details">
					<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>

			<!-- Modal Body -->
			<div class="p-6 space-y-6">
				{#if loadingPromoterDetail}
					<div class="flex flex-col items-center gap-4 py-12">
						<div class="h-10 w-10 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600"></div>
						<p class="text-sm text-slate-500">Loading promoter details...</p>
					</div>
				{:else if promoterDetails}
					<!-- Promoter Information -->
					<div>
						<h4 class="text-sm font-bold uppercase tracking-wider text-slate-400 mb-3">Promoter Information</h4>
						<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
							<div class="rounded-lg bg-slate-50 p-3">
								<dt class="text-xs font-medium text-slate-500">Name</dt>
								<dd class="mt-0.5 text-sm font-medium text-slate-900">{promoterDetails.name || 'N/A'}</dd>
							</div>
							<div class="rounded-lg bg-slate-50 p-3">
								<dt class="text-xs font-medium text-slate-500">Type</dt>
								<dd class="mt-0.5 text-sm font-medium text-slate-900">{promoterDetails.type || 'N/A'}</dd>
							</div>
							{#if promoterDetails.partnershipType}
								<div class="rounded-lg bg-slate-50 p-3">
									<dt class="text-xs font-medium text-slate-500">Partnership Type</dt>
									<dd class="mt-0.5 text-sm font-medium text-slate-900">{promoterDetails.partnershipType}</dd>
								</div>
							{/if}
							{#if promoterDetails.isNewEntity}
								<div class="rounded-lg bg-slate-50 p-3">
									<dt class="text-xs font-medium text-slate-500">New Entity</dt>
									<dd class="mt-0.5 text-sm font-medium text-slate-900">{promoterDetails.isNewEntity}</dd>
								</div>
							{/if}
							<div class="rounded-lg bg-slate-50 p-3 sm:col-span-2">
								<dt class="text-xs font-medium text-slate-500">Address</dt>
								<dd class="mt-0.5 text-sm font-medium text-slate-900">{promoterDetails.address || 'N/A'}</dd>
							</div>
							{#if promoterDetails.district}
								<div class="rounded-lg bg-slate-50 p-3">
									<dt class="text-xs font-medium text-slate-500">District</dt>
									<dd class="mt-0.5 text-sm font-medium text-slate-900">{promoterDetails.district}</dd>
								</div>
							{/if}
							{#if promoterDetails.area}
								<div class="rounded-lg bg-slate-50 p-3">
									<dt class="text-xs font-medium text-slate-500">Area</dt>
									<dd class="mt-0.5 text-sm font-medium text-slate-900">{promoterDetails.area}</dd>
								</div>
							{/if}
							{#if promoterDetails.pinCode}
								<div class="rounded-lg bg-slate-50 p-3">
									<dt class="text-xs font-medium text-slate-500">Pin Code</dt>
									<dd class="mt-0.5 text-sm font-medium text-slate-900">{promoterDetails.pinCode}</dd>
								</div>
							{/if}
							{#if promoterDetails.email}
								<div class="rounded-lg bg-slate-50 p-3">
									<dt class="text-xs font-medium text-slate-500">Email</dt>
									<dd class="mt-0.5 text-sm font-medium text-indigo-600">{promoterDetails.email}</dd>
								</div>
							{/if}
							{#if promoterDetails.mobile}
								<div class="rounded-lg bg-slate-50 p-3">
									<dt class="text-xs font-medium text-slate-500">Mobile</dt>
									<dd class="mt-0.5 text-sm font-medium text-slate-900">{promoterDetails.mobile}</dd>
								</div>
							{/if}
							{#if promoterDetails.registrationCertificateUrl}
								<div class="rounded-lg bg-slate-50 p-3">
									<dt class="text-xs font-medium text-slate-500">Registration Certificate</dt>
									<dd class="mt-0.5">
										<a href={promoterDetails.registrationCertificateUrl} target="_blank" rel="noopener noreferrer"
											class="text-sm font-medium text-indigo-600 hover:underline">
											View Certificate
										</a>
									</dd>
								</div>
							{/if}
						</div>
					</div>

					<!-- Parent Company Info -->
					{#if promoterDetails.parentName}
						<div>
							<h4 class="text-sm font-bold uppercase tracking-wider text-slate-400 mb-3">Parent Company</h4>
							<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
								<div class="rounded-lg bg-amber-50 p-3">
									<dt class="text-xs font-medium text-amber-600">Parent Name</dt>
									<dd class="mt-0.5 text-sm font-medium text-amber-900">{promoterDetails.parentName}</dd>
								</div>
								{#if promoterDetails.parentExperience}
									<div class="rounded-lg bg-amber-50 p-3">
										<dt class="text-xs font-medium text-amber-600">Experience</dt>
										<dd class="mt-0.5 text-sm font-medium text-amber-900">{promoterDetails.parentExperience}</dd>
									</div>
								{/if}
								{#if promoterDetails.parentAddress}
									<div class="rounded-lg bg-amber-50 p-3 sm:col-span-2">
										<dt class="text-xs font-medium text-amber-600">Address</dt>
										<dd class="mt-0.5 text-sm font-medium text-amber-900">{promoterDetails.parentAddress}</dd>
									</div>
								{/if}
							</div>
						</div>
					{/if}

					<!-- Partner / Director Details -->
					{#if promoterDetails.partners && promoterDetails.partners.length > 0}
						<div>
							<h4 class="text-sm font-bold uppercase tracking-wider text-slate-400 mb-3">
								Partners / Directors
								<span class="ml-1.5 inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-600">
									{promoterDetails.partners.length}
								</span>
							</h4>
							<div class="space-y-3">
								{#each promoterDetails.partners as partner, idx}
									<div class="rounded-lg border border-slate-200 bg-white p-4">
										<div class="flex items-start gap-4">
											{#if partner.imageUrl}
												<img
													src={partner.imageUrl.startsWith('http') ? partner.imageUrl : `https://www.rera.mp.gov.in/${partner.imageUrl.replace(/^\//, '')}`}
													alt={partner.name}
													class="h-16 w-16 rounded-lg object-cover border border-slate-200 flex-shrink-0"
													on:error={(e) => { e.target.style.display = 'none'; }}
												/>
											{/if}
											<div class="flex-1 min-w-0">
												<p class="text-sm font-semibold text-slate-900">{partner.name || `Partner ${idx + 1}`}</p>
												{#if partner.email}
													<p class="text-xs text-indigo-600 mt-0.5">{partner.email}</p>
												{/if}
												{#if partner.address}
													<p class="text-xs text-slate-500 mt-0.5 line-clamp-2">{partner.address}</p>
												{/if}
											</div>
										</div>
									</div>
								{/each}
							</div>
						</div>
					{/if}

					<!-- Project List -->
					{#if promoterDetails.projects && promoterDetails.projects.length > 0}
						<div>
							<h4 class="text-sm font-bold uppercase tracking-wider text-slate-400 mb-3">
								Registered Projects
								<span class="ml-1.5 inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-600">
									{promoterDetails.projects.length}
								</span>
							</h4>
							<div class="overflow-x-auto rounded-lg border border-slate-200">
								<table class="w-full text-xs">
									<thead class="bg-slate-50">
										<tr>
											<th class="px-3 py-2 font-semibold text-slate-700 whitespace-nowrap">#</th>
											<th class="px-3 py-2 font-semibold text-slate-700 whitespace-nowrap">Project Name</th>
											<th class="px-3 py-2 font-semibold text-slate-700 whitespace-nowrap">Type</th>
											<th class="px-3 py-2 font-semibold text-slate-700 whitespace-nowrap">District / Area</th>
											<th class="px-3 py-2 font-semibold text-slate-700 whitespace-nowrap">RERA Reg No</th>
											<th class="px-3 py-2 font-semibold text-slate-700 whitespace-nowrap">Valid From</th>
										</tr>
									</thead>
									<tbody class="divide-y divide-slate-100">
										{#each promoterDetails.projects as proj, idx}
											<tr class="hover:bg-slate-50">
												<td class="px-3 py-2 text-slate-500">{idx + 1}</td>
												<td class="px-3 py-2 font-medium text-slate-900">{proj.projectName || 'N/A'}</td>
												<td class="px-3 py-2 text-slate-600">{proj.projectType || 'N/A'}</td>
												<td class="px-3 py-2 text-slate-600">{proj.districtArea || 'N/A'}</td>
												<td class="px-3 py-2 font-mono text-slate-700">{proj.reraRegNo || 'N/A'}</td>
												<td class="px-3 py-2 text-slate-600">{proj.validFrom || 'N/A'}</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						</div>
					{/if}
				{/if}
			</div>

			<!-- Modal Footer -->
			<div class="border-t border-slate-100 p-6 flex justify-end">
				<button on:click={closePromoterModal}
					class="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800">
					Close
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- PROJECT DETAILS MODAL -->
{#if showDetailsModal}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
		on:click|self={closeModal}
		transition:fade={{ duration: 150 }}
	>
		<div class="relative max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
			<!-- Modal Header -->
			<div class="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
				<h3 class="text-lg font-bold text-slate-900">Project Details</h3>
				<button on:click={closeModal}
					class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600">
					<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>

			<!-- Modal Body -->
			<div class="p-6 space-y-6">
				{#if loadingDetails}
					<div class="flex flex-col items-center gap-4 py-12">
						<div class="h-10 w-10 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600"></div>
						<p class="text-sm text-slate-500">Loading project details...</p>
					</div>
				{:else if errorDetails}
					<div class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{errorDetails}</div>
				{:else if projectDetails}
					<!-- Project Info -->
					{#if projectDetails.projectInfo && Object.keys(projectDetails.projectInfo).length > 0}
						<div>
							<h4 class="text-sm font-bold uppercase tracking-wider text-slate-400 mb-3">Project Information</h4>
							<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
								{#each Object.entries(projectDetails.projectInfo) as [key, value]}
									<div class="rounded-lg bg-slate-50 p-3">
										<dt class="text-xs font-medium text-slate-500">{key}</dt>
										<dd class="mt-0.5 text-sm font-medium text-slate-900">{value}</dd>
									</div>
								{/each}
							</div>
						</div>
					{/if}

					<!-- Promoter Info -->
					{#if projectDetails.promoterInfo && Object.keys(projectDetails.promoterInfo).length > 0}
						<div>
							<h4 class="text-sm font-bold uppercase tracking-wider text-slate-400 mb-3">Promoter / Builder Details</h4>
							<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
								{#each Object.entries(projectDetails.promoterInfo) as [key, value]}
									<div class="rounded-lg bg-indigo-50 p-3">
										<dt class="text-xs font-medium text-indigo-500">{key}</dt>
										<dd class="mt-0.5 text-sm font-medium text-indigo-900">{value}</dd>
									</div>
								{/each}
							</div>
						</div>
					{/if}

					<!-- Location Info -->
					{#if projectDetails.locationInfo && Object.keys(projectDetails.locationInfo).length > 0}
						<div>
							<h4 class="text-sm font-bold uppercase tracking-wider text-slate-400 mb-3">Location Details</h4>
							<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
								{#each Object.entries(projectDetails.locationInfo) as [key, value]}
									<div class="rounded-lg bg-emerald-50 p-3">
										<dt class="text-xs font-medium text-emerald-500">{key}</dt>
										<dd class="mt-0.5 text-sm font-medium text-emerald-900">{value}</dd>
									</div>
								{/each}
							</div>
						</div>
					{/if}

					<!-- Financial Info -->
					{#if projectDetails.financialInfo && Object.keys(projectDetails.financialInfo).length > 0}
						<div>
							<h4 class="text-sm font-bold uppercase tracking-wider text-slate-400 mb-3">Financial Details</h4>
							<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
								{#each Object.entries(projectDetails.financialInfo) as [key, value]}
									<div class="rounded-lg bg-amber-50 p-3">
										<dt class="text-xs font-medium text-amber-600">{key}</dt>
										<dd class="mt-0.5 text-sm font-medium text-amber-900">{value}</dd>
									</div>
								{/each}
							</div>
						</div>
					{/if}

					<!-- Property Tables -->
					{#if projectDetails.propertyDetails && Object.keys(projectDetails.propertyDetails).length > 0}
						{#each Object.entries(projectDetails.propertyDetails) as [tableName, rows]}
							<div>
								<h4 class="text-sm font-bold uppercase tracking-wider text-slate-400 mb-3">{tableName}</h4>
								<div class="overflow-x-auto rounded-lg border border-slate-200">
									<table class="w-full text-xs">
										<thead class="bg-slate-50">
											<tr>
												{#each Object.keys(rows[0] || {}) as header}
													<th class="px-3 py-2 font-semibold text-slate-700 whitespace-nowrap">{header}</th>
												{/each}
											</tr>
										</thead>
										<tbody class="divide-y divide-slate-100">
											{#each rows as row}
												<tr>
													{#each Object.values(row) as val}
														<td class="px-3 py-2 text-slate-600">{val}</td>
													{/each}
												</tr>
											{/each}
										</tbody>
									</table>
								</div>
							</div>
						{/each}
					{/if}

					<!-- Sections -->
					{#if projectDetails.sections && Object.keys(projectDetails.sections).length > 0}
						{#each Object.entries(projectDetails.sections) as [sectionName, fields]}
							{#if Object.keys(fields).length > 0}
								<div>
									<h4 class="text-sm font-bold uppercase tracking-wider text-slate-400 mb-3">{sectionName}</h4>
									<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
										{#each Object.entries(fields) as [key, value]}
											<div class="rounded-lg bg-slate-50 p-3">
												<dt class="text-xs font-medium text-slate-500">{key}</dt>
												<dd class="mt-0.5 text-sm text-slate-900">{value}</dd>
											</div>
										{/each}
									</div>
								</div>
							{/if}
						{/each}
					{/if}
				{/if}
			</div>
		</div>
	</div>
{/if}
