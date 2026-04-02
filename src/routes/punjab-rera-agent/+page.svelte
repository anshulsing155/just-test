<script>
	import { onMount, onDestroy } from 'svelte';
	import AgentTable from '$lib/components/AgentTable.svelte';

	let agents = [];
	let loading = true;
	let error = '';
	let scrapeMessage = '';

	// Browser-session state
	let browserOpen = false;
	let tableReady = false;
	let scraping = false;
	let pollInterval = null;

	const columns = [
		{ key: 'reraRegNo', label: 'Registration No.' },
		{ key: 'name', label: 'Agent Name' },
		{ key: 'firmType', label: 'Type' },
		{ key: 'district', label: 'District' },
		{ key: 'validUpto', label: 'Validity' },
		{
			key: 'status',
			label: 'Status',
			render: (val) => {
				const status = val || 'N/A';
				const isActive = status.toLowerCase() === 'active' || status.toLowerCase() === 'approved';
				return `<span class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${isActive ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}">${status}</span>`;
			}
		}
	];

	async function fetchAgents() {
		loading = true;
		error = '';
		try {
			const res = await fetch('/api/punjab-rera-agents');
			const data = await res.json();
			if (data.success) agents = data.data;
			else error = data.error || 'Failed to fetch agents.';
		} catch (err) {
			error = 'Error: ' + err.message;
		} finally {
			loading = false;
		}
	}

	// Step 1 — open the real browser window
	async function openBrowser() {
		error = '';
		scrapeMessage = '';
		tableReady = false;
		try {
			const res = await fetch('/api/punjab-rera-agents?action=open-browser');
			const data = await res.json();
			if (data.success) {
				browserOpen = true;
				startPolling();
			} else {
				error = data.error || 'Failed to open browser.';
			}
		} catch (err) {
			error = 'Error: ' + err.message;
		}
	}

	// Poll every 2 s to check whether the CAPTCHA has been filled
	function startPolling() {
		stopPolling();
		pollInterval = setInterval(async () => {
			try {
				const res = await fetch('/api/punjab-rera-agents?action=check-ready');
				const data = await res.json();
				if (data.sessionExpired) {
					stopPolling();
					browserOpen = false;
					tableReady = false;
					error = 'Browser session expired. Please open the browser again.';
					return;
				}
				if (data.ready) {
					stopPolling();
					tableReady = true;
					// Auto-scrape as soon as the table is detected
					await scrapeNow();
				}
			} catch {}
		}, 2000);
	}

	function stopPolling() {
		if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
	}

	// Step 2 — scrape the visible table
	async function scrapeNow() {
		scraping = true;
		error = '';
		scrapeMessage = '';
		try {
			const res = await fetch('/api/punjab-rera-agents?refresh=true');
			const data = await res.json();
			if (data.success) {
				agents = data.data;
				if (data.scrapeError) {
					scrapeMessage = `Scrape failed (${data.scrapeError}), showing cached data.`;
				} else {
					scrapeMessage = `Done! ${data.scraped ?? 0} agents scraped, ${data.total ?? agents.length} total in database.`;
				}
				browserOpen = false;
				tableReady = false;
			} else {
				error = data.error || 'Scraping failed.';
			}
		} catch (err) {
			error = 'Error: ' + err.message;
		} finally {
			scraping = false;
		}
	}

	async function closeBrowser() {
		stopPolling();
		await fetch('/api/punjab-rera-agents?action=close-browser').catch(() => {});
		browserOpen = false;
		tableReady = false;
	}

	onMount(fetchAgents);
	onDestroy(stopPolling);
</script>

<div class="container mx-auto p-6 space-y-6">

	<!-- Error banner -->
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

	<!-- Success banner -->
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

	<!-- Browser-open status bar -->
	{#if browserOpen}
		<div class="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
			<div class="flex items-center justify-between gap-4">
				<div class="flex items-center gap-3 text-sm text-amber-800">
					{#if tableReady || scraping}
						<!-- table detected, scraping -->
						<svg class="animate-spin h-5 w-5 shrink-0 text-amber-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
						</svg>
						<span class="font-medium">Table detected — scraping data…</span>
					{:else}
						<!-- waiting for user -->
						<span class="relative flex h-3 w-3 shrink-0">
							<span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
							<span class="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
						</span>
						<span class="font-medium">Browser is open — fill the CAPTCHA and submit the form.</span>
					{/if}
				</div>
				{#if !scraping}
					<button
						on:click={closeBrowser}
						class="shrink-0 text-xs font-medium text-amber-700 hover:text-amber-900 underline"
					>
						Cancel
					</button>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Header row -->
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-2xl font-bold text-gray-900">Punjab RERA Agents</h1>
			<p class="text-sm text-gray-500 mt-1">Official registered real estate agents in Punjab</p>
		</div>

		<button
			on:click={browserOpen ? scrapeNow : openBrowser}
			disabled={scraping || (browserOpen && !tableReady)}
			class="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
		>
			{#if scraping}
				<svg class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
					<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
					<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
				</svg>
				Scraping…
			{:else if browserOpen && tableReady}
				<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
				</svg>
				Scrape Now
			{:else if browserOpen}
				<svg class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
					<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
					<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
				</svg>
				Waiting for CAPTCHA…
			{:else}
				<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
				</svg>
				Open Browser
			{/if}
		</button>
	</div>

	<AgentTable
		{agents}
		{columns}
		loading={loading || scraping}
		title=""
		description=""
	/>
</div>
