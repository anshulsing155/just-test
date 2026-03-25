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

	const columns = [
		{ key: 'name', label: 'Name' },
		{ key: 'reraRegNo', label: 'Registration No.' },
		{ key: 'firmType', label: 'Type' },
		{ key: 'address', label: 'Address' },
		{ key: 'validUpto', label: 'Validity' },
		{
			key: 'status',
			label: 'Status',
			render: (val) => {
				const status = val || 'N/A';
				const isApproved = String(status).toLowerCase() === 'approved' || String(status).toLowerCase() === 'active';
				return `<span class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${isApproved ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}">${status}</span>`;
			}
		}
	];

	async function fetchAgents() {
		loading = true;
		error = '';
		try {
			const response = await fetch('/api/mp-rera-agents');
			const result = await response.json();
			if (result.success) {
				agents = result.data;
			} else {
				error = result.error || 'Failed to fetch agents.';
			}
		} catch (e) {
			error = e.message || 'Failed to fetch agents.';
		} finally {
			loading = false;
		}
	}

	async function startScraping() {
		scraping = true;
		error = '';
		scrapeMessage = '';
		try {
			const response = await fetch('/api/mp-rera-agents?refresh=true');
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

	function formatDetails(agent) {
		return {
			Name: agent?.name,
			'Registration No.': agent?.reraRegNo,
			'Firm Type': agent?.firmType,
			Address: agent?.address,
			District: agent?.district,
			Mobile: agent?.mobile,
			Email: agent?.email,
			Validity: agent?.validUpto,
			Status: agent?.status,
			Partners: agent?.partners
		};
	}

	function openDetails(agent) {
		agentDetails = formatDetails(agent);
	}

	function closeDetails() {
		agentDetails = null;
	}

	onMount(fetchAgents);
</script>

<svelte:head>
	<title>MP RERA Agents — RERA Toolkit</title>
</svelte:head>

<div class="container mx-auto p-6 space-y-6">
	{#if error}
		<div class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 shadow-sm">
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
			<h1 class="text-2xl font-bold text-gray-900">MP RERA Agents</h1>
			<p class="text-sm text-gray-500 mt-1">
				Search and view details of registered agents in Madhya Pradesh
				{#if agents.length > 0}
					<span class="ml-1 font-semibold text-indigo-600">({agents.length} total)</span>
				{/if}
			</p>
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
	>
		<th slot="header-extra" class="px-6 py-4 font-semibold text-slate-900">Actions</th>
		<td slot="row-extra" let:agent class="px-6 py-4">
			<button
				on:click={() => openDetails(agent)}
				class="inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-100 focus:outline-none"
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
					<button
						on:click={closeDetails}
						class="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
						aria-label="Close agent details"
					>
						<svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</div>

				<div class="max-h-[70vh] overflow-y-auto p-6">
					<div class="grid gap-4 sm:grid-cols-2">
						{#each Object.entries(agentDetails) as [key, value]}
							<div class="rounded-xl border border-slate-100 bg-slate-50 p-4">
								<p class="text-[10px] font-bold uppercase tracking-wider text-slate-400">{key}</p>
								{#if value && typeof value === 'object'}
									<pre class="mt-2 whitespace-pre-wrap break-words rounded-lg bg-white p-3 text-xs text-slate-700 border border-slate-200">{JSON.stringify(value, null, 2)}</pre>
								{:else}
									<p class="mt-1 text-sm font-medium text-slate-700">{value || 'N/A'}</p>
								{/if}
							</div>
						{/each}
					</div>
				</div>

				<div class="border-t border-slate-100 p-6 flex justify-end">
					<button
						on:click={closeDetails}
						class="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
					>
						Close
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>
