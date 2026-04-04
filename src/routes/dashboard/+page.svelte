<script>
	export let data;

	// ── state ──────────────────────────────────────────────────────────────────
	let companies = data.companies.map((c) => ({ ...c }));
	let searchTerm = '';
	let currentPage = 1;
	const PER_PAGE = 25;

	// modal state
	let editOpen = false;
	let deleteOpen = false;
	let editor = {};
	let deleteTarget = null;
	let deleteStep = 0;

	// save state
	let saving = false;
	let saveMsg = '';

	// ── derived ────────────────────────────────────────────────────────────────
	$: filtered = companies.filter((c) => {
		const q = searchTerm.toLowerCase().trim();
		if (!q) return true;
		return (
			(c.name ?? '').toLowerCase().includes(q) ||
			(c.reraRegNo ?? '').toLowerCase().includes(q) ||
			(c.district ?? '').toLowerCase().includes(q) ||
			(c.address ?? '').toLowerCase().includes(q) ||
			(c.legalType ?? '').toLowerCase().includes(q)
		);
	});

	$: totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
	$: if (currentPage > totalPages) currentPage = totalPages;
	$: startIdx = (currentPage - 1) * PER_PAGE;
	$: page = filtered.slice(startIdx, startIdx + PER_PAGE);

	$: pages = (() => {
		const max = 5;
		let s = Math.max(1, currentPage - 2);
		let e = Math.min(totalPages, s + max - 1);
		if (e - s < max - 1) s = Math.max(1, e - max + 1);
		const arr = [];
		for (let i = s; i <= e; i++) arr.push(i);
		return arr;
	})();

	// ── helpers ────────────────────────────────────────────────────────────────
	function go(n) {
		if (n >= 1 && n <= totalPages) currentPage = n;
	}

	function openEdit(company) {
		editor = JSON.parse(JSON.stringify(company));
		editOpen = true;
	}

	function saveEdit() {
		companies = companies.map((c) => (c._id === editor._id ? { ...editor } : c));
		editOpen = false;
		saveMsg = 'Edited locally. Click "Save to file" to persist.';
	}

	function openDelete(company) {
		deleteTarget = company;
		deleteStep = 1;
		deleteOpen = true;
	}

	function confirmDelete() {
		if (deleteStep === 1) { deleteStep = 2; return; }
		companies = companies.filter((c) => c._id !== deleteTarget._id);
		deleteOpen = false;
		deleteTarget = null;
		saveMsg = 'Deleted locally. Click "Save to file" to persist.';
	}

	function cancelDelete() {
		deleteOpen = false;
		deleteTarget = null;
	}

	async function saveToFile() {
		saving = true;
		saveMsg = '';
		try {
			const res = await fetch('/dashboard/save', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ companies })
			});
			if (!res.ok) throw new Error(await res.text());
			saveMsg = 'File saved successfully!';
		} catch (err) {
			saveMsg = 'Save failed: ' + err.message;
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head><title>UP Builders Dashboard</title></svelte:head>

<!-- ── PAGE ──────────────────────────────────────────────────────────────────── -->
<div class="min-h-screen bg-slate-50 py-8">
	<div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">

		<!-- Header -->
		<div class="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
			<div>
				<h1 class="text-2xl font-bold text-slate-900">UP Builders Dashboard</h1>
				<p class="mt-1 text-sm text-slate-500">{companies.length} total builders · {filtered.length} shown</p>
			</div>
			<div class="flex items-center gap-3">
				{#if saveMsg}
					<span class="text-sm {saveMsg.startsWith('Save failed') ? 'text-red-600' : 'text-emerald-600'}">{saveMsg}</span>
				{/if}
				<button
					type="button"
					on:click={saveToFile}
					disabled={saving}
					class="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
				>
					{saving ? 'Saving…' : 'Save to file'}
				</button>
			</div>
		</div>

		<!-- Search -->
		<div class="mb-6">
			<input
				id="search"
				type="text"
				bind:value={searchTerm}
				on:input={() => (currentPage = 1)}
				placeholder="Search by name, RERA number, district, address, or type…"
				class="w-full rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm text-slate-900 shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
			/>
		</div>

		<!-- Stats row -->
		<div class="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
			{#each [
				{ label: 'Total builders', value: companies.length },
				{ label: 'Filtered', value: filtered.length },
				{ label: 'Page', value: currentPage + ' / ' + totalPages },
				{ label: 'Per page', value: PER_PAGE }
			] as stat}
				<div class="rounded-2xl bg-white px-5 py-4 shadow-sm">
					<p class="text-xs text-slate-400">{stat.label}</p>
					<p class="mt-1 text-xl font-bold text-slate-900">{stat.value}</p>
				</div>
			{/each}
		</div>

		<!-- Table -->
		<div class="overflow-x-auto rounded-2xl bg-white shadow-sm">
			{#if page.length === 0}
				<div class="py-16 text-center text-slate-400">No builders match your search.</div>
			{:else}
				<table class="w-full text-sm">
					<thead class="border-b border-slate-100 bg-slate-50 text-xs font-semibold uppercase tracking-widest text-slate-500">
						<tr>
							<th class="px-4 py-3 text-left">#</th>
							<th class="px-4 py-3 text-left">Builder Name</th>
							<th class="px-4 py-3 text-left">RERA No.</th>
							<th class="px-4 py-3 text-left">Type</th>
							<th class="px-4 py-3 text-left">District</th>
							<th class="px-4 py-3 text-left">Mobile</th>
							<th class="px-4 py-3 text-left">Email</th>
							<th class="px-4 py-3 text-left">Actions</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-100">
						{#each page as company, i}
							<tr class="hover:bg-slate-50">
								<td class="px-4 py-3 text-slate-400">{startIdx + i + 1}</td>
								<td class="px-4 py-3 font-medium text-slate-900">
									{company.name}
									{#if company.website}
										<a href={company.website} target="_blank" rel="noopener noreferrer" class="ml-1 text-indigo-500 hover:underline text-xs">↗</a>
									{/if}
								</td>
								<td class="px-4 py-3 font-mono text-slate-600">{company.reraRegNo}</td>
								<td class="px-4 py-3">
									{#if company.legalType}
										<span class="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">{company.legalType}</span>
									{:else}
										<span class="text-slate-300">—</span>
									{/if}
								</td>
								<td class="px-4 py-3 text-slate-600">{company.district ?? '—'}</td>
								<td class="px-4 py-3 text-slate-600">{company.contact?.mobile ?? '—'}</td>
								<td class="px-4 py-3 text-slate-600 max-w-[180px] truncate">{company.contact?.email ?? '—'}</td>
								<td class="px-4 py-3">
									<div class="flex gap-2">
										<button
											type="button"
											on:click={() => openEdit(company)}
											class="rounded-lg bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
										>Edit</button>
										<button
											type="button"
											on:click={() => openDelete(company)}
											class="rounded-lg bg-red-50 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-100"
										>Delete</button>
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</div>

		<!-- Pagination -->
		{#if totalPages > 1}
			<div class="mt-5 flex flex-wrap items-center justify-between gap-3">
				<p class="text-sm text-slate-500">
					Showing {startIdx + 1}–{Math.min(startIdx + PER_PAGE, filtered.length)} of {filtered.length}
				</p>
				<div class="flex flex-wrap gap-2">
					<button
						type="button"
						on:click={() => go(currentPage - 1)}
						disabled={currentPage === 1}
						class="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
					>← Prev</button>

					{#each pages as p}
						<button
							type="button"
							on:click={() => go(p)}
							class={p === currentPage
								? 'rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white'
								: 'rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50'}
						>{p}</button>
					{/each}

					<button
						type="button"
						on:click={() => go(currentPage + 1)}
						disabled={currentPage === totalPages}
						class="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
					>Next →</button>
				</div>
			</div>
		{/if}

	</div><!-- /max-w -->
</div><!-- /page -->


<!-- ── EDIT MODAL ─────────────────────────────────────────────────────────────── -->
{#if editOpen}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
		<div class="w-full max-w-2xl overflow-hidden rounded-3xl bg-white shadow-2xl">

			<div class="flex items-center justify-between border-b border-slate-100 px-6 py-4">
				<h2 class="text-lg font-bold text-slate-900">Edit Builder</h2>
				<button type="button" on:click={() => (editOpen = false)} class="text-slate-400 hover:text-slate-700 text-xl font-bold">✕</button>
			</div>

			<div class="max-h-[65vh] overflow-y-auto p-6">
				<div class="grid gap-4 sm:grid-cols-2">

					<div>
						<label for="edit-name" class="block text-xs font-semibold text-slate-500 mb-1">Name</label>
						<input id="edit-name" type="text" bind:value={editor.name}
							class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none" />
					</div>

					<div>
						<label for="edit-rera" class="block text-xs font-semibold text-slate-500 mb-1">RERA Reg No.</label>
						<input id="edit-rera" type="text" bind:value={editor.reraRegNo}
							class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none" />
					</div>

					<div>
						<label for="edit-legal" class="block text-xs font-semibold text-slate-500 mb-1">Legal Type</label>
						<input id="edit-legal" type="text" bind:value={editor.legalType}
							class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none" />
					</div>

					<div>
						<label for="edit-district" class="block text-xs font-semibold text-slate-500 mb-1">District</label>
						<input id="edit-district" type="text" bind:value={editor.district}
							class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none" />
					</div>

					<div class="sm:col-span-2">
						<label for="edit-address" class="block text-xs font-semibold text-slate-500 mb-1">Address</label>
						<textarea id="edit-address" rows="2" bind:value={editor.address}
							class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none resize-none"></textarea>
					</div>

					<div>
						<label for="edit-mobile" class="block text-xs font-semibold text-slate-500 mb-1">Mobile</label>
						<input id="edit-mobile" type="text"
							value={editor.contact?.mobile ?? ''}
							on:input={(e) => (editor = { ...editor, contact: { ...(editor.contact ?? {}), mobile: e.target.value } })}
							class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none" />
					</div>

					<div>
						<label for="edit-email" class="block text-xs font-semibold text-slate-500 mb-1">Email</label>
						<input id="edit-email" type="email"
							value={editor.contact?.email ?? ''}
							on:input={(e) => (editor = { ...editor, contact: { ...(editor.contact ?? {}), email: e.target.value } })}
							class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none" />
					</div>

					<div>
						<label for="edit-pan" class="block text-xs font-semibold text-slate-500 mb-1">PAN</label>
						<input id="edit-pan" type="text" bind:value={editor.pan}
							class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none" />
					</div>

					<div>
						<label for="edit-gstin" class="block text-xs font-semibold text-slate-500 mb-1">GSTIN</label>
						<input id="edit-gstin" type="text" bind:value={editor.gstin}
							class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none" />
					</div>

					<div class="sm:col-span-2">
						<label for="edit-website" class="block text-xs font-semibold text-slate-500 mb-1">Website</label>
						<input id="edit-website" type="text" bind:value={editor.website}
							class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none" />
					</div>

				</div>
			</div>

			<div class="flex justify-end gap-3 border-t border-slate-100 px-6 py-4">
				<button type="button" on:click={() => (editOpen = false)}
					class="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
					Cancel
				</button>
				<button type="button" on:click={saveEdit}
					class="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
					Save changes
				</button>
			</div>

		</div>
	</div>
{/if}


<!-- ── DELETE MODAL ───────────────────────────────────────────────────────────── -->
{#if deleteOpen && deleteTarget}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
		<div class="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl">

			<div class="border-b border-slate-100 px-6 py-4">
				<h2 class="text-lg font-bold text-slate-900">Delete Builder</h2>
				<p class="mt-1 text-sm text-slate-500">
					{deleteStep === 1 ? 'Step 1 of 2 — please confirm.' : 'Step 2 of 2 — this cannot be undone.'}
				</p>
			</div>

			<div class="p-6">
				<div class="rounded-2xl bg-slate-50 p-4 text-sm">
					<p class="font-semibold text-slate-900">{deleteTarget.name}</p>
					<p class="mt-1 text-slate-500">{deleteTarget.reraRegNo}</p>
				</div>
				{#if deleteStep === 2}
					<p class="mt-4 text-sm font-semibold text-red-600">Are you absolutely sure? This builder will be permanently removed from the list.</p>
				{/if}
			</div>

			<div class="flex justify-end gap-3 border-t border-slate-100 px-6 py-4">
				<button type="button" on:click={cancelDelete}
					class="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
					Cancel
				</button>
				<button type="button" on:click={confirmDelete}
					class={deleteStep === 1
						? 'rounded-xl bg-orange-500 px-5 py-2 text-sm font-semibold text-white hover:bg-orange-600'
						: 'rounded-xl bg-red-600 px-5 py-2 text-sm font-semibold text-white hover:bg-red-700'}>
					{deleteStep === 1 ? 'Continue' : 'Delete permanently'}
				</button>
			</div>

		</div>
	</div>
{/if}
