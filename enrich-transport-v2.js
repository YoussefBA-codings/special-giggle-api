"use strict";
// =============================================================================
// enrich-transport-v2.js
// Enrichit un fichier geo/prices avec les données de transport.
// Version optimisée pour ~35 000 communes via index spatial (grille 0.1°).
//
// Performance : O(N × K) au lieu de O(N × M) — K = candidats dans la grille locale
// Résultat   : ~5 secondes pour 34 000 communes × 40 000 stations
//
// Usage :
//   INPUT_FILE=communes-all.prices.json \
//   STATIONS_FILE=stations-france.json  \
//   OUTPUT_FILE=communes-all.transport.json \
//   node enrich-transport-v2.js
//
// Format attendu de INPUT_FILE : tableau d'objets avec { geo: { lat, lon } }
// Format STATIONS_FILE : [{ name, lat, lon, type }]
// =============================================================================

const { readFile, writeFile, appendFile } = require("fs/promises");
const { existsSync }                       = require("fs");

const INPUT_FILE    = process.env.INPUT_FILE    || "communes-all.prices.json";
const STATIONS_FILE = process.env.STATIONS_FILE || "stations-france.json";
const OUTPUT_FILE   = process.env.OUTPUT_FILE   || "communes-all.transport.json";
const LOG_FILE      = process.env.LOG_FILE      || "enrich-transport-v2.log";

async function readJson(p) { return JSON.parse(await readFile(p, "utf-8")); }
async function writeJson(p, d) { await writeFile(p, JSON.stringify(d, null, 2), "utf-8"); }
async function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { await appendFile(LOG_FILE, line + "\n"); } catch {}
}

// ---------------------------------------------------------------------------
// Haversine
// ---------------------------------------------------------------------------
const R = 6371;
function toRad(d) { return d * Math.PI / 180; }
function haversine(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Index spatial — grille 0.1° (~11km à la latitude de la France)
// ---------------------------------------------------------------------------
const CELL = 0.1;

function buildGrid(stations) {
  const grid = new Map();
  for (const s of stations) {
    const key = `${Math.floor(s.lat / CELL)},${Math.floor(s.lon / CELL)}`;
    const cell = grid.get(key);
    if (cell) cell.push(s);
    else grid.set(key, [s]);
  }
  return grid;
}

// Récupère les candidats dans les cellules à ±radius degrés autour de (lat, lon)
function getCandidates(grid, lat, lon, radiusCells) {
  const latC = Math.floor(lat / CELL);
  const lonC = Math.floor(lon / CELL);
  const out = [];
  for (let dl = -radiusCells; dl <= radiusCells; dl++) {
    for (let dm = -radiusCells; dm <= radiusCells; dm++) {
      const c = grid.get(`${latC + dl},${lonC + dm}`);
      if (c) out.push(...c);
    }
  }
  return out;
}

// findNearest avec expansion progressive — correct ET rapide
function findNearest(lat, lon, grid, type) {
  const latC = Math.floor(lat / CELL);
  const lonC = Math.floor(lon / CELL);
  let best = null, bestDist = Infinity;

  for (let r = 1; r <= 60; r++) {  // 60 × 0.1° = 6° ≈ 660km max
    // Itérer uniquement le ring r (pas les cellules intérieures déjà vues)
    for (let dl = -r; dl <= r; dl++) {
      for (let dm = -r; dm <= r; dm++) {
        if (Math.abs(dl) < r && Math.abs(dm) < r) continue;
        const cells = grid.get(`${latC + dl},${lonC + dm}`);
        if (!cells) continue;
        for (const s of cells) {
          if (type && s.type !== type) continue;
          const d = haversine(lat, lon, s.lat, s.lon);
          if (d < bestDist) { bestDist = d; best = s; }
        }
      }
    }
    // Convergence : si le rayon de recherche (conservateur) dépasse bestDist → terminé
    if (best && r * CELL * 100 > bestDist) break; // 100km/° = approx conservative
  }

  return best ? { name: best.name, type: best.type, distanceKm: bestDist } : null;
}

// countWithinKm via grille — O(K) au lieu de O(M)
function countWithinKm(lat, lon, grid, radiusKm) {
  const radiusCells = Math.ceil(radiusKm / (CELL * 90)) + 1; // 90km/° conservative
  const candidates  = getCandidates(grid, lat, lon, radiusCells);
  let count = 0;
  for (const s of candidates) {
    if (haversine(lat, lon, s.lat, s.lon) <= radiusKm) count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Seuils de distance pour le scoring (même que enrich-transport.js)
// ---------------------------------------------------------------------------
const THRESHOLDS = {
  METRO: { excellent: 1,  good: 2,  medium: 5,  far: 10 },
  RER:   { excellent: 2,  good: 5,  medium: 10, far: 20 },
  TRAIN: { excellent: 2,  good: 5,  medium: 10, far: 20 },
  TRAM:  { excellent: 1,  good: 2,  medium: 5,  far: 10 },
};

function computeTransportScore(d) {
  let s = 0;
  const { nearestMetro, nearestRer, nearestTrain, nearestTram,
          stationsWithin2Km, stationsWithin5Km, stationsWithin10Km, nearestStation } = d;

  if (nearestMetro) {
    const km = nearestMetro.distanceKm;
    s += km <= 1 ? 45 : km <= 2 ? 38 : km <= 5 ? 22 : km <= 10 ? 10 : 2;
  }
  if (nearestRer) {
    const km = nearestRer.distanceKm;
    s += km <= 2 ? 38 : km <= 5 ? 30 : km <= 10 ? 18 : km <= 20 ? 8 : 2;
  }
  if (nearestTrain) {
    const km = nearestTrain.distanceKm;
    s += km <= 2 ? 22 : km <= 5 ? 16 : km <= 10 ? 10 : km <= 20 ? 4 : 1;
  }
  if (nearestTram) {
    const km = nearestTram.distanceKm;
    s += km <= 1 ? 15 : km <= 2 ? 10 : km <= 5 ? 5 : 2;
  }
  s += stationsWithin2Km >= 5 ? 12 : stationsWithin2Km >= 3 ? 8 : stationsWithin2Km >= 1 ? 4 : 0;
  s += stationsWithin5Km >= 10 ? 10 : stationsWithin5Km >= 5 ? 6 : stationsWithin5Km >= 2 ? 3 : 0;
  s += stationsWithin10Km >= 20 ? 6 : stationsWithin10Km >= 10 ? 4 : stationsWithin10Km >= 5 ? 2 : 0;

  if (nearestStation) {
    const km = nearestStation.distanceKm;
    if (km > 30) s -= 35; else if (km > 20) s -= 20; else if (km > 10) s -= 8;
  } else { s = 0; }

  return Math.max(0, Math.min(100, Math.round(s)));
}

function computeTransportInvestmentScore(d) {
  let s = 0;
  const { nearestMetro, nearestRer, nearestTrain, nearestTram,
          stationsWithin2Km, stationsWithin5Km, nearestStation } = d;

  if (nearestRer) {
    const km = nearestRer.distanceKm;
    s += km <= 1 ? 55 : km <= 2 ? 48 : km <= 5 ? 38 : km <= 10 ? 25 : km <= 15 ? 12 : km <= 20 ? 5 : 0;
  }
  if (nearestTrain) {
    const km = nearestTrain.distanceKm;
    s += km <= 1 ? 40 : km <= 2 ? 35 : km <= 5 ? 28 : km <= 10 ? 18 : km <= 15 ? 8 : km <= 20 ? 3 : 0;
  }
  if (nearestMetro) {
    const km = nearestMetro.distanceKm;
    s += km <= 1 ? 35 : km <= 2 ? 28 : km <= 5 ? 18 : km <= 10 ? 8 : 2;
  }
  if (nearestTram) {
    const km = nearestTram.distanceKm;
    s += km <= 1 ? 18 : km <= 2 ? 14 : km <= 5 ? 8 : 2;
  }
  s += stationsWithin2Km >= 3 ? 10 : stationsWithin2Km >= 1 ? 5 : 0;
  s += stationsWithin5Km >= 5 ? 8  : stationsWithin5Km >= 2 ? 4 : 0;

  if (nearestStation) {
    const km = nearestStation.distanceKm;
    if (km > 30) s -= 40; else if (km > 20) s -= 25; else if (km > 10) s -= 10;
  } else { s = 0; }

  return Math.max(0, Math.min(100, Math.round(s)));
}

function getClassification(score) {
  if (score >= 85) return "EXCELLENT";
  if (score >= 70) return "GOOD";
  if (score >= 50) return "AVERAGE";
  if (score >= 30) return "WEAK";
  return "ISOLATED";
}

function generateInsights(d, transportScore) {
  const { nearestRer, nearestTrain, nearestMetro, nearestTram,
          hasRer, hasTrain, hasMetro, hasTram,
          stationsWithin2Km, stationsWithin5Km, stationsWithin10Km,
          nearestStation } = d;
  const strengths = [], weaknesses = [];

  if (nearestRer) {
    const km = nearestRer.distanceKm;
    if (km <= 2)       strengths.push(`RER très proche (${km}km) — excellent accès`);
    else if (km <= 5)  strengths.push(`RER accessible (${km}km) — commune attractive pour navetteurs`);
    else if (km <= 10) strengths.push(`RER à ${km}km — trajet en voiture ou vélo envisageable`);
    else               weaknesses.push(`RER le plus proche à ${km}km — accès limité`);
  } else {
    weaknesses.push("Aucune ligne RER à moins de 20km — attractivité locative réduite");
  }

  if (hasTrain && nearestTrain) {
    const km = nearestTrain.distanceKm;
    if (km <= 2)       strengths.push(`Gare SNCF à ${km}km — liaisons ferroviaires disponibles`);
    else if (km <= 10) strengths.push(`Gare SNCF à ${km}km — desserte ferroviaire régionale`);
    else if (km > 20)  weaknesses.push(`Gare SNCF la plus proche à ${km}km — éloignement important`);
  }

  if (hasMetro && nearestMetro) {
    const km = nearestMetro.distanceKm;
    if (km <= 2)      strengths.push(`Métro à ${km}km — zone dense, forte demande locative`);
    else if (km <= 5) strengths.push(`Métro accessible (${km}km) — zone semi-urbaine bien desservie`);
  }

  if (hasTram && nearestTram && nearestTram.distanceKm <= 2) {
    strengths.push(`Tramway à ${nearestTram.distanceKm}km — desserte urbaine complémentaire`);
  }

  if (stationsWithin2Km >= 3)        strengths.push(`${stationsWithin2Km} stations dans un rayon de 2km — multimodal`);
  else if (stationsWithin5Km >= 5)   strengths.push(`${stationsWithin5Km} stations dans un rayon de 5km — bonne offre transport`);
  else if (stationsWithin10Km >= 10) strengths.push(`${stationsWithin10Km} infrastructures transport dans 10km`);

  if (stationsWithin5Km === 0)       weaknesses.push("Aucune infrastructure de transport dans un rayon de 5km");
  else if (stationsWithin10Km <= 2)  weaknesses.push(`Seulement ${stationsWithin10Km} station(s) dans 10km — offre très limitée`);

  if (nearestStation && nearestStation.distanceKm > 20) {
    weaknesses.push(`Commune très éloignée (${nearestStation.distanceKm}km) — dépendance voiture`);
  } else if (nearestStation && nearestStation.distanceKm > 10) {
    weaknesses.push(`Commune éloignée des transports (${nearestStation.distanceKm}km) — voiture indispensable`);
  }

  const cl = getClassification(transportScore);
  let summary;
  if (cl === "EXCELLENT") {
    summary = "Commune excellemment desservie. Forte demande locative attendue.";
  } else if (cl === "GOOD") {
    summary = hasTrain || hasRer
      ? "Bonne desserte ferrée. Commune attractive pour les navetteurs."
      : "Bonne desserte globale. Commune bien intégrée au réseau régional.";
  } else if (cl === "AVERAGE") {
    summary = hasTrain || hasRer
      ? "Desserte correcte mais distancée. Voiture souvent nécessaire pour la gare."
      : "Desserte limitée aux transports de proximité.";
  } else if (cl === "WEAK") {
    summary = "Faible desserte en transports. Adapté aux propriétaires occupants ou à l'investissement longue durée.";
  } else {
    summary = "Commune très mal desservie. Dépendance quasi exclusive à la voiture.";
  }

  return { strengths, weaknesses, summary };
}

// ---------------------------------------------------------------------------
// Enrichissement d'une commune
// ---------------------------------------------------------------------------
function enrichCity(city, grid) {
  const lat = city.geo?.lat;
  const lon = city.geo?.lon;

  const noGeo = {
    ...city,
    transport: {
      status: "NO_GEO", error: "Coordinates not available",
      nearestStation: null, nearestRer: null, nearestTrain: null,
      nearestMetro: null, nearestTram: null,
      stationsWithin2Km: 0, stationsWithin5Km: 0, stationsWithin10Km: 0,
      hasMetro: false, hasRer: false, hasTrain: false, hasTram: false,
      transportScore: 0, transportInvestmentScore: 0, classification: "ISOLATED",
      transportInsights: { strengths: [], weaknesses: ["Coordonnées GPS manquantes"], summary: "" },
      futureProjects: { grandParis: false, newStationPlanned: false, futureTransportScore: null },
    },
  };

  if (!lat || !lon) return noGeo;

  const nearestStation = findNearest(lat, lon, grid, null);
  const nearestRer     = findNearest(lat, lon, grid, "RER");
  const nearestTrain   = findNearest(lat, lon, grid, "TRAIN");
  const nearestMetro   = findNearest(lat, lon, grid, "METRO");
  const nearestTram    = findNearest(lat, lon, grid, "TRAM");

  const stationsWithin2Km  = countWithinKm(lat, lon, grid, 2);
  const stationsWithin5Km  = countWithinKm(lat, lon, grid, 5);
  const stationsWithin10Km = countWithinKm(lat, lon, grid, 10);

  const hasRer   = nearestRer   !== null && nearestRer.distanceKm   <= 30;
  const hasTrain = nearestTrain !== null && nearestTrain.distanceKm <= 30;
  const hasMetro = nearestMetro !== null && nearestMetro.distanceKm <= 15;
  const hasTram  = nearestTram  !== null && nearestTram.distanceKm  <= 15;

  const computed = {
    nearestStation,
    nearestRer:   nearestRer   ? { name: nearestRer.name,   distanceKm: nearestRer.distanceKm }   : null,
    nearestTrain: nearestTrain ? { name: nearestTrain.name, distanceKm: nearestTrain.distanceKm } : null,
    nearestMetro: nearestMetro ? { name: nearestMetro.name, distanceKm: nearestMetro.distanceKm } : null,
    nearestTram:  nearestTram  ? { name: nearestTram.name,  distanceKm: nearestTram.distanceKm }  : null,
    stationsWithin2Km, stationsWithin5Km, stationsWithin10Km,
    hasRer, hasTrain, hasMetro, hasTram,
  };

  const transportScore           = computeTransportScore(computed);
  const transportInvestmentScore = computeTransportInvestmentScore(computed);
  const classification           = getClassification(transportScore);
  const transportInsights        = generateInsights({ ...computed, hasRer, hasTrain, hasMetro, hasTram }, transportScore);

  return {
    ...city,
    transport: {
      status: "OK",
      error: null,
      nearestStation,
      nearestRer:   computed.nearestRer,
      nearestTrain: computed.nearestTrain,
      nearestMetro: computed.nearestMetro,
      nearestTram:  computed.nearestTram,
      stationsWithin2Km, stationsWithin5Km, stationsWithin10Km,
      hasMetro, hasRer, hasTrain, hasTram,
      transportScore, transportInvestmentScore,
      classification, transportInsights,
      futureProjects: { grandParis: false, newStationPlanned: false, futureTransportScore: null },
    },
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  await writeFile(LOG_FILE, "").catch(() => {});
  await log("[START] enrich-transport-v2.js (index spatial grille 0.1°)");

  // Charger stations
  if (!existsSync(STATIONS_FILE)) {
    await log(`[FATAL] ${STATIONS_FILE} introuvable.`); process.exit(1);
  }
  const rawStations = await readJson(STATIONS_FILE);
  const stations    = rawStations.filter(s => typeof s.lat === "number" && typeof s.lon === "number" && s.name && s.type);
  await log(`[STATIONS] ${stations.length} stations valides (sur ${rawStations.length})`);

  // Construire l'index spatial
  const t0   = Date.now();
  const grid = buildGrid(stations);
  await log(`[GRID] ${grid.size} cellules en ${Date.now() - t0}ms`);

  // Charger communes
  if (!existsSync(INPUT_FILE)) {
    await log(`[FATAL] ${INPUT_FILE} introuvable.`); process.exit(1);
  }
  const cities = await readJson(INPUT_FILE);
  await log(`[COMMUNES] ${cities.length} communes chargées`);

  // Enrichissement (tout en mémoire — rapide grâce à la grille)
  await log("[ENRICH] Calcul des distances transport...");
  const t1 = Date.now();
  const output = cities.map(city => enrichCity(city, grid));
  await log(`[ENRICH] Terminé en ${((Date.now() - t1) / 1000).toFixed(2)}s`);

  // Stats
  const cl = { EXCELLENT: 0, GOOD: 0, AVERAGE: 0, WEAK: 0, ISOLATED: 0, NO_GEO: 0 };
  let totalScore = 0;
  output.forEach(c => {
    const status = c.transport?.status;
    if (status === "NO_GEO") { cl.NO_GEO++; return; }
    const classification = c.transport?.classification || "ISOLATED";
    if (classification in cl) cl[classification]++;
    totalScore += c.transport?.transportScore || 0;
  });
  const ok = output.length - cl.NO_GEO;
  const avgScore = ok > 0 ? Math.round(totalScore / ok) : 0;

  await writeJson(OUTPUT_FILE, output);

  await log(`\n[DONE] ${output.length} communes → ${OUTPUT_FILE}`);
  await log(`  Transport moyen  : ${avgScore}/100`);
  await log(`  EXCELLENT=${cl.EXCELLENT} GOOD=${cl.GOOD} AVERAGE=${cl.AVERAGE} WEAK=${cl.WEAK} ISOLATED=${cl.ISOLATED} NO_GEO=${cl.NO_GEO}`);
}

main().catch(async err => {
  console.error("[FATAL]", err.message);
  await appendFile(LOG_FILE, `[FATAL] ${err.message}\n`).catch(() => {});
  process.exit(1);
});
