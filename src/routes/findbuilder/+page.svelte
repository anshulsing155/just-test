<script>
	import rawPincodeData from '$lib/data/pincode_IN_all.json';
	import buildersData from '$lib/data/builders/builders.json';

	const pincodeData = rawPincodeData?.keys ?? rawPincodeData ?? {};
	const zoneModules = import.meta.glob('../../lib/data/zone/**/*.json', { eager: true });
	const projectModules = import.meta.glob('../../lib/data/Projects/*.json', { eager: true });

	const zoneLibrary = buildZoneLibrary();
	const projectLibrary = buildProjectLibrary();

	let selectedState = '';
	let selectedDistrict = '';
	let selectedZone = '';
	let selectedBuilder = '';
	let selectedProject = '';

	$: states = Object.keys(pincodeData).sort((a, b) => a.localeCompare(b));
	$: districts = selectedState
		? Object.keys(pincodeData[selectedState] ?? {}).sort((a, b) => a.localeCompare(b))
		: [];
	$: zoneEntries = getZonesForSelection(selectedState, selectedDistrict);
	$: zoneOptions = zoneEntries.map((zone) => zone.name).filter(Boolean);
	$: zoneDataAvailable = selectedState && selectedDistrict && zoneOptions.length > 0;
	$: selectedZoneData = zoneEntries.find((zone) => zone.name === selectedZone) ?? null;
	$: selectedZonePincodes = (selectedZoneData?.pincodes ?? []).map((pincode) => String(pincode));
	$: stateProjects = getProjectsForState(selectedState);
	$: zoneProjects = getProjectsForZone(stateProjects, selectedZonePincodes);
	$: zoneBuilderOptions = getBuildersForProjects(zoneProjects);
	$: selectedBuilderProjects = getProjectsForBuilder(zoneProjects, selectedBuilder);

	function normalizeSegment(value = '') {
		return String(value)
			.trim()
			.toLowerCase()
			.replace(/&/g, 'and')
			.replace(/[^a-z0-9]+/g, '_')
			.replace(/^_+|_+$/g, '');
	}

	function normalizeStateFolder(value = '') {
		const normalized = normalizeSegment(value);
		const stateAliases = {
			uttar_pradesh: 'uttarpardesh',
			uttarpradesh: 'uttarpardesh'
		};

		return stateAliases[normalized] ?? normalized;
	}

	function buildZoneLibrary() {
		const lookup = {};

		for (const [path, moduleValue] of Object.entries(zoneModules)) {
			const data = moduleValue?.default ?? moduleValue ?? {};
			const match = path.match(/zone\/([^/]+)\/([^/]+)\.json$/);
			if (!match) continue;

			const [, rawStateFolder, rawDistrictFile] = match;
			const stateKey = normalizeStateFolder(rawStateFolder);
			const districtKey = normalizeSegment(rawDistrictFile);
			const zoneEntries = Array.isArray(data?.zones) ? data.zones.filter(Boolean) : [];

			if (!lookup[stateKey]) {
				lookup[stateKey] = {};
			}

			lookup[stateKey][districtKey] = zoneEntries;

			const dataStateKey = normalizeStateFolder(data?.state ?? '');
			const dataDistrictKey = normalizeSegment(data?.district ?? '');

			if (dataStateKey && dataDistrictKey) {
				if (!lookup[dataStateKey]) {
					lookup[dataStateKey] = {};
				}
				lookup[dataStateKey][dataDistrictKey] = zoneEntries;
			}
		}

		return lookup;
	}

	function buildProjectLibrary() {
		const lookup = {};

		for (const [path, moduleValue] of Object.entries(projectModules)) {
			const projects = moduleValue?.default ?? moduleValue ?? [];
			const match = path.match(/Projects\/([^/]+)\.json$/);
			if (!match) continue;

			const fileName = match[1];
			const statePart = fileName.replace(/_projects$/i, '');
			const stateKey = normalizeStateFolder(statePart);

			lookup[stateKey] = Array.isArray(projects) ? projects : [];
		}

		return lookup;
	}

	function getZonesForSelection(state, district) {
		if (!state || !district) return [];

		const stateKey = normalizeStateFolder(state);
		const districtKey = normalizeSegment(district);

		return zoneLibrary[stateKey]?.[districtKey] ?? [];
	}

	function getProjectsForState(state) {
		if (!state) return [];
		const stateKey = normalizeStateFolder(state);
		return projectLibrary[stateKey] ?? [];
	}

	function getProjectsForZone(projects, zonePincodes) {
		if (!projects.length || !zonePincodes.length) return [];

		const pincodeSet = new Set(zonePincodes);
		return projects.filter((project) => {
			if (!project?.builderId || project?.pincode == null) return false;
			return pincodeSet.has(String(project.pincode));
		});
	}

	function getBuildersForProjects(projects) {
		const builderMap = new Map();

		for (const project of projects) {
			const builderId = project?.builderId;
			if (!builderId || builderMap.has(builderId)) continue;

			const builder = buildersData?.[builderId];
			if (!builder) continue;

			builderMap.set(builderId, {
				id: builderId,
				name: builder.name || builderId,
				projectCount: 0
			});
		}

		for (const project of projects) {
			const builderEntry = builderMap.get(project?.builderId);
			if (builderEntry) {
				builderEntry.projectCount += 1;
			}
		}

		return Array.from(builderMap.values()).sort((a, b) => a.name.localeCompare(b.name));
	}

	function getProjectsForBuilder(projects, builderId) {
		if (!builderId) return [];

		return projects
			.filter((project) => project?.builderId === builderId)
			.sort((a, b) => (a?.name || '').localeCompare(b?.name || ''));
	}

	function handleStateChange() {
		selectedDistrict = '';
		selectedZone = '';
		selectedBuilder = '';
		selectedProject = '';
	}

	function handleDistrictChange() {
		selectedZone = '';
		selectedBuilder = '';
		selectedProject = '';
	}

	function handleZoneChange() {
		selectedBuilder = '';
		selectedProject = '';
	}

	function handleBuilderChange() {
		selectedProject = '';
	}
</script>

<svelte:head>
	<title>Find Builder - RERA Toolkit</title>
</svelte:head>

<div class="min-h-screen bg-slate-50">
	<section class="mx-auto max-w-5xl px-4 py-10 sm:px-6">
		<div class="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-xl shadow-slate-200/70">
			<div class="bg-gradient-to-r from-slate-900 via-slate-800 to-sky-800 px-6 py-10 text-white sm:px-10">
				<p class="text-sm font-semibold uppercase tracking-[0.24em] text-sky-200">Find Builder</p>
				<h1 class="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">State, district aur zone ke basis par selection</h1>
				<p class="mt-3 max-w-2xl text-sm leading-6 text-slate-200 sm:text-base">
					Pehle state select karo, phir us state ka district, aur uske baad available zone names.
				</p>
			</div>

			<div class="space-y-8 px-6 py-8 sm:px-10">
				<div class="grid gap-5 md:grid-cols-5">
					<div class="space-y-2">
						<label class="text-sm font-semibold text-slate-700" for="state-select">State</label>
						<select
							id="state-select"
							class="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-sky-500 focus:bg-white"
							bind:value={selectedState}
							on:change={handleStateChange}
						>
							<option value="">Select state</option>
							{#each states as state}
								<option value={state}>{state}</option>
							{/each}
						</select>
					</div>

					<div class="space-y-2">
						<label class="text-sm font-semibold text-slate-700" for="district-select">District</label>
						<select
							id="district-select"
							class="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-sky-500 focus:bg-white disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
							bind:value={selectedDistrict}
							on:change={handleDistrictChange}
							disabled={!selectedState}
						>
							<option value="">Select district</option>
							{#each districts as district}
								<option value={district}>{district}</option>
							{/each}
						</select>
					</div>

					<div class="space-y-2">
						<label class="text-sm font-semibold text-slate-700" for="zone-select">Zone</label>
						<select
							id="zone-select"
							class="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-sky-500 focus:bg-white disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
							bind:value={selectedZone}
							on:change={handleZoneChange}
							disabled={!selectedDistrict || !zoneOptions.length}
						>
							<option value="">
								{#if !selectedDistrict}
									Select district first
								{:else if zoneOptions.length}
									Select zone
								{:else}
									No zones available
								{/if}
							</option>
							{#each zoneOptions as zone}
								<option value={zone}>{zone}</option>
							{/each}
						</select>
					</div>

					<div class="space-y-2">
						<label class="text-sm font-semibold text-slate-700" for="builder-select">Builder</label>
						<select
							id="builder-select"
							class="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-sky-500 focus:bg-white disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
							bind:value={selectedBuilder}
							on:change={handleBuilderChange}
							disabled={!selectedZone || !zoneBuilderOptions.length}
						>
							<option value="">
								{#if !selectedZone}
									Select zone first
								{:else if zoneBuilderOptions.length}
									Select builder
								{:else}
									No builders available
								{/if}
							</option>
							{#each zoneBuilderOptions as builder}
								<option value={builder.id}>{builder.name}</option>
							{/each}
						</select>
					</div>

					<div class="space-y-2">
						<label class="text-sm font-semibold text-slate-700" for="project-select">Project</label>
						<select
							id="project-select"
							class="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-sky-500 focus:bg-white disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
							bind:value={selectedProject}
							disabled={!selectedBuilder || !selectedBuilderProjects.length}
						>
							<option value="">
								{#if !selectedBuilder}
									Select builder first
								{:else if selectedBuilderProjects.length}
									Select project
								{:else}
									No projects available
								{/if}
							</option>
							{#each selectedBuilderProjects as project}
								<option value={project.id}>{project.name}</option>
							{/each}
						</select>
					</div>
				</div>

				<div class="grid gap-4 rounded-3xl border border-slate-200 bg-slate-50 p-5 md:grid-cols-5">
					<div class="rounded-2xl bg-white p-4 shadow-sm shadow-slate-200/60">
						<p class="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Selected State</p>
						<p class="mt-2 text-lg font-bold text-slate-900">{selectedState || '-'}</p>
					</div>
					<div class="rounded-2xl bg-white p-4 shadow-sm shadow-slate-200/60">
						<p class="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Selected District</p>
						<p class="mt-2 text-lg font-bold text-slate-900">{selectedDistrict || '-'}</p>
					</div>
					<div class="rounded-2xl bg-white p-4 shadow-sm shadow-slate-200/60">
						<p class="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Selected Zone</p>
						<p class="mt-2 text-lg font-bold text-slate-900">{selectedZone || '-'}</p>
					</div>
					<div class="rounded-2xl bg-white p-4 shadow-sm shadow-slate-200/60">
						<p class="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Selected Builder</p>
						<p class="mt-2 text-lg font-bold text-slate-900">
							{zoneBuilderOptions.find((builder) => builder.id === selectedBuilder)?.name || '-'}
						</p>
					</div>
					<div class="rounded-2xl bg-white p-4 shadow-sm shadow-slate-200/60">
						<p class="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Selected Project</p>
						<p class="mt-2 text-lg font-bold text-slate-900">
							{selectedBuilderProjects.find((project) => project.id === selectedProject)?.name || '-'}
						</p>
					</div>
				</div>

				{#if selectedState && selectedDistrict && !zoneDataAvailable}
					<div class="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
						Is district ke liye zone file abhi available nahi hai.
					</div>
				{/if}

				{#if zoneDataAvailable}
					<div class="rounded-3xl border border-emerald-200 bg-emerald-50/70 p-5">
						<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
							<div>
								<p class="text-sm font-semibold text-emerald-800">Available zones</p>
								<p class="text-sm text-emerald-700">{zoneOptions.length} zones found for this district</p>
							</div>
						</div>

						<div class="mt-4 flex flex-wrap gap-2">
							{#each zoneOptions as zone}
								<span class="rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-sm font-medium text-emerald-800">
									{zone}
								</span>
							{/each}
						</div>
					</div>
				{/if}

				{#if selectedZone}
					<div class="grid gap-4 md:grid-cols-3">
						<div class="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/60">
							<p class="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Zone Pincodes</p>
							<p class="mt-2 text-2xl font-bold text-slate-900">{selectedZonePincodes.length}</p>
						</div>
						<div class="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/60">
							<p class="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Builders In Zone</p>
							<p class="mt-2 text-2xl font-bold text-slate-900">{zoneBuilderOptions.length}</p>
						</div>
						<div class="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/60">
							<p class="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Projects In Zone</p>
							<p class="mt-2 text-2xl font-bold text-slate-900">{zoneProjects.length}</p>
						</div>
					</div>
				{/if}

				{#if selectedZone && !stateProjects.length}
					<div class="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
						Is state ke liye projects file abhi available nahi hai.
					</div>
				{/if}
			</div>
		</div>
	</section>
</div>
