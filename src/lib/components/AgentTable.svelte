<script>
    import { fade } from 'svelte/transition';

    export let agents = [];
    export let columns = [];
    export let loading = false;
    export let title = "Agents";
    export let description = "";
    export let pageSize = 20;

    let searchTerm = "";
    let sortColumn = "";
    let sortDirection = 1;
    let currentPage = 1;
    let lastResetKey = "";

    $: filteredAgents = agents.filter(agent => {
        if (!searchTerm) return true;
        const searchStr = searchTerm.toLowerCase();
        return columns.some(col => {
            const val = agent[col.key];
            return val && String(val).toLowerCase().includes(searchStr);
        });
    });

    $: sortedAgents = [...filteredAgents].sort((a, b) => {
        if (!sortColumn) return 0;
        const valA = a[sortColumn] ?? '';
        const valB = b[sortColumn] ?? '';
        if (valA < valB) return -1 * sortDirection;
        if (valA > valB) return 1 * sortDirection;
        return 0;
    });

    $: totalPages = Math.max(1, Math.ceil(sortedAgents.length / pageSize));
    $: if (currentPage > totalPages) currentPage = totalPages;
    $: paginatedAgents = sortedAgents.slice((currentPage - 1) * pageSize, currentPage * pageSize);

    // Reset to page 1 when data/search changes
    $: {
        const resetKey = `${searchTerm}::${agents.length}`;
        if (resetKey !== lastResetKey) {
            currentPage = 1;
            lastResetKey = resetKey;
        }
    }

    function toggleSort(key) {
        if (sortColumn === key) {
            sortDirection *= -1;
        } else {
            sortColumn = key;
            sortDirection = 1;
        }
    }

    function goToPage(page) {
        currentPage = Math.max(1, Math.min(page, totalPages));
    }

    $: pageRange = (() => {
        const range = [];
        const maxVisible = 5;
        let start = Math.max(1, currentPage - Math.floor(maxVisible / 2));
        let end = Math.min(totalPages, start + maxVisible - 1);
        if (end - start + 1 < maxVisible) {
            start = Math.max(1, end - maxVisible + 1);
        }
        for (let i = start; i <= end; i++) range.push(i);
        return range;
    })();
</script>

<div class="space-y-6">
    <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
            <h2 class="text-2xl font-bold tracking-tight text-slate-900">{title}</h2>
            {#if description}
                <p class="mt-1 text-sm text-slate-500">{description}</p>
            {/if}
        </div>
        <div class="relative w-full sm:max-w-sm">
            <div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                <svg class="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
            </div>
            <input
                type="text"
                bind:value={searchTerm}
                placeholder="Search agents..."
                class="block w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm placeholder-slate-400 shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
        </div>
    </div>

    <div class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div class="overflow-x-auto">
            <table class="w-full text-left text-sm border-collapse">
                <thead class="bg-slate-50 border-b border-slate-200">
                    <tr>
                        {#each columns as col}
                            <th
                                class="px-6 py-4 font-semibold text-slate-900 cursor-pointer select-none hover:bg-slate-100 transition-colors whitespace-nowrap"
                                on:click={() => toggleSort(col.key)}
                            >
                                <div class="flex items-center gap-1.5">
                                    {col.label}
                                    {#if sortColumn === col.key}
                                        <svg class="h-4 w-4 text-indigo-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            {#if sortDirection === 1}
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" />
                                            {:else}
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                                            {/if}
                                        </svg>
                                    {:else}
                                        <svg class="h-4 w-4 text-slate-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                                        </svg>
                                    {/if}
                                </div>
                            </th>
                        {/each}
                        <slot name="header-extra"></slot>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                    {#if loading}
                        {#each Array(5) as _}
                            <tr class="animate-pulse">
                                {#each columns as _}
                                    <td class="px-6 py-4">
                                        <div class="h-4 w-3/4 rounded bg-slate-100"></div>
                                    </td>
                                {/each}
                                <td class="px-6 py-4">
                                    <div class="h-4 w-12 rounded bg-slate-100"></div>
                                </td>
                            </tr>
                        {/each}
                    {:else if paginatedAgents.length === 0}
                        <tr>
                            <td colspan={columns.length + 1} class="px-6 py-16 text-center">
                                <div class="flex flex-col items-center gap-3">
                                    <svg class="h-12 w-12 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                    </svg>
                                    <p class="text-sm font-medium text-slate-500">No agents found matching your search.</p>
                                    {#if searchTerm}
                                        <button
                                            on:click={() => searchTerm = ''}
                                            class="text-xs font-semibold text-indigo-600 hover:text-indigo-500"
                                        >
                                            Clear search
                                        </button>
                                    {/if}
                                </div>
                            </td>
                        </tr>
                    {:else}
                        {#each paginatedAgents as agent (agent.id || agent.reraRegNo || agent.name)}
                            <tr class="hover:bg-slate-50/80 transition-colors group" in:fade={{ duration: 150 }}>
                                {#each columns as col}
                                    <td class="px-6 py-4 text-slate-600">
                                        {#if col.render}
                                            {@html col.render(agent[col.key], agent)}
                                        {:else}
                                            {agent[col.key] || 'N/A'}
                                        {/if}
                                    </td>
                                {/each}
                                <slot name="row-extra" {agent}></slot>
                            </tr>
                        {/each}
                    {/if}
                </tbody>
            </table>
        </div>

        {#if !loading && sortedAgents.length > 0}
            <div class="border-t border-slate-100 bg-slate-50 px-6 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p class="text-xs text-slate-500">
                    Showing <span class="font-semibold text-slate-700">{(currentPage - 1) * pageSize + 1}</span>
                    to <span class="font-semibold text-slate-700">{Math.min(currentPage * pageSize, sortedAgents.length)}</span>
                    of <span class="font-semibold text-slate-700">{sortedAgents.length}</span> agents
                    {#if searchTerm}
                        <span class="text-slate-400">(filtered from {agents.length})</span>
                    {/if}
                </p>

                {#if totalPages > 1}
                    <nav class="flex items-center gap-1" aria-label="Pagination">
                        <button
                            on:click={() => goToPage(currentPage - 1)}
                            disabled={currentPage === 1}
                            class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-sm text-slate-600 transition-colors hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed"
                            aria-label="Previous page"
                        >
                            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                            </svg>
                        </button>

                        {#if pageRange[0] > 1}
                            <button on:click={() => goToPage(1)} class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-200">1</button>
                            {#if pageRange[0] > 2}
                                <span class="px-1 text-slate-400">...</span>
                            {/if}
                        {/if}

                        {#each pageRange as page}
                            <button
                                on:click={() => goToPage(page)}
                                class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-xs font-medium transition-colors {page === currentPage ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-200'}"
                            >
                                {page}
                            </button>
                        {/each}

                        {#if pageRange[pageRange.length - 1] < totalPages}
                            {#if pageRange[pageRange.length - 1] < totalPages - 1}
                                <span class="px-1 text-slate-400">...</span>
                            {/if}
                            <button on:click={() => goToPage(totalPages)} class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-200">{totalPages}</button>
                        {/if}

                        <button
                            on:click={() => goToPage(currentPage + 1)}
                            disabled={currentPage === totalPages}
                            class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-sm text-slate-600 transition-colors hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed"
                            aria-label="Next page"
                        >
                            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                            </svg>
                        </button>
                    </nav>
                {/if}
            </div>
        {/if}
    </div>
</div>
