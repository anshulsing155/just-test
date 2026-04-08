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
	let selectedProject = null;
	let showDetailsModal = false;

	// Pagination
	let currentPage = 1;
	let pageSize = 20;

	// Promoter search/filter
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
			(p.area && p.area.toLowerCase().includes(s)) ||
			(p.pinCode && p.pinCode.toLowerCase().includes(s))
		);
	});

	$: filteredProjects = projects.filter((p) => {
		if (!searchTerm) return true;
		const s = searchTerm.toLowerCase();
		return (
			(p.projectName && p.projectName.toLowerCase().includes(s)) ||
			(p.promoterName && p.promoterName.toLowerCase().includes(s)) ||
			(p.projectRegNo && p.projectRegNo.toLowerCase().includes(s)) ||
			(p.district && p.district.toLowerCase().includes(s)) ||
			(p.area && p.area.toLowerCase().includes(s)) ||
			(p.pinCode && p.pinCode.toLowerCase().includes(s))
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

	async function fetchPromoters() {
		loadingPromoters = true;
		errorPromoters = '';
		try {
			const res = await fetch('/api/up-rera-promoters');
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
			const res = await fetch('/api/up-rera-projects?action=districts');
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
				`/api/up-rera-projects?action=list&district=${encodeURIComponent(selectedDistrict)}`
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

	async function viewProjectDetails(project) {
		loadingDetails = true;
		errorDetails = '';
		projectDetails = null;
		showDetailsModal = true;
		try {
			// Use district + rowIndex for postback-based navigation
			const params = new URLSearchParams({ action: 'details' });
			if (project.rowIndex && selectedDistrict) {
				params.set('district', selectedDistrict);
				params.set('rowIndex', project.rowIndex);
			} else if (project.projectId) {
				params.set('projectId', project.projectId);
			}
			const res = await fetch(`/api/up-rera-projects?${params.toString()}`);
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
	});
</script>

<svelte:head>
	<title>UP RERA Promoters & Projects</title>
</svelte:head>

<div class="space-y-6">
	<!-- Header -->
	<div>
		<h1 class="text-2xl font-bold tracking-tight text-slate-900">UP RERA Promoters & Projects</h1>
		<p class="mt-1 text-sm text-slate-500">
			Browse registered builders/promoters and their projects in Uttar Pradesh
		</p>
	</div>

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
					>Select District</label
				>
				<select
					id="district-select"
					bind:value={selectedDistrict}
					on:change={fetchProjects}
					class="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
				>
					<option value="">-- Choose a district --</option>
					{#each districts as d}
						<option value={d}>{d}</option>
					{/each}
				</select>
			</div>
			<button
				on:click={fetchProjects}
				disabled={!selectedDistrict || loadingProjects}
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
				? 'Search promoters by name, registration, district...'
				: 'Search projects by name, promoter, registration...'}
			class="block w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm placeholder-slate-400 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
		/>
	</div>

	<!-- Error Messages -->
	{#if activeTab === 'promoters' && errorPromoters}
		<div class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
			{errorPromoters}
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
							<th class="px-4 py-3.5 font-semibold text-slate-900 whitespace-nowrap">#</th>
							<th class="px-4 py-3.5 font-semibold text-slate-900 whitespace-nowrap"
								>Reg. No</th
							>
							<th class="px-4 py-3.5 font-semibold text-slate-900 whitespace-nowrap"
								>Promoter / Builder Name</th
							>
							<th class="px-4 py-3.5 font-semibold text-slate-900 whitespace-nowrap"
								>Address</th
							>
							<th class="px-4 py-3.5 font-semibold text-slate-900 whitespace-nowrap"
								>Contact Details</th
							>
							<th class="px-4 py-3.5 font-semibold text-slate-900 whitespace-nowrap"
								>Type</th
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
								<td colspan="6" class="px-4 py-16 text-center">
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
							{#each paginatedData as promoter, i (promoter.reraRegNo || promoter.id || i)}
								<tr
									class="hover:bg-slate-50/80 transition-colors"
									in:fade={{ duration: 150 }}
								>
									<td class="px-4 py-3.5 text-slate-500"
										>{(currentPage - 1) * pageSize + i + 1}</td
									>
									<td class="px-4 py-3.5">
										<span class="inline-flex items-center rounded bg-slate-100 px-2 py-0.5 text-xs font-mono">
											{promoter.reraRegNo || 'N/A'}
										</span>
									</td>
									<td class="px-4 py-3.5">
										<div class="font-medium text-slate-900">{promoter.name || 'N/A'}</div>
										{#if promoter.contactPerson}
											<div class="text-xs text-slate-500 mt-0.5">Chairman: {promoter.contactPerson}</div>
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
										{#if promoter.legalType}
											<span
												class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium
												{promoter.legalType.toLowerCase().includes('company')
													? 'bg-purple-50 text-purple-700'
													: promoter.legalType.toLowerCase().includes('individual')
														? 'bg-blue-50 text-blue-700'
														: promoter.legalType.toLowerCase().includes('partner')
															? 'bg-amber-50 text-amber-700'
															: promoter.legalType.toLowerCase().includes('societ')
																? 'bg-green-50 text-green-700'
																: 'bg-slate-100 text-slate-700'}"
											>
												{promoter.legalType}
											</span>
										{:else}
											<span class="text-slate-400">N/A</span>
										{/if}
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
						Showing <span class="font-semibold text-slate-700"
							>{(currentPage - 1) * pageSize + 1}</span
						>
						to
						<span class="font-semibold text-slate-700"
							>{Math.min(currentPage * pageSize, currentData.length)}</span
						>
						of <span class="font-semibold text-slate-700">{currentData.length}</span>
						{activeTab === 'promoters' ? 'promoters' : 'projects'}
					</p>
					{#if totalPages > 1}
						<nav class="flex items-center gap-1">
							<button
								on:click={() => goToPage(currentPage - 1)}
								disabled={currentPage === 1}
								class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-sm text-slate-600 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed"
							>
								<svg
									class="h-4 w-4"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M15 19l-7-7 7-7"
									/></svg
								>
							</button>
							{#each pageRange as page}
								<button
									on:click={() => goToPage(page)}
									class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-xs font-medium {page ===
									currentPage
										? 'bg-indigo-600 text-white shadow-sm'
										: 'text-slate-600 hover:bg-slate-200'}"
								>
									{page}
								</button>
							{/each}
							<button
								on:click={() => goToPage(currentPage + 1)}
								disabled={currentPage === totalPages}
								class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-sm text-slate-600 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed"
							>
								<svg
									class="h-4 w-4"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M9 5l7 7-7 7"
									/></svg
								>
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
							<th class="px-4 py-3.5 font-semibold text-slate-900 whitespace-nowrap">#</th>
							<th class="px-4 py-3.5 font-semibold text-slate-900 whitespace-nowrap"
								>Project Name</th
							>
							<th class="px-4 py-3.5 font-semibold text-slate-900 whitespace-nowrap"
								>RERA Reg. No</th
							>
							<th class="px-4 py-3.5 font-semibold text-slate-900 whitespace-nowrap"
								>Promoter / Builder</th
							>
							<th class="px-4 py-3.5 font-semibold text-slate-900 whitespace-nowrap"
								>District</th
							>
							<th class="px-4 py-3.5 font-semibold text-slate-900 whitespace-nowrap">Area</th>
							<th class="px-4 py-3.5 font-semibold text-slate-900 whitespace-nowrap">Pin Code</th>
							<th class="px-4 py-3.5 font-semibold text-slate-900 whitespace-nowrap"
								>Type</th
							>
							<th class="px-4 py-3.5 font-semibold text-slate-900 whitespace-nowrap"
								>Actions</th
							>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-100">
						{#if loadingProjects}
							{#each Array(5) as _}
								<tr class="animate-pulse">
									{#each Array(9) as _}
										<td class="px-4 py-3.5"
											><div class="h-4 w-3/4 rounded bg-slate-100"></div></td
										>
									{/each}
								</tr>
							{/each}
						{:else if !selectedDistrict}
							<tr>
								<td colspan="9" class="px-4 py-16 text-center">
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
												d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
											/>
										</svg>
										<p class="text-sm font-medium text-slate-500">
											Select a district to view projects
										</p>
									</div>
								</td>
							</tr>
						{:else if paginatedData.length === 0}
							<tr>
								<td colspan="9" class="px-4 py-16 text-center">
									<p class="text-sm font-medium text-slate-500">
										No projects found for {selectedDistrict}
									</p>
								</td>
							</tr>
						{:else}
							{#each paginatedData as project, i (project.projectRegNo || i)}
								<tr
									class="hover:bg-slate-50/80 transition-colors"
									in:fade={{ duration: 150 }}
								>
									<td class="px-4 py-3.5 text-slate-500"
										>{(currentPage - 1) * pageSize + i + 1}</td
									>
									<td class="px-4 py-3.5 font-medium text-slate-900"
										>{project.projectName || 'N/A'}</td
									>
									<td class="px-4 py-3.5 text-slate-600">
										<span class="inline-flex items-center rounded bg-slate-100 px-2 py-0.5 text-xs font-mono">
											{project.projectRegNo || 'N/A'}
										</span>
									</td>
									<td class="px-4 py-3.5 text-slate-600 font-medium"
										>{project.promoterName || 'N/A'}</td
									>
									<td class="px-4 py-3.5 text-slate-600"
										>{project.district || selectedDistrict}</td
									>
									<td class="px-4 py-3.5 text-slate-600">{project.area || '—'}</td>
									<td class="px-4 py-3.5 text-slate-600">{project.pinCode || '—'}</td>
									<td class="px-4 py-3.5">
										{#if project.projectType}
											<span class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium
												{project.projectType.toLowerCase().includes('residential') ? 'bg-blue-50 text-blue-700' :
												 project.projectType.toLowerCase().includes('commercial') ? 'bg-purple-50 text-purple-700' :
												 'bg-slate-100 text-slate-700'}">
												{project.projectType}
											</span>
										{:else}
											<span class="text-slate-400">N/A</span>
										{/if}
									</td>
									<td class="px-4 py-3.5">
										{#if project.viewDetailPostback || project.projectId}
											<button
												on:click={() => viewProjectDetails(project)}
												class="inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-600 transition-colors hover:bg-indigo-100"
											>
												<svg
													class="h-3.5 w-3.5"
													fill="none"
													viewBox="0 0 24 24"
													stroke="currentColor"
												>
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2"
														d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
													/>
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2"
														d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
													/>
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
			{#if !loadingProjects && currentData.length > 0}
				<div
					class="border-t border-slate-100 bg-slate-50 px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
				>
					<p class="text-xs text-slate-500">
						Showing <span class="font-semibold text-slate-700"
							>{(currentPage - 1) * pageSize + 1}</span
						>
						to
						<span class="font-semibold text-slate-700"
							>{Math.min(currentPage * pageSize, currentData.length)}</span
						>
						of <span class="font-semibold text-slate-700">{currentData.length}</span> projects
					</p>
					{#if totalPages > 1}
						<nav class="flex items-center gap-1">
							<button
								on:click={() => goToPage(currentPage - 1)}
								disabled={currentPage === 1}
								class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-sm text-slate-600 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed"
							>
								<svg
									class="h-4 w-4"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M15 19l-7-7 7-7"
									/></svg
								>
							</button>
							{#each pageRange as page}
								<button
									on:click={() => goToPage(page)}
									class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-xs font-medium {page ===
									currentPage
										? 'bg-indigo-600 text-white shadow-sm'
										: 'text-slate-600 hover:bg-slate-200'}"
								>
									{page}
								</button>
							{/each}
							<button
								on:click={() => goToPage(currentPage + 1)}
								disabled={currentPage === totalPages}
								class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-sm text-slate-600 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed"
							>
								<svg
									class="h-4 w-4"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M9 5l7 7-7 7"
									/></svg
								>
							</button>
						</nav>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</div>

<!-- PROJECT DETAILS MODAL -->
{#if showDetailsModal}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
		on:click|self={closeModal}
		transition:fade={{ duration: 150 }}
	>
		<div
			class="relative max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl"
		>
			<!-- Modal Header -->
			<div
				class="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4"
			>
				<h3 class="text-lg font-bold text-slate-900">Project Details</h3>
				<button
					on:click={closeModal}
					class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
				>
					<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M6 18L18 6M6 6l12 12"
						/>
					</svg>
				</button>
			</div>

			<!-- Modal Body -->
			<div class="p-6 space-y-6">
				{#if loadingDetails}
					<div class="flex flex-col items-center gap-4 py-12">
						<div
							class="h-10 w-10 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600"
						></div>
						<p class="text-sm text-slate-500">Loading project details...</p>
					</div>
				{:else if errorDetails}
					<div class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
						{errorDetails}
					</div>
				{:else if projectDetails}
					<!-- Project Info -->
					{#if Object.keys(projectDetails.projectInfo).length > 0}
						<div>
							<h4 class="text-sm font-bold uppercase tracking-wider text-slate-400 mb-3">
								Project Information
							</h4>
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
					{#if Object.keys(projectDetails.promoterInfo).length > 0}
						<div>
							<h4 class="text-sm font-bold uppercase tracking-wider text-slate-400 mb-3">
								Promoter / Builder Details
							</h4>
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
					{#if Object.keys(projectDetails.locationInfo).length > 0}
						<div>
							<h4 class="text-sm font-bold uppercase tracking-wider text-slate-400 mb-3">
								Location Details
							</h4>
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
					{#if Object.keys(projectDetails.financialInfo).length > 0}
						<div>
							<h4 class="text-sm font-bold uppercase tracking-wider text-slate-400 mb-3">
								Financial Details
							</h4>
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
					{#if Object.keys(projectDetails.propertyDetails).length > 0}
						{#each Object.entries(projectDetails.propertyDetails) as [tableName, rows]}
							<div>
								<h4 class="text-sm font-bold uppercase tracking-wider text-slate-400 mb-3">
									{tableName}
								</h4>
								<div class="overflow-x-auto rounded-lg border border-slate-200">
									<table class="w-full text-xs">
										<thead class="bg-slate-50">
											<tr>
												{#each Object.keys(rows[0] || {}) as header}
													<th class="px-3 py-2 font-semibold text-slate-700 whitespace-nowrap"
														>{header}</th
													>
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
					{#if Object.keys(projectDetails.sections).length > 0}
						{#each Object.entries(projectDetails.sections) as [sectionName, fields]}
							{#if Object.keys(fields).length > 0}
								<div>
									<h4
										class="text-sm font-bold uppercase tracking-wider text-slate-400 mb-3"
									>
										{sectionName}
									</h4>
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
