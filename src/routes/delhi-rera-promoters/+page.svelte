<script>
	import { onMount } from 'svelte';
	import { fade, slide } from 'svelte/transition';

	let promoters = [];
	let loading = false;
	let error = '';
	let searchTerm = '';
	let activeFilter = 'all'; // 'all', 'registered', 'completed'
	let expandedRow = null;

	// Pagination
	let currentPage = 1;
	let pageSize = 20;

	$: filteredPromoters = promoters.filter((p) => {
		// Type filter
		if (activeFilter !== 'all' && p.type !== activeFilter) return false;
		// Search filter
		if (!searchTerm) return true;
		const s = searchTerm.toLowerCase();
		return (
			(p.promoterName && p.promoterName.toLowerCase().includes(s)) ||
			(p.registrationNo && p.registrationNo.toLowerCase().includes(s)) ||
			(p.projectName && p.projectName.toLowerCase().includes(s)) ||
			(p.promoterAddress && p.promoterAddress.toLowerCase().includes(s)) ||
			(p.promoterPhone && p.promoterPhone.includes(s)) ||
			(p.promoterEmail && p.promoterEmail.toLowerCase().includes(s)) ||
			(p.area && p.area.toLowerCase().includes(s)) ||
			(p.pinCode && p.pinCode.toLowerCase().includes(s))
		);
	});

	$: totalPages = Math.max(1, Math.ceil(filteredPromoters.length / pageSize));
	$: if (currentPage > totalPages) currentPage = totalPages;
	$: paginatedData = filteredPromoters.slice(
		(currentPage - 1) * pageSize,
		currentPage * pageSize
	);

	let lastResetKey = '';
	$: {
		const resetKey = `${activeFilter}::${searchTerm}`;
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

	$: registeredCount = promoters.filter((p) => p.type === 'registered').length;
	$: completedCount = promoters.filter((p) => p.type === 'completed').length;

	async function fetchPromoters() {
		loading = true;
		error = '';
		try {
			const res = await fetch('/api/delhi-rera-promoters?type=all');
			const result = await res.json();
			if (result.success) {
				promoters = result.data;
			} else {
				throw new Error(result.error);
			}
		} catch (e) {
			error = e.message || 'Failed to fetch promoters';
		} finally {
			loading = false;
		}
	}

	function goToPage(page) {
		currentPage = Math.max(1, Math.min(page, totalPages));
	}

	function toggleExpand(idx) {
		expandedRow = expandedRow === idx ? null : idx;
	}

	onMount(fetchPromoters);
</script>

<svelte:head>
	<title>Delhi RERA Promoters & Projects</title>
</svelte:head>

<div class="space-y-6">
	<!-- Header -->
	<div>
		<h1 class="text-2xl font-bold tracking-tight text-slate-900">
			Delhi RERA Promoters & Projects
		</h1>
		<p class="mt-1 text-sm text-slate-500">
			Registered builders/promoters and their projects in Delhi (NCT)
		</p>
	</div>

	<!-- Filter Tabs -->
	<div class="flex gap-1 rounded-lg bg-slate-100 p-1">
		<button
			class="flex-1 rounded-md px-4 py-2.5 text-sm font-medium transition-all {activeFilter ===
			'all'
				? 'bg-white text-slate-900 shadow-sm'
				: 'text-slate-600 hover:text-slate-900'}"
			on:click={() => (activeFilter = 'all')}
		>
			All
			{#if promoters.length > 0}
				<span
					class="ml-1.5 inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700"
				>
					{promoters.length}
				</span>
			{/if}
		</button>
		<button
			class="flex-1 rounded-md px-4 py-2.5 text-sm font-medium transition-all {activeFilter ===
			'registered'
				? 'bg-white text-slate-900 shadow-sm'
				: 'text-slate-600 hover:text-slate-900'}"
			on:click={() => (activeFilter = 'registered')}
		>
			Registered
			{#if registeredCount > 0}
				<span
					class="ml-1.5 inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-600"
				>
					{registeredCount}
				</span>
			{/if}
		</button>
		<button
			class="flex-1 rounded-md px-4 py-2.5 text-sm font-medium transition-all {activeFilter ===
			'completed'
				? 'bg-white text-slate-900 shadow-sm'
				: 'text-slate-600 hover:text-slate-900'}"
			on:click={() => (activeFilter = 'completed')}
		>
			Completed
			{#if completedCount > 0}
				<span
					class="ml-1.5 inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-600"
				>
					{completedCount}
				</span>
			{/if}
		</button>
	</div>

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
			placeholder="Search by promoter name, project, registration number, address, phone..."
			class="block w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm placeholder-slate-400 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
		/>
	</div>

	<!-- Error -->
	{#if error}
		<div class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
			<p class="font-medium">{error}</p>
			<button
				on:click={fetchPromoters}
				class="mt-2 text-sm font-semibold text-red-800 hover:text-red-900"
			>
				Try again
			</button>
		</div>
	{/if}

	<!-- Table -->
	<div class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
		<div class="overflow-x-auto">
			<table class="w-full text-left text-sm border-collapse">
				<thead class="bg-slate-50 border-b border-slate-200">
					<tr>
						<th class="px-4 py-3.5 font-semibold text-slate-900 whitespace-nowrap w-10"
							>#</th
						>
						<th class="px-4 py-3.5 font-semibold text-slate-900 whitespace-nowrap"
							>Promoter / Builder</th
						>
						<th class="px-4 py-3.5 font-semibold text-slate-900 whitespace-nowrap"
							>Project</th
						>
						<th class="px-4 py-3.5 font-semibold text-slate-900 whitespace-nowrap"
							>Reg. No</th
						>
						<th class="px-4 py-3.5 font-semibold text-slate-900 whitespace-nowrap"
							>Valid Until</th
						>
						<th class="px-4 py-3.5 font-semibold text-slate-900 whitespace-nowrap"
							>Status</th
						>
						<th class="px-4 py-3.5 font-semibold text-slate-900 whitespace-nowrap"
							>Certificate</th
						>
						<th class="px-4 py-3.5 font-semibold text-slate-900 whitespace-nowrap w-10"
						></th>
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-100">
					{#if loading}
						{#each Array(8) as _}
							<tr class="animate-pulse">
								{#each Array(8) as _}
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
						{#each paginatedData as promoter, i (promoter.registrationNo || i)}
							<!-- Main Row -->
							<tr
								class="hover:bg-slate-50/80 transition-colors cursor-pointer"
								on:click={() => toggleExpand(i)}
								in:fade={{ duration: 150 }}
							>
								<td class="px-4 py-3.5 text-slate-500"
									>{(currentPage - 1) * pageSize + i + 1}</td
								>
								<td class="px-4 py-3.5">
									<div class="font-medium text-slate-900">
										{promoter.promoterName || 'N/A'}
									</div>
									{#if promoter.promoterPhone}
										<div class="text-xs text-slate-500 mt-0.5">
											{promoter.promoterPhone}
										</div>
									{/if}
								</td>
								<td class="px-4 py-3.5">
									<div class="text-slate-700 max-w-xs truncate" title={promoter.projectName}>
										{promoter.projectName || 'N/A'}
									</div>
								</td>
								<td class="px-4 py-3.5">
									<span
										class="inline-flex items-center rounded bg-slate-100 px-2 py-0.5 text-xs font-mono"
									>
										{promoter.registrationNo || 'N/A'}
									</span>
								</td>
								<td class="px-4 py-3.5 text-slate-600"
									>{promoter.validUntil || 'N/A'}</td
								>
								<td class="px-4 py-3.5">
									{#if promoter.constructionStatus}
										<span
											class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium
												{promoter.constructionStatus.toLowerCase().includes('on going') || promoter.constructionStatus.toLowerCase().includes('ongoing')
												? 'bg-amber-50 text-amber-700'
												: promoter.constructionStatus.toLowerCase().includes('completed')
													? 'bg-emerald-50 text-emerald-700'
													: 'bg-slate-100 text-slate-700'}"
										>
											{promoter.constructionStatus}
										</span>
									{:else}
										<span
											class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium
											{promoter.type === 'completed'
												? 'bg-emerald-50 text-emerald-700'
												: 'bg-indigo-50 text-indigo-700'}"
										>
											{promoter.type === 'completed' ? 'Completed' : 'Registered'}
										</span>
									{/if}
								</td>
								<td class="px-4 py-3.5">
									{#if promoter.certificateUrl}
										<a
											href={promoter.certificateUrl}
											target="_blank"
											rel="noopener noreferrer"
											class="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 font-medium text-xs"
											on:click|stopPropagation
										>
											<svg
												class="h-4 w-4"
												fill="none"
												viewBox="0 0 24 24"
												stroke="currentColor"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
												/>
											</svg>
											PDF
										</a>
									{:else}
										<span class="text-slate-400 text-xs">N/A</span>
									{/if}
								</td>
								<td class="px-4 py-3.5">
									<svg
										class="h-4 w-4 text-slate-400 transition-transform {expandedRow === i
											? 'rotate-180'
											: ''}"
										fill="none"
										viewBox="0 0 24 24"
										stroke="currentColor"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M19 9l-7 7-7-7"
										/>
									</svg>
								</td>
							</tr>

							<!-- Expanded Detail Row -->
							{#if expandedRow === i}
								<tr transition:slide={{ duration: 200 }}>
									<td colspan="8" class="px-4 py-0">
										<div class="py-4 space-y-4">
											<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
												<!-- Promoter Details -->
												<div class="rounded-lg bg-indigo-50 p-3">
													<h4
														class="text-xs font-bold uppercase tracking-wider text-indigo-400 mb-2"
													>
														Promoter Details
													</h4>
													<dl class="space-y-1.5">
														<div>
															<dt class="text-xs text-indigo-500">Name</dt>
															<dd class="text-sm font-medium text-indigo-900">
																{promoter.promoterName || 'N/A'}
															</dd>
														</div>
														{#if promoter.promoterAddress}
															<div>
																<dt class="text-xs text-indigo-500">Address</dt>
																<dd class="text-sm text-indigo-900">
																	{promoter.promoterAddress}
																</dd>
															</div>
														{/if}
														{#if promoter.area}
															<div>
																<dt class="text-xs text-indigo-500">Area</dt>
																<dd class="text-sm text-indigo-900">{promoter.area}</dd>
															</div>
														{/if}
														{#if promoter.pinCode}
															<div>
																<dt class="text-xs text-indigo-500">Pin Code</dt>
																<dd class="text-sm text-indigo-900">{promoter.pinCode}</dd>
															</div>
														{/if}
														{#if promoter.promoterEmail}
															<div>
																<dt class="text-xs text-indigo-500">Email</dt>
																<dd class="text-sm text-indigo-900">
																	<a
																		href="mailto:{promoter.promoterEmail}"
																		class="underline">{promoter.promoterEmail}</a
																	>
																</dd>
															</div>
														{/if}
														{#if promoter.promoterPhone}
															<div>
																<dt class="text-xs text-indigo-500">Phone</dt>
																<dd class="text-sm text-indigo-900">
																	{promoter.promoterPhone}
																</dd>
															</div>
														{/if}
													</dl>
												</div>

												<!-- Project Details -->
												<div class="rounded-lg bg-emerald-50 p-3">
													<h4
														class="text-xs font-bold uppercase tracking-wider text-emerald-400 mb-2"
													>
														Project Details
													</h4>
													<dl class="space-y-1.5">
														<div>
															<dt class="text-xs text-emerald-500">Project Name</dt>
															<dd class="text-sm font-medium text-emerald-900">
																{promoter.projectName || 'N/A'}
															</dd>
														</div>
														{#if promoter.projectLocation}
															<div>
																<dt class="text-xs text-emerald-500">Location</dt>
																<dd class="text-sm text-emerald-900">
																	{promoter.projectLocation}
																</dd>
															</div>
														{/if}
													</dl>
												</div>

												<!-- Registration Details -->
												<div class="rounded-lg bg-amber-50 p-3">
													<h4
														class="text-xs font-bold uppercase tracking-wider text-amber-400 mb-2"
													>
														Registration Details
													</h4>
													<dl class="space-y-1.5">
														<div>
															<dt class="text-xs text-amber-500">Registration No</dt>
															<dd class="text-sm font-medium text-amber-900">
																{promoter.registrationNo || 'N/A'}
															</dd>
														</div>
														{#if promoter.validUntil}
															<div>
																<dt class="text-xs text-amber-500">Valid Until</dt>
																<dd class="text-sm text-amber-900">
																	{promoter.validUntil}
																</dd>
															</div>
														{/if}
														{#if promoter.constructionStatus}
															<div>
																<dt class="text-xs text-amber-500"
																	>Construction Status</dt
																>
																<dd class="text-sm text-amber-900">
																	{promoter.constructionStatus}
																</dd>
															</div>
														{/if}
														{#if promoter.extensionCertificate && promoter.extensionCertificate !== 'Not Applicable'}
															<div>
																<dt class="text-xs text-amber-500"
																	>Extension Certificate</dt
																>
																<dd class="text-sm text-amber-900">
																	{promoter.extensionCertificate}
																</dd>
															</div>
														{/if}
														{#if promoter.certificateUrl}
															<div>
																<dt class="text-xs text-amber-500">Certificate</dt>
																<dd>
																	<a
																		href={promoter.certificateUrl}
																		target="_blank"
																		rel="noopener noreferrer"
																		class="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800"
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
																				d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
																			/>
																		</svg>
																		Download PDF
																	</a>
																</dd>
															</div>
														{/if}
													</dl>
												</div>
											</div>
										</div>
									</td>
								</tr>
							{/if}
						{/each}
					{/if}
				</tbody>
			</table>
		</div>

		<!-- Pagination -->
		{#if !loading && filteredPromoters.length > 0}
			<div
				class="border-t border-slate-100 bg-slate-50 px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
			>
				<p class="text-xs text-slate-500">
					Showing <span class="font-semibold text-slate-700"
						>{(currentPage - 1) * pageSize + 1}</span
					>
					to
					<span class="font-semibold text-slate-700"
						>{Math.min(currentPage * pageSize, filteredPromoters.length)}</span
					>
					of <span class="font-semibold text-slate-700">{filteredPromoters.length}</span> promoters
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
</div>
