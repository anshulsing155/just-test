<script>
	import { onMount } from 'svelte';
	import AgentTable from '$lib/components/AgentTable.svelte';

	let agents = [];
	let loading = true;
	let scraping = false;
	let error = null;
	let scrapeMessage = '';

	const columns = [
		{ key: 'name', label: 'Name' },
		{ key: 'reraRegNo', label: 'Registration No.' },
		{ key: 'district', label: 'District' },
		{ key: 'area', label: 'Area' },
		{ key: 'pinCode', label: 'Pin Code' },
		{ key: 'address', label: 'Address' },
		{ key: 'firmType', label: 'Firm Type' },
		{ key: 'validUpto', label: 'Validity' },
		{
			key: 'status',
			label: 'Status',
			render: (val) => {
				const status = val || 'N/A';
				return `<span class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${status === 'Approved' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">${status}</span>`;
			}
		}
	];

	async function fetchData() {
		loading = true;
		error = null;
		try {
			const response = await fetch('/api/delhi-rera-agents');
			const result = await response.json();
			if (result.success) {
				agents = result.data;
			} else {
				error = result.error || 'Failed to fetch agents.';
			}
		} catch (e) {
			error = e.message;
		} finally {
			loading = false;
		}
	}

	async function startScraping() {
		scraping = true;
		error = null;
		scrapeMessage = '';
		try {
			const response = await fetch('/api/delhi-rera-agents?refresh=true');
			const result = await response.json();
			if (result.success) {
				agents = result.data;
				scrapeMessage = `Import complete! ${result.scraped || result.total || agents.length} agents loaded into database.`;
			} else {
				error = result.error || 'Import failed.';
			}
		} catch (e) {
			error = 'Import error: ' + e.message;
		} finally {
			scraping = false;
		}
	}

	onMount(fetchData);
</script>

<svelte:head>
	<title>Delhi RERA Agents — RERA Toolkit</title>
</svelte:head>

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
				on:click={() => { error = null; fetchData(); }}
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
			<h1 class="text-2xl font-bold text-gray-900">Delhi RERA Agents</h1>
			<p class="text-sm text-gray-500 mt-1">Browse through registered real estate agents in Delhi</p>
		</div>
		<button
			on:click={startScraping}
			disabled={scraping}
			class="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
		>
			{#if scraping}
				<svg class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
					<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
					<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
				</svg>
				Importing...
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
	>
		<th slot="header-extra" class="px-6 py-4 font-semibold text-slate-900">Certificate</th>
		<td slot="row-extra" let:agent class="px-6 py-4">
			{#if agent.certificateUrl}
				<a
					href={agent.certificateUrl}
					target="_blank"
					rel="noopener noreferrer"
					class="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 font-medium text-xs"
				>
					<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
					</svg>
					PDF
				</a>
			{:else}
				<span class="text-slate-400 text-xs">N/A</span>
			{/if}
		</td>
	</AgentTable>
</div>
