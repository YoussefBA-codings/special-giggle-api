"use strict";
// =============================================================================
// build-communes-all-pipeline.js
// Pipeline final pour les ~34 700 communes de France métropolitaine
//
// Inputs :
//   communes-all.geo.json    — géographie (build-all-communes-geo.js)
//   dvf-all-stats.csv        — stats DVF pré-agrégées (extract-dvf-all.py)
//   loyers.csv               — carte des loyers CLAMEUR (incluse dans le repo)
//   communes-all.insee.json  — enrichissement INSEE optionnel (enrich-insee.js)
//
// Output : communes-all.final.json
//
// Usage :
//   node build-communes-all-pipeline.js
//
// Pipeline complet :
//   node build-all-communes-geo.js
//   python3 extract-dvf-all.py
//   INPUT_FILE=communes-all.geo.json OUTPUT_FILE=communes-all.insee.json node enrich-insee.js
//   node build-communes-all-pipeline.js
// =============================================================================

const { readFile, writeFile, appendFile } = require("fs/promises");
const { existsSync }                       = require("fs");

const GEO_FILE    = process.env.GEO_FILE    || "communes-all.geo.json";
const DVF_FILE    = process.env.DVF_FILE    || "dvf-all-stats.csv";
const RENTS_FILE  = process.env.RENTS_FILE  || "loyers.csv";
const INSEE_FILE  = process.env.INSEE_FILE  || "communes-all.insee.json";
const OUTPUT_FILE = process.env.OUTPUT_FILE || "communes-all.prices.json";
const LOG_FILE    = process.env.LOG_FILE    || "build-communes-all.log";

// Seuil minimal de transactions pour afficher un prix
const MIN_TX = 3;

// Alsace-Moselle : registre foncier → pas de DVF → qualité artificielle LOW si loyer présent
const ALSACE_MOSELLE = new Set(["57", "67", "68"]);

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------
async function readJson(p) { return JSON.parse(await readFile(p, "utf-8")); }
async function writeJson(p, d) { await writeFile(p, JSON.stringify(d, null, 2), "utf-8"); }
async function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { await appendFile(LOG_FILE, line + "\n"); } catch {}
}

// ---------------------------------------------------------------------------
// CSV (séparateur ;)
// ---------------------------------------------------------------------------
function parseCsvSemicolon(content) {
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(";").map(h => h.trim());
  return lines.slice(1).map(line => {
    const vals = line.split(";");
    const row  = {};
    headers.forEach((h, i) => { row[h] = (vals[i] || "").trim(); });
    return row;
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function parseFr(v) {
  if (!v && v !== 0) return null;
  const n = parseFloat(String(v).replace(",", "."));
  return isFinite(n) ? n : null;
}

function normInsee(code) {
  if (!code) return null;
  const s = String(code).trim();
  if (!s) return null;
  return /^\d+$/.test(s) ? s.padStart(5, "0") : s.toUpperCase();
}

function round1(v) { return v !== null && isFinite(v) ? Math.round(v)      : null; }
function round2(v) { return v !== null && isFinite(v) ? Math.round(v * 100) / 100 : null; }

// ---------------------------------------------------------------------------
// Indice de fiabilité des prix — 0 à 100 pts
//
// Facteurs :
//   Volume      (0-40) : nb de transactions par type (seuil bon = 30/type)
//   Cohérence   (0-25) : spread (P90-P10)/médiane — faible = marché homogène
//   Loyer       (0-20) : présence de données de loyer
//   Complétude  (0-15) : avoir les deux types (appt + maison)
// ---------------------------------------------------------------------------
function computeReliabilityIndex({ aptNb, aptMed, aptP10, aptP90, hseNb, hseMed, hseP10, hseP90, rentApt, rentHse }) {
  // 1. Volume
  const aptVol = Math.min((aptNb || 0) / 30, 1) * 20;
  const hseVol = Math.min((hseNb || 0) / 30, 1) * 20;
  const volumePts = Math.round(aptVol + hseVol);

  // 2. Cohérence P10/P90
  const spreads = [];
  if ((aptNb || 0) >= 5 && aptMed > 0) spreads.push((aptP90 - aptP10) / aptMed);
  if ((hseNb || 0) >= 5 && hseMed > 0) spreads.push((hseP90 - hseP10) / hseMed);
  let consistencyPts = 0;
  if (spreads.length > 0) {
    const avg = spreads.reduce((a, b) => a + b, 0) / spreads.length;
    if      (avg < 0.4) consistencyPts = 25;
    else if (avg < 0.7) consistencyPts = 18;
    else if (avg < 1.0) consistencyPts = 10;
    else                consistencyPts = 3;
  }

  // 3. Loyer
  const rentPts = (rentApt !== null ? 12 : 0) + (rentHse !== null ? 8 : 0);

  // 4. Complétude
  const hasApt = (aptNb || 0) >= MIN_TX;
  const hasHse = (hseNb || 0) >= MIN_TX;
  const completePts = (hasApt && hasHse) ? 15 : (hasApt || hasHse) ? 7 : 0;

  const score = volumePts + consistencyPts + rentPts + completePts;

  let grade, confidence;
  if      (score >= 80) { grade = "A"; confidence = "TRES_FIABLE";  }
  else if (score >= 60) { grade = "B"; confidence = "FIABLE";       }
  else if (score >= 40) { grade = "C"; confidence = "INDICATIF";    }
  else if (score >= 20) { grade = "D"; confidence = "PEU_FIABLE";   }
  else                  { grade = "F"; confidence = "INSUFFISANT";  }

  return {
    score,
    grade,
    confidence,
    factors: { volume: volumePts, consistency: consistencyPts, rentData: rentPts, completeness: completePts },
  };
}

// ---------------------------------------------------------------------------
// DVF index : dvf-all-stats.csv → Map<inseeCode, { apt, hse }>
// ---------------------------------------------------------------------------
async function loadDvfIndex(filePath) {
  if (!existsSync(filePath)) return new Map();
  const content = await readFile(filePath, "utf-8");
  const rows    = parseCsvSemicolon(content);
  const index   = new Map();
  for (const r of rows) {
    const code = normInsee(r["code_commune"]);
    if (!code) continue;
    const nb  = parseInt(r["nb_transactions"]) || 0;
    const med = parseFr(r["prix_median"]);
    const p10 = parseFr(r["prix_p10"]);
    const p90 = parseFr(r["prix_p90"]);
    if (!index.has(code)) index.set(code, {});
    const entry = index.get(code);
    if (r["type_local"] === "Appartement") entry.apt = { nb, med, p10, p90 };
    if (r["type_local"] === "Maison")      entry.hse = { nb, med, p10, p90 };
  }
  return index;
}

// ---------------------------------------------------------------------------
// Loyer index : loyers.csv → Map<inseeCode, { apartment, house }>
// ---------------------------------------------------------------------------
function buildRentIndex(rows) {
  // Arrondissements → ville principale
  const ARROND = {};
  for (let i = 1; i <= 20; i++) ARROND[`75${String(100 + i).padStart(3, "0")}`] = "75056";
  for (let i = 1; i <= 9;  i++) ARROND[`69${String(380 + i).padStart(3, "0")}`] = "69123";
  for (let i = 1; i <= 16; i++) ARROND[`13${String(200 + i).padStart(3, "0")}`] = "13055";

  const raw = new Map();
  for (const r of rows) {
    let co = normInsee(
      r["code_commune_INSEE"] || r["INSEE_COM"] || r["CODGEO"] || r["code_commune"] || r["insee"]
    );
    if (!co) continue;
    co = ARROND[co] || co;

    const tp  = (r["type_bien"] || r["type"] || "").toLowerCase();
    const loy = parseFr(r["loypredm2"] || r["loyer_m2"] || r["loyer"]);
    if (!loy || loy <= 0) continue;

    if (!raw.has(co)) raw.set(co, { apt: [], hse: [] });
    const e = raw.get(co);
    if (tp.includes("appart")) e.apt.push(loy);
    if (tp.includes("maison")) e.hse.push(loy);
  }

  const index = new Map();
  for (const [co, e] of raw) {
    const avg = arr => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
    index.set(co, { apartment: avg(e.apt), house: avg(e.hse) });
  }
  return index;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  await writeFile(LOG_FILE, "").catch(() => {});
  await log("[START] build-communes-all-pipeline.js");

  // 1. Communes
  await log(`[GEO] Loading ${GEO_FILE}...`);
  const communes = await readJson(GEO_FILE);
  await log(`[GEO] ${communes.length} communes`);

  // 2. DVF stats pré-agrégées
  await log(`[DVF] Loading ${DVF_FILE}...`);
  const dvfIndex = await loadDvfIndex(DVF_FILE);
  if (dvfIndex.size > 0) {
    await log(`[DVF] ${dvfIndex.size} communes avec données DVF`);
  } else {
    await log(`[WARN] DVF file absent ou vide — prix DVF non disponibles`);
  }

  // 3. Loyers
  let rentIndex = new Map();
  if (existsSync(RENTS_FILE)) {
    await log(`[RENTS] Loading ${RENTS_FILE}...`);
    const content = await readFile(RENTS_FILE, "utf-8");
    const rows    = parseCsvSemicolon(content);
    rentIndex = buildRentIndex(rows);
    await log(`[RENTS] ${rentIndex.size} communes avec loyers`);
  } else {
    await log(`[WARN] Loyers file absent : ${RENTS_FILE}`);
  }

  // 4. INSEE enrichissement (optionnel)
  const inseeMap = new Map();
  if (existsSync(INSEE_FILE)) {
    await log(`[INSEE] Loading ${INSEE_FILE}...`);
    const inseeData = await readJson(INSEE_FILE);
    for (const c of inseeData) {
      const code = normInsee(c.geo?.inseeCode || c.inseeCode);
      if (code && c.insee) inseeMap.set(code, c.insee);
    }
    await log(`[INSEE] ${inseeMap.size} communes enrichies`);
  } else {
    await log(`[INFO] INSEE file absent (optionnel) — enrichissement ignoré`);
  }

  // 5. Construction des entrées finales
  await log(`[BUILD] Processing ${communes.length} communes...`);
  const output = [];

  for (const city of communes) {
    const code = normInsee(city.geo?.inseeCode);
    const dept = String(city.department || "");

    const dvf  = code ? dvfIndex.get(code)  : undefined;
    const rent = code ? rentIndex.get(code) : undefined;
    const insee = code ? inseeMap.get(code) : undefined;

    const apt  = dvf?.apt  || null;   // { nb, med, p10, p90 }
    const hse  = dvf?.hse  || null;
    const rentA = rent?.apartment ?? null;
    const rentH = rent?.house     ?? null;

    // Prix (null si < MIN_TX transactions)
    const aptAvg = apt && apt.nb >= MIN_TX ? round1(apt.med) : null;
    const aptMin = apt && apt.nb >= MIN_TX ? round1(apt.p10) : null;
    const aptMax = apt && apt.nb >= MIN_TX ? round1(apt.p90) : null;
    const hseAvg = hse && hse.nb >= MIN_TX ? round1(hse.med) : null;
    const hseMin = hse && hse.nb >= MIN_TX ? round1(hse.p10) : null;
    const hseMax = hse && hse.nb >= MIN_TX ? round1(hse.p90) : null;

    const aptRent = rentA !== null ? Math.round(rentA * 10) / 10 : null;
    const hseRent = rentH !== null ? Math.round(rentH * 10) / 10 : null;
    const allRent = aptRent !== null && hseRent !== null
      ? Math.round((aptRent + hseRent) / 2 * 10) / 10
      : (aptRent ?? hseRent);

    const aptYield = aptAvg && aptRent ? round2((aptRent * 12 / aptAvg) * 100) : null;
    const hseYield = hseAvg && hseRent ? round2((hseRent * 12 / hseAvg) * 100) : null;

    // Qualité de la donnée
    const hasApt  = (apt?.nb  || 0) >= MIN_TX;
    const hasHse  = (hse?.nb  || 0) >= MIN_TX;
    const hasRent = rentA !== null || rentH !== null;
    let dataQuality;
    if (ALSACE_MOSELLE.has(dept)) {
      // Pas de DVF dans ces départements (droit local)
      dataQuality = hasRent ? "LOW" : "NO_DATA";
    } else {
      dataQuality = (hasApt || hasHse) && hasRent ? "HIGH"
        : (hasApt || hasHse)                      ? "MEDIUM"
        : hasRent                                  ? "LOW"
        :                                            "NO_DATA";
    }

    // Indice de fiabilité
    const reliability = computeReliabilityIndex({
      aptNb:  apt?.nb   || 0,
      aptMed: apt?.med  || 0,
      aptP10: apt?.p10  || 0,
      aptP90: apt?.p90  || 0,
      hseNb:  hse?.nb   || 0,
      hseMed: hse?.med  || 0,
      hseP10: hse?.p10  || 0,
      hseP90: hse?.p90  || 0,
      rentApt: rentA,
      rentHse: rentH,
    });

    const pop = insee?.population || city.geo?.population || null;

    const entry = {
      city:       city.city,
      postalCode: city.postalCode,
      department: dept,
      // Bloc geo imbriqué — compatible enrich-transport.js et build-insights.js
      geo: {
        inseeCode:     code,
        apiName:       city.geo?.apiName || city.city,
        lat:           city.geo?.lat  ?? null,
        lon:           city.geo?.lon  ?? null,
        population:    pop,
        surface:       city.geo?.surface    ?? null,
        densityRaw:    city.geo?.densityRaw ?? null,
        matchScore:    city.geo?.matchScore    || 100,
        matchStrategy: city.geo?.matchStrategy || "api_geo_direct",
      },
      enrichment: {
        geoStatus: "OK",
        geoError:  null,
        updatedAt: new Date().toISOString(),
      },
      prices: {
        apartment: { average: aptAvg, min: aptMin, max: aptMax, rent: aptRent, grossYield: aptYield },
        house:     { average: hseAvg, min: hseMin, max: hseMax, rent: hseRent, grossYield: hseYield },
        all:       { rent: allRent },
      },
      priceSources: {
        purchase:            "DVF",
        rent:                "Carte des loyers",
        purchaseMethod:      "median_p10_p90",
        apartmentSalesCount: apt?.nb || 0,
        houseSalesCount:     hse?.nb || 0,
        dataQuality,
        priceReliabilityIndex: reliability,
      },
      population: pop,
    };

    if (insee) entry.insee = insee;

    output.push(entry);
  }

  // Sort by population desc
  output.sort((a, b) => (b.population || 0) - (a.population || 0));

  await writeJson(OUTPUT_FILE, output);

  // ── Résumé ──────────────────────────────────────────────────────────────
  const byQ = { HIGH: 0, MEDIUM: 0, LOW: 0, NO_DATA: 0 };
  const byG = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  output.forEach(c => {
    const q = c.priceSources.dataQuality;             if (q in byQ) byQ[q]++;
    const g = c.priceSources.priceReliabilityIndex?.grade || "F"; if (g in byG) byG[g]++;
  });

  const total    = output.length;
  const withData = byQ.HIGH + byQ.MEDIUM;
  const avgScore = Math.round(output.reduce((s, c) => s + (c.priceSources.priceReliabilityIndex?.score || 0), 0) / total);

  await log(`\n[DONE] ${total} communes → ${OUTPUT_FILE}`);
  await log(`  Qualité     : HIGH=${byQ.HIGH} MEDIUM=${byQ.MEDIUM} LOW=${byQ.LOW} NO_DATA=${byQ.NO_DATA}`);
  await log(`  Fiabilité   : A=${byG.A} B=${byG.B} C=${byG.C} D=${byG.D} F=${byG.F}`);
  await log(`  Score moy.  : ${avgScore}/100`);
  await log(`  Avec prix   : ${withData} communes (${Math.round(withData / total * 100)}%)`);
  await log(`  Sans donnée : ${byQ.NO_DATA} communes (${Math.round(byQ.NO_DATA / total * 100)}%)`);

  // Top A-grade communes par population (juste pour validation)
  const topA = output.filter(c => c.priceSources.priceReliabilityIndex?.grade === "A")
    .slice(0, 5)
    .map(c => `${c.city} (score=${c.priceSources.priceReliabilityIndex.score})`);
  await log(`  Exemples grade A : ${topA.join(", ") || "—"}`);
}

main().catch(async err => {
  console.error("[FATAL]", err.message);
  await appendFile(LOG_FILE, `[FATAL] ${err.message}\n`).catch(() => {});
  process.exit(1);
});
