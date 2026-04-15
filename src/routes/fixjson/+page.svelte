<!-- <script>
import companiesData from '../../lib/data/companies_with_projects_2026-04-06T06-27-43-033Z.json'

let resobj =[]

function dataFilter() {

 resobj=  companiesData.reduce((acc, item) => ({ ...acc, [item._id]: item}), {})
resobj.forEach(element =>   delete element?.projects);
}

$:console.log(resobj,"resobj")
</script>


<button onclick={dataFilter}>Click me </button>
 -->


 <!-- JSONN zip file  converter script -->
<!-- <script>
import JSZip from "jszip";
import zonesData from '../../lib/data/zones_generated.json';

let finalZones = {};

// 🔥 process same as before
function processZones() {
  const result = {};

  for (let stateName in zonesData) {
    const state = zonesData[stateName];

    for (let districtName in state) {
      const districtData = state[districtName];

      const key = districtName

      result[key] = {
        state: stateName,
        district: districtName,
        city: districtData.city,
        summary: districtData.summary,
        total_areas: districtData.total_areas,
        total_pincodes: districtData.total_pincodes,
        zones: districtData.zones.map((zone, index) => ({
          ...zone,
          id: `${districtName.toLowerCase()}_${index + 1}`,
          pincodes: zone.pincodes.map(p => Number(p))
        }))
      };
    }
  }
console.log(result)
  finalZones = result;
}

// 🔥 ZIP DOWNLOAD
async function downloadZip() {
  const zip = new JSZip();

  for (let key in finalZones) {
    const fileName = `${key}.json`
      .replaceAll(" ", "_")
      .toLowerCase();

    const jsonStr = JSON.stringify(finalZones[key], null, 2);

    zip.file(fileName, jsonStr);
  }

  // generate zip
  const content = await zip.generateAsync({ type: "blob" });

  // download
  const a = document.createElement("a");
  const url = URL.createObjectURL(content);
  a.href = url;
  a.download = "zones.zip";
  a.click();

  URL.revokeObjectURL(url);
}
</script>

<button on:click={processZones}>Process Zones</button>
<button on:click={downloadZip}>Download ZIP</button> -->


<!-- make a projects file state wise script -->
<!-- <script>
import companiesData from '../../lib/data/companies_with_projects_2026-04-06T06-27-43-033ZZ.json';

let cleanedProjects = [];

// 🔥 extract + clean
function processProjects() {
  const result = [];

  for (let company of companiesData) {
   
    // ❌ skip if no projects
    if (!company.projects || company.projects.length === 0) continue;

    for (let proj of company.projects) {
      if (!proj) continue;

      // ❌ skip if no pincode (optional but recommended)
      if (!proj.pinCode) continue;

      result.push({
        id: proj._id,
        name: proj.name,
        reraRegNo: proj.reraRegNo,
        projectType: proj.projectType,
        constructionStatus: proj.constructionStatus,

        state: company.state,
        district: proj.district,

        // 🔥 IMPORTANT
        pincode: Number(proj.pinCode),

        area: proj.area,
        location: proj.location,

        builderId: company._id
      });
    }
  }

  cleanedProjects = result;
  console.log("✅ Projects cleaned:", cleanedProjects.length);
}

// 🔥 download function
function downloadJSON(data, filename = "projects.json") {
  const jsonStr = JSON.stringify(data, null, 2);

  const blob = new Blob([jsonStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();

  URL.revokeObjectURL(url);
}

// 🔥 trigger download
function handleDownload() {
  downloadJSON(cleanedProjects, "projects_cleaned.json");
}
</script>

<button on:click={processProjects}>Process Projects</button>
<button on:click={handleDownload}>Download Projects JSON</button> -->




<script>
import rawData from '../../lib/data/companies_with_projects_2026-04-06T06-27-43-033Z.json';

let companiesData = rawData;

function handleProjects() {
  const updated = companiesData.map((data) => {
    if (!data.projects?.length) return data;

    return {
      ...data,
      projects: data.projects.map((project) => ({
        ...project,
        builderId: data._id
      }))
    };
  });

  companiesData = updated;

  // 👇 download call
  downloadJSON(updated);
}

function downloadJSON(data) {
  const blob = new Blob(
    [JSON.stringify(data, null, 2)],
    { type: "application/json" }
  );

  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "updated-companies.json"; // 👈 file name
  a.click();

  URL.revokeObjectURL(url);
}
</script>

<button on:click={handleProjects}>
  Add project ids & Download
</button>