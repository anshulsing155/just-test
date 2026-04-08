<script>
	import { onMount } from 'svelte';
	import AgentTable from '$lib/components/AgentTable.svelte';
	import { fade, fly } from 'svelte/transition';

	let agents = [];
	let loading = true;
	let scraping = false;
	let agentDetails = null;
	let error = '';
	let scrapeMessage = '';
	let scrapePhase = ''; // 'list' | 'details' | 'all'

	const columns = [
		{ key: 'reraRegNo', label: 'Certificate No.' },
		{ key: 'name', label: 'Agent Name' },
		{ key: 'firmType', label: 'Type' },
		{ key: 'district', label: 'District' },
		{ key: 'mobile', label: 'Mobile' },
		{ key: 'validUpto', label: 'Validity' },
		{
			key: 'status',
			label: 'Status',
			render: (val) => {
				const s = val || 'Approved';
				const ok = /active|approved/i.test(s);
				return `<span class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${ok ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}">${s}</span>`;
			}
		}
	];

	async function fetchAgents() {
		loading = true; error = '';
		try {
			const res = await fetch('/api/maharashtra-rera-agents?action=list');
			const data = await res.json();
			if (data.success) agents = data.data;
			else error = data.error || 'Failed to fetch agents.';
		} catch (err) {
			error = 'Error: ' + err.message;
		} finally { loading = false; }
	}

	// Phase 1 only — fast, no CAPTCHA
	async function scrapeList() {
		await runScrape('scrape-list', 'Phase 1 complete');
	}

	// Phase 2 only — Puppeteer + CAPTCHA on detail pages
	async function scrapeDetails() {
		await runScrape('scrape-details', 'Full details scraped');
	}

	// Both phases — list then details
	async function scrapeAll() {
		await runScrape('scrape-all', 'All data scraped');
	}

	async function runScrape(action, successLabel) {
		scraping = true; scrapePhase = action; error = ''; scrapeMessage = '';
		try {
			const res = await fetch(`/api/maharashtra-rera-agents?action=${action}`);
			const data = await res.json();
			if (data.success) {
				agents = data.data;
				if (data.scrapeError) {
					scrapeMessage = `Warning: ${data.scrapeError}. Showing available data.`;
				} else if (data.phase === 'details-background') {
					scrapeMessage = data.message || `Phase 2 running in background — refresh to see updated details.`;
				} else if (data.phase === 'list-complete-details-background') {
					scrapeMessage = data.message || `Phase 1 done. Phase 2 running in background — refresh to see updates.`;
				} else {
					const parts = [];
					if (data.scraped)        parts.push(`${data.scraped} agents listed`);
					if (data.detailsFetched) parts.push(`${data.detailsFetched} details fetched`);
					if (data.total)          parts.push(`${data.total} in database`);
					scrapeMessage = `${successLabel}: ${parts.join(', ')}.`;
				}
			} else {
				error = data.error || 'Scraping failed.';
			}
		} catch (err) {
			error = 'Error: ' + err.message;
		} finally { scraping = false; scrapePhase = ''; }
	}

	function openDetails(agent) {
		agentDetails = {
			'Certificate No.': agent.reraRegNo,
			'Agent Name':       agent.name,
			'Type':             agent.firmType,
			'Father / Husband': agent.fatherName,
			'District':         agent.district,
			'Mobile':           agent.mobile,
			'Email':            agent.email,
			'Address':          agent.address,
			'Business Address': agent.rawData?.businessAddress,
			'Registration Date': agent.registrationDate,
			'Validity':         agent.validUpto,
			'Status':           agent.status,
			'MahaRERA Link':    agent.rawData?.detailUrl
		};
	}
	function closeDetails() { agentDetails = null; }

	onMount(fetchAgents);
</script>

<svelte:head>
	<title>Maharashtra RERA Agents — RERA Toolkit</title>
</svelte:head>

<div class="container mx-auto p-6 space-y-6">

	<!-- Error -->
	{#if error}
		<div class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 shadow-sm" role="alert">
			<div class="flex items-center gap-3">
				<svg class="h-5 w-5 shrink-0 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
				</svg>
				<p class="font-medium">{error}</p>
			</div>
		</div>
	{/if}

	<!-- Success -->
	{#if scrapeMessage}
		<div class="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800 shadow-sm">
			<div class="flex items-center gap-3">
				<svg class="h-5 w-5 shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
				</svg>
				<p class="font-medium">{scrapeMessage}</p>
			</div>
		</div>
	{/if}

	<!-- Scraping progress banner -->
	{#if scraping}
		<div class="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
			<div class="flex items-center gap-3 text-sm text-amber-800">
				<svg class="animate-spin h-5 w-5 shrink-0 text-amber-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
					<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
					<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
				</svg>
				<div>
					<p class="font-semibold">
						{#if scrapePhase === 'scrape-list'}
							Phase 1: Collecting agent IDs from MahaRERA listing pages…
						{:else if scrapePhase === 'scrape-details'}
							Phase 2: Fetching full details via Puppeteer + CAPTCHA solving…
						{:else}
							Phase 1 + 2: Listing then detail scrape in progress…
						{/if}
					</p>
					<p class="text-xs text-amber-700 mt-0.5">
						{#if scrapePhase === 'scrape-details' || scrapePhase === 'scrape-all'}
							Puppeteer opens each agent detail page, auto-solves CAPTCHA, and extracts full data. This takes a few minutes per batch.
						{:else}
							No CAPTCHA required for this phase.
						{/if}
					</p>
				</div>
			</div>
		</div>
	{/if}

	<!-- Header + action buttons -->
	<div class="flex flex-wrap items-start justify-between gap-4">
		<div>
			<h1 class="text-2xl font-bold text-gray-900">Maharashtra RERA Agents</h1>
			<p class="text-sm text-gray-500 mt-1">
				Official registered real estate agents in Maharashtra (MahaRERA)
				{#if agents.length > 0}
					<span class="ml-1 font-semibold text-indigo-600">({agents.length} loaded)</span>
				{/if}
			</p>
		</div>

		<div class="flex flex-wrap gap-2">
			<!-- Phase 1 only -->
			<button
				on:click={scrapeList}
				disabled={scraping || loading}
				title="Fast: collect all agent IDs and names from listing pages (no CAPTCHA)"
				class="inline-flex items-center gap-2 rounded-lg border border-indigo-300 bg-indigo-50 px-3.5 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
			>
				{#if scraping && scrapePhase === 'scrape-list'}
					<svg class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
					</svg>
				{:else}
					<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
					</svg>
				{/if}
				Scrape List (Fast)
			</button>

			<!-- Phase 2 only -->
			<button
				on:click={scrapeDetails}
				disabled={scraping || loading}
				title="Puppeteer: visit each detail page, auto-solve CAPTCHA, extract full data"
				class="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
			>
				{#if scraping && scrapePhase === 'scrape-details'}
					<svg class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
					</svg>
				{:else}
					<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
					</svg>
				{/if}
				Scrape Details (CAPTCHA)
			</button>

			<!-- Both phases -->
			<button
				on:click={scrapeAll}
				disabled={scraping || loading}
				title="Full scrape: list all agents, then fetch complete details via CAPTCHA"
				class="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
			>
				{#if scraping && scrapePhase === 'scrape-all'}
					<svg class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
					</svg>
				{:else}
					<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
					</svg>
				{/if}
				Scrape All
			</button>
		</div>
	</div>

	<!-- How it works -->
	<div class="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500 space-y-1">
		<p class="font-semibold text-slate-600">How scraping works:</p>
		<p><span class="font-medium text-indigo-600">Scrape List (Fast)</span> — paginates the public MahaRERA listing to collect all agent names &amp; certificate numbers. No CAPTCHA needed.</p>
		<p><span class="font-medium text-amber-600">Scrape Details (CAPTCHA)</span> — opens each agent's detail page at maharerait.maharashtra.gov.in, auto-solves the CAPTCHA using OCR, and extracts full details (mobile, email, address, validity…). Default: 200 agents per run.</p>
		<p><span class="font-medium text-indigo-700">Scrape All</span> — runs both phases sequentially.</p>
	</div>

	<AgentTable
		{agents}
		{columns}
		loading={loading || scraping}
		title=""
		description=""
	>
		<th slot="header-extra" class="px-6 py-4 font-semibold text-slate-900">Actions</th>
		<td slot="row-extra" let:agent class="px-6 py-4">
			<button
				on:click={() => openDetails(agent)}
				class="inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-100"
			>
				View Details
			</button>
		</td>
	</AgentTable>

	<!-- Agent Details Modal -->
	{#if agentDetails}
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
			on:click|self={closeDetails}
			on:keydown|self={(e) => { if (e.key === 'Escape') closeDetails(); }}
			role="presentation"
			transition:fade={{ duration: 200 }}
		>
			<div
				class="relative w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl"
				transition:fly={{ y: 20, duration: 300 }}
				role="dialog"
				aria-modal="true"
			>
				<div class="flex items-center justify-between border-b border-slate-100 p-6">
					<h2 class="text-xl font-bold text-slate-900">Agent Information</h2>
					<button on:click={closeDetails} class="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors" aria-label="Close">
						<svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</div>

				<div class="max-h-[70vh] overflow-y-auto p-6">
					<div class="grid gap-3 sm:grid-cols-2">
						{#each Object.entries(agentDetails) as [key, value]}
							{#if value}
								<div class="rounded-xl border border-slate-100 bg-slate-50 p-4">
									<p class="text-[10px] font-bold uppercase tracking-wider text-slate-400">{key}</p>
									{#if key === 'MahaRERA Link'}
										<a href={value} target="_blank" rel="noopener noreferrer"
											class="mt-1 text-sm font-medium text-indigo-600 hover:underline break-all">
											View on maharerait.maharashtra.gov.in →
										</a>
									{:else}
										<p class="mt-1 text-sm font-medium text-slate-700 break-words">{value}</p>
									{/if}
								</div>
							{/if}
						{/each}
					</div>
				</div>

				<div class="border-t border-slate-100 p-6 flex justify-end">
					<button on:click={closeDetails} class="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800">
						Close
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>
