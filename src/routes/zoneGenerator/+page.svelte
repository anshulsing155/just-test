<script>
  import rawData from "$lib/data/pincode_IN_all.json";

  const data = rawData?.keys ?? rawData ?? {};

  let selectedMain = "";
  let selectedNested = "";
  let aiResponse = null;
  let zones = []; // mutable working copy
  let areaMap = {}; // from server
  let loading = false;
  let error = null;
  let copied = false;
  let savingToLib = false;
  let savedToLibMsg = "";

  // Dropdown search
  let mainSearch = "";
  let nestedSearch = "";

  $: mainKeys = Object.keys(data).sort();
  $: filteredMainKeys = mainKeys.filter((k) =>
    k.toLowerCase().includes(mainSearch.toLowerCase())
  );
  $: nestedKeys =
    selectedMain && data[selectedMain]
      ? Object.keys(data[selectedMain]).sort()
      : [];
  $: filteredNestedKeys = nestedKeys.filter((k) =>
    k.toLowerCase().includes(nestedSearch.toLowerCase())
  );

  // Input stats preview
  $: selectedAreaMap =
    selectedMain && selectedNested && data[selectedMain]?.[selectedNested]
      ? data[selectedMain][selectedNested]
      : null;
  $: previewAreaCount = selectedAreaMap ? Object.keys(selectedAreaMap).length : 0;
  $: previewPincodeCount = selectedAreaMap
    ? new Set(Object.values(selectedAreaMap)).size
    : 0;

  // ── CLIENT-SIDE VALIDATOR ─────────────────────────────────────────────────
  /**
   * Returns array of { area, pincode, suggestedZoneIdx }
   * for every area in areaMap that is missing from zones.
   */
  function computeMissing(zones, areaMap) {
    const assigned = new Set(zones.flatMap((z) => z.areas ?? []));
    const pincodeSeen = new Map();
    zones.forEach((z, i) => (z.pincodes ?? []).forEach((p) => {
      if (!pincodeSeen.has(p)) pincodeSeen.set(p, i);
    }));

    return Object.entries(areaMap)
      .filter(([area]) => !assigned.has(area))
      .map(([area, pincode]) => ({
        area,
        pincode,
        // suggest the zone that already owns this pincode, else zone with most areas
        suggestedZoneIdx:
          pincodeSeen.get(pincode) ??
          zones.reduce((best, z, i) =>
            (z.areas?.length ?? 0) > (zones[best]?.areas?.length ?? 0) ? i : best, 0),
        selectedZoneIdx: pincodeSeen.get(pincode) ??
          zones.reduce((best, z, i) =>
            (z.areas?.length ?? 0) > (zones[best]?.areas?.length ?? 0) ? i : best, 0),
      }));
  }

  $: missingItems = zones.length && Object.keys(areaMap).length
    ? computeMissing(zones, areaMap)
    : [];

  $: coveredAreas = zones.reduce((n, z) => n + (z.areas?.length ?? 0), 0);
  $: coveredPincodes = new Set(zones.flatMap((z) => z.pincodes ?? [])).size;
  $: isFullyCovered =
    coveredAreas === previewAreaCount && coveredPincodes === previewPincodeCount;

  // ── ASSIGNMENT HELPERS ────────────────────────────────────────────────────
  function assignOne(item) {
    const idx = item.selectedZoneIdx;
    if (idx == null || idx < 0 || idx >= zones.length) return;
    const zone = zones[idx];
    if (!zone.areas.includes(item.area)) zone.areas = [...zone.areas, item.area];
    if (!zone.pincodes.includes(item.pincode))
      zone.pincodes = [...zone.pincodes, item.pincode];
    zones = [...zones]; // trigger reactivity
  }

  function autoFixAll() {
    const pending = computeMissing(zones, areaMap);
    for (const item of pending) {
      const idx = item.suggestedZoneIdx;
      const zone = zones[idx];
      if (!zone.areas.includes(item.area)) zone.areas = [...zone.areas, item.area];
      if (!zone.pincodes.includes(item.pincode))
        zone.pincodes = [...zone.pincodes, item.pincode];
    }
    zones = [...zones];
  }

  // ── API CALL ──────────────────────────────────────────────────────────────
  async function sendData() {
    if (!selectedMain || !selectedNested) return;
    loading = true;
    error = null;
    aiResponse = null;
    zones = [];
    areaMap = {};
    copied = false;

    const payload = {
      [selectedMain]: { [selectedNested]: data[selectedMain][selectedNested] },
    };

    try {
      const res = await fetch("/api/zoneGenerator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: payload }),
      });
      const result = await res.json();
      if (!result.success) throw new Error(result.error || "API error");
      if (!result.output) throw new Error("No output received");

      aiResponse = result.output;
      areaMap = result.output._areaMap ?? {};
      zones = result.output.zones ?? [];
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
    }
  }

  function exportJSON() {
    const out = { ...aiResponse, zones };
    delete out._areaMap;
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `zones_${selectedMain}_${selectedNested}.json`.replace(/\s+/g, "_");
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copyJSON() {
    const out = { ...aiResponse, zones };
    delete out._areaMap;
    await navigator.clipboard.writeText(JSON.stringify(out, null, 2));
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }

  /** Save the current generated zones to the shared zone library so the
   *  dashboard (and other consumers) can filter projects by zone. */
  async function saveToLibrary() {
    if (!aiResponse || !zones.length) return;
    savingToLib = true;
    savedToLibMsg = "";
    try {
      const payload = {
        city: aiResponse.city,
        summary: aiResponse.summary,
        total_areas: previewAreaCount,
        total_pincodes: previewPincodeCount,
        zones, // working copy with manual fixes applied
      };
      const res = await fetch("/api/zones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          state: aiResponse.state || selectedMain,
          district: aiResponse.district || selectedNested,
          payload,
        }),
      });
      const result = await res.json();
      if (!result.success) throw new Error(result.error || "Save failed");
      savedToLibMsg = `✓ Saved ${result.zoneCount} zones to library`;
      setTimeout(() => (savedToLibMsg = ""), 4000);
    } catch (err) {
      savedToLibMsg = `✗ ${err.message}`;
    } finally {
      savingToLib = false;
    }
  }

  function localityColor(type) {
    const map = {
      urban: "bg-blue-100 text-blue-800",
      suburban: "bg-green-100 text-green-800",
      rural: "bg-yellow-100 text-yellow-800",
      industrial: "bg-orange-100 text-orange-800",
      commercial: "bg-purple-100 text-purple-800",
      mixed: "bg-gray-100 text-gray-800",
    };
    return map[type?.toLowerCase()] ?? "bg-gray-100 text-gray-700";
  }

  function libMsgClass(msg) {
    return msg.startsWith("✓") ? "text-emerald-600" : "text-red-600";
  }

  function priorityColor(p) {
    if (p <= 3) return "bg-indigo-600 text-white";
    if (p <= 6) return "bg-indigo-400 text-white";
    return "bg-indigo-200 text-indigo-800";
  }
</script>

<div class="min-h-screen bg-gray-50 p-6">
  <div class="mx-auto max-w-7xl">

    <!-- Header -->
    <div class="mb-8">
      <h1 class="text-3xl font-bold text-gray-900">Zone Generator</h1>
      <p class="mt-1 text-sm text-gray-500">
        Select a state and district to generate AI-powered real estate zones
      </p>
    </div>

    <!-- Top panel -->
    <div class="grid grid-cols-1 gap-6 lg:grid-cols-3">

      <!-- Selection card -->
      <div class="rounded-2xl bg-white p-6 shadow-sm border border-gray-100">
        <h2 class="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">Select Region</h2>

        <!-- State -->
        <div class="mb-4">
          <label for="state-select" class="mb-1 block text-xs font-medium text-gray-600">State</label>
          <input type="text" placeholder="Search state..." bind:value={mainSearch}
            class="mb-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none" />
          <select id="state-select" bind:value={selectedMain} on:change={() => { selectedNested = ""; nestedSearch = ""; }}
            size="5" class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none">
            <option value="">— Select State —</option>
            {#each filteredMainKeys as key}<option value={key}>{key}</option>{/each}
          </select>
        </div>

        <!-- District -->
        <div class="mb-4">
          <label for="district-select" class="mb-1 block text-xs font-medium text-gray-600">District</label>
          <input type="text" placeholder="Search district..." bind:value={nestedSearch} disabled={!selectedMain}
            class="mb-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400" />
          <select id="district-select" bind:value={selectedNested} disabled={!selectedMain} size="5"
            class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none disabled:bg-gray-50">
            <option value="">— Select District —</option>
            {#each filteredNestedKeys as key}<option value={key}>{key}</option>{/each}
          </select>
        </div>

        {#if selectedAreaMap}
          <div class="mb-4 rounded-xl bg-indigo-50 p-3 text-sm">
            <p class="font-medium text-indigo-800">{selectedMain} › {selectedNested}</p>
            <div class="mt-2 flex gap-4 text-xs text-indigo-600">
              <span><b>{previewAreaCount}</b> areas</span>
              <span><b>{previewPincodeCount}</b> pincodes</span>
            </div>
          </div>
        {/if}

        <button on:click={sendData} disabled={!selectedMain || !selectedNested || loading}
          class="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400">
          {#if loading}
            <svg class="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Generating Zones...
          {:else}
            Generate Zones
          {/if}
        </button>
      </div>

      <!-- Summary card -->
      {#if aiResponse}
        <div class="rounded-2xl bg-white p-6 shadow-sm border border-gray-100 lg:col-span-2">
          <div class="flex items-start justify-between">
            <div>
              <h2 class="text-xl font-bold text-gray-900">{aiResponse.city || aiResponse.district}</h2>
              <p class="text-sm text-gray-500">{aiResponse.state} › {aiResponse.district}</p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              {#if savedToLibMsg}
                <span class="text-xs font-medium {libMsgClass(savedToLibMsg)}">
                  {savedToLibMsg}
                </span>
              {/if}
              <button on:click={saveToLibrary} disabled={savingToLib || !zones.length}
                class="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 transition">
                {savingToLib ? "Saving…" : "💾 Save to Library"}
              </button>
              <button on:click={copyJSON}
                class="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition">
                {copied ? "✓ Copied" : "Copy JSON"}
              </button>
              <button on:click={exportJSON}
                class="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 transition">
                Export JSON
              </button>
            </div>
          </div>

          {#if aiResponse.summary}
            <p class="mt-3 text-sm text-gray-600 leading-relaxed">{aiResponse.summary}</p>
          {/if}

          <!-- Stats -->
          <div class="mt-4 grid grid-cols-4 gap-3">
            <div class="rounded-xl bg-gray-50 p-3 text-center">
              <p class="text-2xl font-bold text-indigo-600">{zones.length}</p>
              <p class="text-xs text-gray-500">Zones</p>
            </div>
            <div class="rounded-xl bg-gray-50 p-3 text-center">
              <p class="text-2xl font-bold text-indigo-600">{coveredAreas}/{previewAreaCount}</p>
              <p class="text-xs text-gray-500">Areas</p>
            </div>
            <div class="rounded-xl bg-gray-50 p-3 text-center">
              <p class="text-2xl font-bold text-indigo-600">{coveredPincodes}/{previewPincodeCount}</p>
              <p class="text-xs text-gray-500">Pincodes</p>
            </div>
            <div class="rounded-xl p-3 text-center {isFullyCovered ? 'bg-green-50' : 'bg-amber-50'}">
              <p class="text-2xl font-bold {isFullyCovered ? 'text-green-600' : 'text-amber-500'}">
                {isFullyCovered ? "✓" : missingItems.length}
              </p>
              <p class="text-xs {isFullyCovered ? 'text-green-600' : 'text-amber-600'}">
                {isFullyCovered ? "Full coverage" : "Unassigned"}
              </p>
            </div>
          </div>
        </div>

      {:else if error}
        <div class="rounded-2xl border border-red-100 bg-red-50 p-6 shadow-sm lg:col-span-2">
          <h3 class="font-semibold text-red-700">Error</h3>
          <p class="mt-1 text-sm text-red-600">{error}</p>
        </div>
      {:else if !loading}
        <div class="flex items-center justify-center rounded-2xl border-2 border-dashed border-gray-200 p-10 text-gray-400 lg:col-span-2">
          <div class="text-center">
            <svg class="mx-auto mb-3 h-10 w-10 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 13l4.553 2.276A1 1 0 0021 21.382V10.618a1 1 0 00-.553-.894L15 7m0 13V7m0 0L9 7" />
            </svg>
            <p class="text-sm">Select a state and district, then click Generate Zones</p>
          </div>
        </div>
      {/if}
    </div>

    <!-- ── MISSING AREAS PANEL ─────────────────────────────────────────── -->
    {#if missingItems.length > 0}
      <div class="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h3 class="font-semibold text-amber-900">
              {missingItems.length} Unassigned Area{missingItems.length > 1 ? "s" : ""}
            </h3>
            <p class="text-xs text-amber-700 mt-0.5">
              These areas were not placed in any zone by the AI. Assign them manually or auto-fix all.
            </p>
          </div>
          <button on:click={autoFixAll}
            class="shrink-0 rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 transition">
            Auto-fix All
          </button>
        </div>

        <!-- One-by-one list -->
        <div class="flex flex-col gap-2">
          {#each missingItems as item (item.area)}
            <div class="flex items-center gap-3 rounded-xl bg-white px-4 py-3 shadow-sm border border-amber-100">

              <!-- Area info -->
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium text-gray-900 truncate">{item.area}</p>
                <p class="text-xs text-gray-400 font-mono">{item.pincode}</p>
              </div>

              <!-- Zone selector -->
              <select bind:value={item.selectedZoneIdx}
                class="rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-gray-700 focus:border-indigo-400 focus:outline-none max-w-[200px]">
                {#each zones as zone, i}
                  <option value={i}>{zone.name}</option>
                {/each}
              </select>

              <!-- Assign button -->
              <button on:click={() => assignOne(item)}
                class="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 transition">
                Assign
              </button>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- ── LOADING SKELETON ───────────────────────────────────────────── -->
    {#if loading}
      <div class="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {#each Array(6) as _}
          <div class="animate-pulse rounded-2xl bg-white p-5 shadow-sm border border-gray-100">
            <div class="mb-3 h-4 w-2/3 rounded bg-gray-200"></div>
            <div class="mb-2 h-3 w-full rounded bg-gray-100"></div>
            <div class="mb-4 h-3 w-4/5 rounded bg-gray-100"></div>
            <div class="flex gap-2">
              <div class="h-5 w-16 rounded-full bg-gray-100"></div>
              <div class="h-5 w-20 rounded-full bg-gray-100"></div>
            </div>
          </div>
        {/each}
      </div>
    {/if}

    <!-- ── ZONES GRID ──────────────────────────────────────────────────── -->
    {#if zones.length && !loading}
      <div class="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {#each [...zones].sort((a, b) => a.priority - b.priority) as zone}
          <div class="rounded-2xl bg-white p-5 shadow-sm border border-gray-100 flex flex-col gap-3">

            <div class="flex items-start justify-between gap-2">
              <h3 class="font-semibold text-gray-900 leading-snug">{zone.name}</h3>
              <span class="shrink-0 rounded-full px-2 py-0.5 text-xs font-bold {priorityColor(zone.priority)}">
                #{zone.priority}
              </span>
            </div>

            {#if zone.description}
              <p class="text-xs text-gray-500 leading-relaxed">{zone.description}</p>
            {/if}

            {#if zone.locality_type}
              <span class="w-fit rounded-full px-2.5 py-0.5 text-xs font-medium capitalize {localityColor(zone.locality_type)}">
                {zone.locality_type}
              </span>
            {/if}

            <div class="flex gap-3 text-xs text-gray-500">
              <span><b class="text-gray-700">{zone.areas?.length ?? 0}</b> areas</span>
              <span><b class="text-gray-700">{zone.pincodes?.length ?? 0}</b> pincodes</span>
            </div>

            {#if zone.pincodes?.length}
              <div class="flex flex-wrap gap-1">
                {#each zone.pincodes as pin}
                  <span class="rounded-md bg-gray-100 px-2 py-0.5 text-xs font-mono text-gray-700">{pin}</span>
                {/each}
              </div>
            {/if}

            {#if zone.connectivity}
              <div class="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">
                <b>Connectivity:</b> {zone.connectivity}
              </div>
            {/if}

            {#if zone.highlights?.length}
              <div class="flex flex-wrap gap-1">
                {#each zone.highlights as h}
                  <span class="rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700">✓ {h}</span>
                {/each}
              </div>
            {/if}

            {#if zone.keywords?.length}
              <div class="flex flex-wrap gap-1">
                {#each zone.keywords as kw}
                  <span class="rounded-full border border-gray-200 px-2 py-0.5 text-xs text-gray-500">#{kw}</span>
                {/each}
              </div>
            {/if}

            {#if zone.areas?.length}
              <details class="text-xs text-gray-500">
                <summary class="cursor-pointer font-medium text-gray-600 hover:text-indigo-600">
                  View all {zone.areas.length} areas
                </summary>
                <p class="mt-1 leading-relaxed">{zone.areas.join(", ")}</p>
              </details>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

  </div>
</div>
