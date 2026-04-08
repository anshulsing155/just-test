<script>
	import pincodeData from '$lib/data/pincode_IN_all.json';
	import companyData from "$lib/data/companies_with_projects_2026-04-06T06-27-43-033Z.json"
		import projectsData from "$lib/data/projects_UP_only_2026-04-04T12-00-45-596Z.json"
	import bankNames from '$lib/data/tempBankNames.json';


	const UP_DISTRICTS = Object.keys(pincodeData['Uttar Pradesh']).sort();

	export let data;

	let result = projectsData.length
	

	$:console.log(result,"result")

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

	// projects modal state
	let projectsOpen = false;
	let projectsTarget = null;
	let addProjectOpen = false;
	let newProject = { reraRegNo: '', name: '', district: '', projectType: '', constructionStatus: '' };

	// project inline-edit state
	let editingProjectIdx = null;
	let editingProject = {};
	let removeConfirmIdx = null;
	let lenderBankSelection = '';

	function normalizeLenderNames(value) {
		if (Array.isArray(value)) return value;
		if (typeof value === 'string' && value.trim()) return [value.trim()];
		return [];
	}

	function getAvailableBanks(selectedBanks = []) {
		const selected = new Set(normalizeLenderNames(selectedBanks));
		return bankNames.filter((bank) => !selected.has(bank));
	}

	function openProjectEdit(idx, project) {
		editingProjectIdx = idx;
		editingProject = { ...project, lenderName: normalizeLenderNames(project.lenderName) };
		lenderBankSelection = '';
		addProjectOpen = false;
	}

	function addLenderBank(bank) {
		if (!bank) return;
		const selectedBanks = normalizeLenderNames(editingProject.lenderName);
		if (selectedBanks.includes(bank)) return;

		editingProject = {
			...editingProject,
			lenderName: [...selectedBanks, bank]
		};
		lenderBankSelection = '';
	}

	function removeLenderBank(bank) {
		editingProject = {
			...editingProject,
			lenderName: normalizeLenderNames(editingProject.lenderName).filter((item) => item !== bank)
		};
	}

	function saveProjectEdit() {
		companies = companies.map((c) =>
			c._id === projectsTarget._id
				? { ...c, projects: c.projects.map((p, i) => (i === editingProjectIdx ? { ...editingProject } : p)) }
				: c
		);
		projectsTarget = companies.find((c) => c._id === projectsTarget._id);
		editingProjectIdx = null;
		editingProject = {};
		lenderBankSelection = '';
		saveMsg = 'Project updated locally. Click "Save to file" to persist.';
	}

	function openProjects(company) {
		projectsTarget = company;
		projectsOpen = true;
		addProjectOpen = false;
		editingProjectIdx = null;
		editingProject = {};
		removeConfirmIdx = null;
		newProject = { reraRegNo: '', name: '', district: '', projectType: '', constructionStatus: '' };
	}

	function addProject() {
		if (!newProject.name.trim()) return;
		companies = companies.map((c) =>
			c._id === projectsTarget._id
				? { ...c, projects: [...(c.projects ?? []), { ...newProject, _id: Date.now().toString() }] }
				: c
		);
		projectsTarget = companies.find((c) => c._id === projectsTarget._id);
		newProject = { reraRegNo: '', name: '', district: '', projectType: '', constructionStatus: '' };
		addProjectOpen = false;
		saveMsg = 'Project added locally. Click "Save to file" to persist.';
	}

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
	<div class="mx-auto 	 px-4 sm:px-6 lg:px-8">

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
		<div class="rounded-2xl bg-white shadow-sm">
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
							<th class="px-4 py-3 text-left">Email</th>						<th class="px-4 py-3 text-left">Projects</th>							<th class="px-4 py-3 text-left">Actions</th>
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
								<td class="px-4 py-3">								{#if (company.projects ?? []).length > 0}
									<span class="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
										{company.projects.length}
									</span>
								{:else}
									<span class="text-slate-300 text-xs">0</span>
								{/if}
							</td>
							<td class="px-4 py-3">									<div class="flex gap-2">
										<button
											type="button"
											on:click={() => openEdit(company)}
											class="rounded-lg bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
										>Edit</button>
										<button
											type="button"
											on:click={() => openDelete(company)}
											class="rounded-lg bg-red-50 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-100"
										>Delete</button>									<button
										type="button"
										on:click={() => openProjects(company)}
										class="rounded-lg bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
									>Projects</button>									</div>
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


<!-- ── PROJECTS MODAL ───────────────────────────────────────────────────────────── -->
{#if projectsOpen && projectsTarget}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
		<div class="w-full max-w-2xl overflow-hidden rounded-3xl bg-white shadow-2xl">

			<div class="flex items-center justify-between border-b border-slate-100 px-6 py-4">
				<div>
					<h2 class="text-lg font-bold text-slate-900">Projects</h2>
					<p class="mt-0.5 text-xs text-slate-500">{projectsTarget.name}</p>
				</div>
				<div class="flex items-center gap-3">
					<button
						type="button"
						on:click={() => (addProjectOpen = true)}
						class="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
					>+ Add Project</button>
					<button type="button" on:click={() => { projectsOpen = false; addProjectOpen = false; }} class="text-slate-400 hover:text-slate-700 text-xl font-bold">✕</button>
				</div>
			</div>

			<!-- Add Project Form -->
			{#if addProjectOpen}
				<div class="border-b border-slate-100 bg-emerald-50 px-6 py-5">
					<h3 class="mb-3 text-sm font-bold text-slate-800">New Project</h3>
					<div class="grid gap-3 sm:grid-cols-2">
						<div>
							<label class="block text-xs font-semibold text-slate-500 mb-1">Project Name <span class="text-red-500">*</span></label>
							<input type="text" bind:value={newProject.name}
								placeholder="e.g. Green Valley Heights"
								class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 outline-none" />
						</div>
						<div>
							<label class="block text-xs font-semibold text-slate-500 mb-1">RERA Reg No.</label>
							<input type="text" bind:value={newProject.reraRegNo}
								placeholder="e.g. UPRERAPRJ12345"
								class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 outline-none" />
						</div>
						<div>
							<label class="block text-xs font-semibold text-slate-500 mb-1">District</label>
							<select bind:value={newProject.district}
								class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 outline-none bg-white">
								<option value="">Select district…</option>
								{#each UP_DISTRICTS as district}
									<option value={district}>{district}</option>
								{/each}
							</select>
						</div>
						<div>
							<label class="block text-xs font-semibold text-slate-500 mb-1">Project Type</label>
							<select bind:value={newProject.projectType}
								class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 outline-none bg-white">
								<option value="">Select type…</option>
								<option value="Residential">Residential</option>
								<option value="Commercial">Commercial</option>
								<option value="Villa">Villa</option>
								<option value="Plot">Plot</option>
							</select>
						</div>
						<div class="sm:col-span-2">
							<label class="block text-xs font-semibold text-slate-500 mb-1">Construction Status</label>
							<select bind:value={newProject.constructionStatus}
								class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 outline-none bg-white">
								<option value="">Select status…</option>
								<option value="Ready to Move">Ready to Move</option>
								<option value="Under Construction">Under Construction</option>
								<option value="Resale">Resale</option>
							</select>
						</div>
					</div>
					<div class="mt-4 flex justify-end gap-3">
						<button type="button" on:click={() => (addProjectOpen = false)}
							class="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">
							Cancel
						</button>
						<button type="button" on:click={addProject} disabled={!newProject.name.trim()}
							class="rounded-xl bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
							Add Project
						</button>
					</div>
				</div>
			{/if}

			<!-- Projects List -->
			<div class="max-h-[50vh] overflow-y-auto p-6">
				{#if (projectsTarget.projects ?? []).length === 0}
					<div class="py-10 text-center text-slate-400 text-sm">No projects added yet. Click "+ Add Project" to get started.</div>
				{:else}
					<div class="divide-y divide-slate-100">
						{#each projectsTarget.projects as project, idx}
							<div class="py-3">
								{#if editingProjectIdx === idx}
									<!-- Inline edit form -->
									<div class="rounded-2xl bg-indigo-50 p-4">
										<div class="grid gap-3 sm:grid-cols-2">
											<div>
												<label class="block text-xs font-semibold text-slate-500 mb-1">Project Name <span class="text-red-500">*</span></label>
												<input type="text" bind:value={editingProject.name}
													class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none" />
											</div>
											<div>
												<label class="block text-xs font-semibold text-slate-500 mb-1">RERA Reg No.</label>
												<input type="text" bind:value={editingProject.reraRegNo}
													class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none" />
											</div>
											<div>
												<label class="block text-xs font-semibold text-slate-500 mb-1">District</label>
												<select bind:value={editingProject.district}
													class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none bg-white">
													<option value="">Select district…</option>
													{#each UP_DISTRICTS as d}
														<option value={d}>{d}</option>
													{/each}
												</select>
											</div>
											<div>
												<label class="block text-xs font-semibold text-slate-500 mb-1">Project Type</label>
												<select bind:value={editingProject.projectType}
													class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none bg-white">
													<option value="">Select type…</option>
													<option value="Residential">Residential</option>
													<option value="Commercial">Commercial</option>
													<option value="Villa">Villa</option>
													<option value="Plot">Plot</option>
												</select>
											</div>
											<div class="sm:col-span-2">
												<label class="block text-xs font-semibold text-slate-500 mb-1">Construction Status</label>
												<select bind:value={editingProject.constructionStatus}
													class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none bg-white">
													<option value="">Select status…</option>
													<option value="Ready to Move">Ready to Move</option>
													<option value="Under Construction">Under Construction</option>
													<option value="Resale">Resale</option>
												</select>
											</div>
											<div class="sm:col-span-2">
												<label class="block text-xs font-semibold text-slate-500 mb-1">Lender Name</label>
												<div class="rounded-2xl border border-slate-200 bg-white p-3">
													<div class="mb-3 flex min-h-[44px] flex-wrap gap-2">
														{#each normalizeLenderNames(editingProject.lenderName) as bank}
															<span class="inline-flex items-center gap-2 rounded-full bg-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-700">
																{bank}
																<button
																	type="button"
																	on:click={() => removeLenderBank(bank)}
																	class="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white text-indigo-700 hover:bg-indigo-50"
																	aria-label={`Remove ${bank}`}
																>
																	×
																</button>
															</span>
														{/each}
														{#if !normalizeLenderNames(editingProject.lenderName).length}
															<p class="text-xs text-slate-400">No bank selected yet.</p>
														{/if}
													</div>
													<div class="flex gap-2">
														<select
															bind:value={lenderBankSelection}
															class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none bg-white"
														>
															<option value="">Select bank...</option>
															{#each getAvailableBanks(editingProject.lenderName) as bank}
																<option value={bank}>{bank}</option>
															{/each}
														</select>
														<button
															type="button"
															on:click={() => addLenderBank(lenderBankSelection)}
															disabled={!lenderBankSelection}
															class="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
														>
															Add
														</button>
													</div>
													<p class="mt-2 text-xs text-slate-400">Selected banks move into chips above. Remove a chip to add that bank back to the list.</p>
												</div>
											</div>
										</div>
										<div class="mt-3 flex justify-end gap-2">
											<button type="button" on:click={() => { editingProjectIdx = null; editingProject = {}; lenderBankSelection = ''; }}
												class="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100">
												Cancel
											</button>
											<button type="button" on:click={saveProjectEdit} disabled={!editingProject.name?.trim()}
												class="rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
												Save
											</button>
										</div>
									</div>
								{:else}
									<!-- View row -->
									<div class="flex items-start justify-between">
										<div>
											<p class="text-sm font-semibold text-slate-900">{project.name}</p>
											<div class="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
												{#if project.reraRegNo}<span class="font-mono">{project.reraRegNo}</span>{/if}
												{#if project.district}<span>· {project.district}</span>{/if}
												{#if project.projectType}<span class="rounded-full bg-indigo-50 px-2 py-0.5 font-medium text-indigo-700">{project.projectType}</span>{/if}
												{#if project.constructionStatus}<span class="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700">{project.constructionStatus}</span>{/if}
												{#if normalizeLenderNames(project.lenderName).length}
													<span class="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
														{normalizeLenderNames(project.lenderName).join(', ')}
													</span>
												{/if}
											</div>
										</div>
										<div class="ml-4 flex shrink-0 gap-2">
											<button
												type="button"
												on:click={() => { openProjectEdit(idx, project); removeConfirmIdx = null; }}
												class="rounded-lg bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
											>Edit</button>
											{#if removeConfirmIdx === idx}
												<button
													type="button"
													on:click={() => {
														companies = companies.map((c) =>
															c._id === projectsTarget._id
																? { ...c, projects: c.projects.filter((_, i) => i !== idx) }
																: c
														);
														projectsTarget = companies.find((c) => c._id === projectsTarget._id);
														removeConfirmIdx = null;
														saveMsg = 'Project removed locally. Click "Save to file" to persist.';
													}}
													class="rounded-lg bg-red-600 px-2 py-1 text-xs font-semibold text-white hover:bg-red-700"
												>Confirm?</button>
												<button
													type="button"
													on:click={() => (removeConfirmIdx = null)}
													class="rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200"
												>Cancel</button>
											{:else}
												<button
													type="button"
													on:click={() => { removeConfirmIdx = idx; editingProjectIdx = null; }}
													class="rounded-lg bg-red-50 px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-100"
												>Remove</button>
											{/if}
										</div>
									</div>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>

			<div class="flex justify-end border-t border-slate-100 px-6 py-4">
				<button type="button" on:click={() => { projectsOpen = false; addProjectOpen = false; }}
					class="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
					Close
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
