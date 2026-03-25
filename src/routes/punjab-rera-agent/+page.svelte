<script>
	import { onMount } from 'svelte';
	import AgentTable from '$lib/components/AgentTable.svelte';

	let agents = [];
	let loading = true;
	let scraping = false;
	let error = '';
	let scrapeMessage = '';

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
			if (data.success) {
				agents = data.data;
			} else {
				error = data.error || 'Failed to fetch agents.';
			}
		} catch (err) {
			error = 'Error fetching data: ' + err.message;
		} finally {
			loading = false;
		}
	}

	async function startScraping() {
		scraping = true;
		error = '';
		scrapeMessage = '';
		try {
			const res = await fetch('/api/punjab-rera-agents?refresh=true');
			const data = await res.json();
			if (data.success) {
				agents = data.data;
				if (data.scrapeError) {
					scrapeMessage = `Scraping failed (${data.scrapeError}), showing cached data.`;
				} else {
					scrapeMessage = `Scraping complete! ${data.scraped || 0} agents scraped, ${data.total || agents.length} total in database.`;
				}
			} else {
				error = data.error || 'Scraping failed.';
			}
		} catch (err) {
			error = 'Scraping error: ' + err.message;
		} finally {
			scraping = false;
		}
	}

	onMount(fetchAgents);
</script>

<div class="container mx-auto p-6 space-y-6">
	{#if error}
		<div class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 shadow-sm" role="alert">
			<div class="flex items-center gap-3">
				<svg class="h-5 w-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
				</svg>
				<p class="font-medium">Error: {error}</p>
			</div>
			<button
				on:click={() => { error = ''; fetchAgents(); }}
				class="mt-3 text-sm font-semibold text-red-800 hover:text-red-900 focus:outline-none"
			>
				Try again
			</button>
		</div>
	{/if}

	{#if scrapeMessage}
		<div class="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800 shadow-sm">
			<div class="flex items-center gap-3">
				<svg class="h-5 w-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
				</svg>
				<p class="font-medium">{scrapeMessage}</p>
			</div>
		</div>
	{/if}

	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-2xl font-bold text-gray-900">Punjab RERA Agents</h1>
			<p class="text-sm text-gray-500 mt-1">Official registered real estate agents in Punjab</p>
		</div>
		<button
			on:click={startScraping}
			disabled={scraping}
			class="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
		>
			{#if scraping}
				<svg class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
					<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
					<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
				</svg>
				Scraping...
			{:else}
				<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
				</svg>
				Start Scraping
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
