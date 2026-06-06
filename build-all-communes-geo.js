"use strict";
// =============================================================================
// build-all-communes-geo.js
// Crée communes-all.geo.json — TOUTES les communes de France métropolitaine
// ~34 700 communes, sans filtre de population, DOM-TOM exclus.
//
// Les arrondissements de Paris (75101-75120), Lyon (69381-69389) et
// Marseille (13201-13216) sont exclus : leurs transactions DVF sont agrégées
// sur la ville principale (75056 / 69123 / 13055).
//
// Usage : node build-all-communes-geo.js
// Output: communes-all.geo.json
// =============================================================================

const https        = require("https");
const { writeFileSync } = require("fs");

// Métro France: départements 1-96 + Corse 2A/2B
function isMetroFrance(dept) {
  if (/^2[AB]$/i.test(dept)) return true;
  const n = parseInt(dept, 10);
  return !isNaN(n) && n >= 1 && n <= 96;
}

// Codes INSEE des arrondissements à exclure (leurs DVF → ville mère)
const EXCLUDED_ARRS = new Set([
  ...Array.from({ length: 20 }, (_, i) => `75${String(101 + i)}`),          // Paris  75101-75120
  ...Array.from({ length:  9 }, (_, i) => `69${String(381 + i)}`),          // Lyon   69381-69389
  ...Array.from({ length: 16 }, (_, i) => `13${String(201 + i)}`),          // Marseille 13201-13216
]);

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" } }, r => {
      const chunks = [];
      r.on("data", c => chunks.push(c));
      r.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8"))); }
        catch (e) { reject(new Error(`JSON parse: ${e.message}`)); }
      });
    }).on("error", reject);
  });
}

(async () => {
  console.log("Fetching all communes from API Geo...");
  const data = await fetch(
    "https://geo.api.gouv.fr/communes?fields=code,nom,population,centre,codesPostaux,codeDepartement&format=json&boost=population"
  );
  console.log(`  API returned: ${data.length} communes`);

  const filtered = data.filter(c =>
    isMetroFrance(c.codeDepartement) &&
    c.centre?.coordinates &&
    !EXCLUDED_ARRS.has(c.code)
  );
  console.log(`  Métro France (hors arrondissements): ${filtered.length}`);

  const cities = filtered.map(c => {
    const postalCode = (c.codesPostaux?.[0] || "").replace(/\s/g, "") ||
                       c.codeDepartement.padStart(2, "0") + "000";
    return {
      city:       c.nom,
      postalCode,
      department: c.codeDepartement,
      geo: {
        inseeCode:     c.code,
        apiName:       c.nom,
        lat:           c.centre.coordinates[1],
        lon:           c.centre.coordinates[0],
        population:    c.population || null,
        surface:       null,
        densityRaw:    null,
        matchScore:    100,
        matchStrategy: "api_geo_direct",
      },
      enrichment: {
        geoStatus: "OK",
        geoError:  null,
        updatedAt: new Date().toISOString(),
      },
    };
  });

  // Sort by population desc (grandes villes en tête)
  cities.sort((a, b) => (b.geo.population || 0) - (a.geo.population || 0));

  writeFileSync("communes-all.geo.json", JSON.stringify(cities, null, 2), "utf-8");
  console.log(`\nSaved ${cities.length} communes → communes-all.geo.json`);

  const byDept = {};
  cities.forEach(c => { byDept[c.department] = (byDept[c.department] || 0) + 1; });
  const popNull = cities.filter(c => !c.geo.population).length;
  console.log(`  Départements couverts   : ${Object.keys(byDept).length}`);
  console.log(`  Sans population connue  : ${popNull}`);
  console.log(`  Top 5 : ${cities.slice(0, 5).map(c => `${c.city} (${(c.geo.population || 0).toLocaleString("fr")} hab.)`).join(", ")}`);
})().catch(err => { console.error("[FATAL]", err.message); process.exit(1); });
