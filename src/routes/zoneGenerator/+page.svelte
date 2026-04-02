<script>
  import rawData from "$lib/data/pincode_IN_all.json";

  // normalize data safely
  let data = rawData?.keys ?? rawData ?? {};

  let selectedMain = "";
  let selectedNested = "";
  let aiResponse = null;
let loading = false;
let error = null;

  // safe reactive values
  $: mainKeys = data ? Object.keys(data) : [];

  $: nestedKeys =
    selectedMain && data[selectedMain]
      ? Object.keys(data[selectedMain])
      : [];


async function sendData() {
  if (!selectedMain || !selectedNested) {
    alert("Please select both dropdowns");
    return;
  }

  loading = true;
  error = null;
  aiResponse = null;

  const payload = {
    [selectedMain]: {
      [selectedNested]: data[selectedMain][selectedNested]
    }
  };

  try {
    const res = await fetch("/api/zoneGenerator", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ data: payload })
    });

    const result = await res.json();

    if (!result.success) {
      throw new Error(result.error || "API returned an error");
    }

    if (!result.output) {
      throw new Error("API returned no output");
    }

    aiResponse = result.output;

    console.log("AI Parsed:", aiResponse);

  } catch (err) {
    error = err.message;
    console.error(err);
  } finally {
    loading = false;
  }
}
</script>

<div class="container">
  <!-- 1st Dropdown -->
  <select
    bind:value={selectedMain}
    on:change={() => {
      selectedNested = "";
    }}
  >
    <option value="">Select Main Key</option>
    {#each mainKeys as key}
      <option value={key}>{key}</option>
    {/each}
  </select>

  <!-- 2nd Dropdown -->
  <select
    bind:value={selectedNested}
    disabled={!selectedMain}
  >
    <option value="">Select Nested Key</option>
    {#each nestedKeys as key}
      <option value={key}>{key}</option>
    {/each}
  </select>

  <!-- Debug Output (optional but useful) -->
  {#if selectedMain && selectedNested}
    <div class="output">
      <p><b>Main:</b> {selectedMain}</p>
      <p><b>Nested:</b> {selectedNested}</p>
    </div>
  {/if}

<button
  on:click={sendData}
  disabled={!selectedMain || !selectedNested || loading}
  class="flex items-center justify-center gap-2 w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 
         hover:bg-indigo-700 hover:shadow-md 
         disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500"
>
  {#if loading}
    <svg
      class="h-4 w-4 animate-spin"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
      <path fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
    Fetching Zones...
  {:else}
    Fetch Zones
  {/if}
</button>
</div>


{#if loading}
  <p>Loading AI zones...</p>
{/if}

{#if error}
  <p style="color:red;">Error: {error}</p>
{/if}

{#if aiResponse}
  <div class="zones">
    <h3>{aiResponse.city}</h3>

    {#each aiResponse.zones as zone}
      <div class="zone">
        <h4>{zone.name} (Priority: {zone.priority})</h4>

        <p><b>Areas:</b> {zone.areas.join(", ")}</p>
        <p><b>Pincodes:</b> {zone.pincodes.join(", ")}</p>
        <p><b>Keywords:</b> {zone.keywords.join(", ")}</p>
      </div>
    {/each}
  </div>
{/if}

<style>
  .container {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 300px;
    margin: 40px auto;
  }

  select {
    padding: 10px;
    border-radius: 8px;
    border: 1px solid #ccc;
  }

  .output {
    margin-top: 20px;
    padding: 10px;
    border: 1px solid #eee;
    border-radius: 8px;
    background: #f9f9f9;
  }
  .zones {
  margin-top: 20px;
}

.zone {
  padding: 10px;
  border: 1px solid #ddd;
  border-radius: 8px;
  margin-bottom: 10px;
  background: #fafafa;
}
</style>