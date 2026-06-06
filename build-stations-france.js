"use strict";
// =============================================================================
// build-stations-france.js
// Génère stations-france.json via Overpass API — TOUTE la France métropolitaine
// 10 requêtes régionales, déduplication automatique
//
// Usage : node build-stations-france.js
// Output: stations-france.json
// =============================================================================

const https = require("https");
const fs    = require("fs");

const OUTPUT_FILE     = "stations-france.json";
const DEDUP_RADIUS_KM = 0.15; // stations < 150m = doublon

// Régions — bounding boxes [minLat, minLon, maxLat, maxLon]
// Légères chevauchements aux frontières pour ne rien manquer
const REGIONS = [
  { name: "Hauts-de-France",   bbox: [49.0,  1.2, 51.2, 4.5]  },
  { name: "Normandie",         bbox: [48.3, -2.2, 51.2, 2.2]  },
  { name: "Île-de-France",     bbox: [47.9,  1.4, 49.3, 3.5]  },
  { name: "Grand Est",         bbox: [47.3,  3.5, 50.5, 8.5]  },
  { name: "Bretagne",          bbox: [47.3, -5.5, 49.2, -0.8] },
  { name: "Pays-de-Loire + Centre", bbox: [46.0, -2.5, 49.0,  3.5]  },
  { name: "Bourgogne + Jura",  bbox: [46.0,  3.5, 48.5, 7.5]  },
  { name: "Nouvelle-Aquitaine",bbox: [43.0, -2.5, 47.0, 2.0]  },
  { name: "Auvergne-Rhône + Occitanie Est", bbox: [43.0, 1.5, 47.2, 7.5] },
  { name: "PACA",              bbox: [43.0,  4.5, 45.2, 8.0]  },
  { name: "Corse",             bbox: [41.3,  8.4, 43.2, 9.7]  },
];

// ---------------------------------------------------------------------------
// Classification des stations (reprend build-national-stations.js)
// ---------------------------------------------------------------------------
function classifyStation(props) {
  const network  = (props.network  || "").toLowerCase();
  const operator = (props.operator || "").toLowerCase();
  const station  = (props.station  || "").toLowerCase();
  const railway  = (props.railway  || "").toLowerCase();

  // Métro
  if (station === "subway" || props["subway"] === "yes" ||
      network.includes("metro") || network.includes("métro") ||
      operator.includes("metro") || operator.includes("ratp") ||
      ["lyon", "marseille", "toulouse", "lille", "rennes", "bordeaux",
       "tcl", "rtm", "tisseo", "keolis"].some(k => network.includes(k) && network.includes("metro"))) {
    return "METRO";
  }
  // Tram
  if (railway === "tram_stop" ||
      network.includes("tram") || network.includes("tramway") ||
      operator.includes("tram")) {
    return "TRAM";
  }
  // Transilien / RER (réseau banlieue Paris)
  if (network.includes("transilien") || network.includes("rer") ||
      operator.includes("transilien")) {
    return "RER";
  }
  // Train SNCF général
  if (railway === "station" || railway === "halt" ||
      operator.includes("sncf") || network.includes("ter") ||
      network.includes("tgv") || network.includes("intercit")) {
    return "TRAIN";
  }
  // Défaut : TRAIN (pour toute infrastructure ferroviaire)
  return "TRAIN";
}

// ---------------------------------------------------------------------------
// Overpass
// ---------------------------------------------------------------------------
function buildQuery(bbox) {
  const [s, w, n, e] = bbox;
  return `[out:json][timeout:90][bbox:${s},${w},${n},${e}];
(
  node["railway"="station"];
  node["railway"="halt"];
  node["railway"="tram_stop"];
  node["public_transport"="station"]["train"="yes"];
  node["public_transport"="station"]["subway"="yes"];
  node["public_transport"="station"]["tram"="yes"];
);
out body;`;
}

function fetchOverpass(query) {
  return new Promise((resolve, reject) => {
    const body = "data=" + encodeURIComponent(query);
    const options = {
      hostname: "overpass-api.de",
      path:     "/api/interpreter",
      method:   "POST",
      headers:  {
        "Content-Type":   "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
        "User-Agent":     "build-stations-france/1.0",
      },
    };
    const req = https.request(options, res => {
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      let d = ""; res.on("data", c => d += c);
      res.on("end", () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    });
    req.on("error", reject);
    req.setTimeout(100_000, () => { req.destroy(); reject(new Error("timeout")); });
    req.write(body);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---------------------------------------------------------------------------
// Déduplication Haversine
// ---------------------------------------------------------------------------
function toRad(d) { return d * Math.PI / 180; }
function distKm(a, b) {
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const x = Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLon/2)**2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
}

function normName(s) {
  return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
}

function deduplicate(stations) {
  // Grid-based dedup : O(N) au lieu de O(N²)
  const CELL = 0.01; // ~1.1km cells
  const grid = new Map();
  const result = [];

  for (const s of stations) {
    const ck = `${Math.floor(s.lat / CELL)},${Math.floor(s.lon / CELL)}`;
    // Check current + neighboring cells (3×3)
    const latC = Math.floor(s.lat / CELL);
    const lonC = Math.floor(s.lon / CELL);
    let isDup = false;
    for (let dl = -1; dl <= 1 && !isDup; dl++) {
      for (let dm = -1; dm <= 1 && !isDup; dm++) {
        const neighbors = grid.get(`${latC + dl},${lonC + dm}`) || [];
        for (const r of neighbors) {
          if (r.type === s.type &&
              distKm(r, s) < DEDUP_RADIUS_KM &&
              normName(r.name) === normName(s.name)) {
            isDup = true; break;
          }
        }
      }
    }
    if (!isDup) {
      result.push(s);
      const cell = grid.get(ck) || [];
      cell.push(s);
      grid.set(ck, cell);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
(async () => {
  const allStations = [];

  for (const region of REGIONS) {
    console.log(`\nFetching: ${region.name}  [${region.bbox.join(", ")}]`);
    let ok = false;

    for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
      try {
        const data = await fetchOverpass(buildQuery(region.bbox));
        let added = 0;
        for (const el of (data.elements || [])) {
          if (!el.lat || !el.lon) continue;
          const props = el.tags || {};
          const name  = props.name || props["name:fr"] || "Station";
          const type  = classifyStation(props);
          allStations.push({ name, lat: el.lat, lon: el.lon, type });
          added++;
        }
        console.log(`  OK — ${added} éléments`);
        ok = true;
      } catch (err) {
        console.log(`  Erreur (tentative ${attempt}/3): ${err.message}`);
        if (attempt < 3) { console.log("  Retry dans 15s..."); await sleep(15_000); }
      }
    }

    if (!ok) console.log(`  WARN: région ${region.name} ignorée après 3 échecs`);
    await sleep(4_000); // politesse Overpass
  }

  console.log(`\nTotal brut: ${allStations.length} stations`);
  const deduped = deduplicate(allStations);
  console.log(`Après déduplication: ${deduped.length} stations`);

  const byType = {};
  deduped.forEach(s => { byType[s.type] = (byType[s.type] || 0) + 1; });
  console.log("Par type:", Object.entries(byType).map(([t, n]) => `${t}=${n}`).join(", "));

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(deduped, null, 2), "utf-8");
  console.log(`\nSaved ${deduped.length} stations → ${OUTPUT_FILE}`);
})().catch(err => { console.error("[FATAL]", err.message); process.exit(1); });
