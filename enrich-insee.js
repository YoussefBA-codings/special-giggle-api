// =============================================================================
// enrich-insee.js  —  Architecture : bulk download INSEE, zéro appel API par ville
//
// Stratégie : télécharger 1 fichier INSEE public (3,8 MB, aucune auth),
// construire un index en mémoire, enrichir les 1265 communes en ~30 secondes.
//
// Source unique : "Base des comparateurs de territoires" (INSEE stat/2521169)
//   Données : RP 2022 + Filosófi 2023 — plus récentes que l'API Données locales
//   URL     : https://www.insee.fr/fr/statistiques/fichier/2521169/base_cc_comparateur_csv.zip
//
// Usage : node enrich-insee.js
// =============================================================================

"use strict";

const { readFile, writeFile, appendFile, mkdir } = require("fs/promises");
const { existsSync, createWriteStream }          = require("fs");
const { pipeline }                               = require("stream/promises");
const { createGunzip }                           = require("zlib");
const path                                       = require("path");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const INPUT_FILE  = process.env.INPUT_FILE  || "cities.geo.json";
const OUTPUT_FILE = process.env.OUTPUT_FILE || "cities.insee.json";
const LOG_FILE    = process.env.LOG_FILE    || "enrich-insee.log";
const ERRORS_FILE = process.env.ERRORS_FILE || "enrich-insee-errors.json";

const CACHE_DIR  = ".insee-cache";                    // cache local des fichiers INSEE
const FORCE_DOWNLOAD = false;                          // true = re-télécharger même si cache existe
const TEST_LIMIT     = null;                           // null = toutes, ex: 20 pour tester

// ---------------------------------------------------------------------------
// Sources INSEE — fichiers bulk (aucune auth requise)
// ---------------------------------------------------------------------------
const SOURCES = {
  comparateur: {
    url:   "https://www.insee.fr/fr/statistiques/fichier/2521169/base_cc_comparateur_csv.zip",
    file:  "base_cc_comparateur.csv",
    cache: "base_cc_comparateur_csv.zip",
    desc:  "Base comparateurs communes (RP 2022 + Filosófi 2023)",
  },
};

// ---------------------------------------------------------------------------
// Mapping colonnes → indicateurs
// ---------------------------------------------------------------------------
// Source : base_cc_comparateur.csv
const COL = {
  code:        "CODGEO",
  pop2022:     "P22_POP",       // Population 2022 (RP millésimé 2022)
  pop2016:     "P16_POP",       // Population 2016 (RP millésimé 2016) → croissance 6 ans
  surface:     "SUPERF",        // Superficie en km²
  logTotal:    "P22_LOG",       // Total logements 2022
  logRP:       "P22_RP",        // Résidences principales 2022
  logVac:      "P22_LOGVAC",    // Logements vacants 2022
  logProp:     "P22_RP_PROP",   // Résidences principales — propriétaires 2022
  medIncome:   "MED_SL23",      // Médiane du niveau de vie 2023 (Filosófi 2023, €/UC)
};

// ---------------------------------------------------------------------------
// Scoring — référentiels IDF
// ---------------------------------------------------------------------------
const REFS = {
  incomeMin:    16000,  // €/UC — seuil bas
  incomeMax:    46000,  // €/UC — seuil haut IDF
  vacancyBest:  3,      // % — très tendu
  vacancyWorst: 16,     // % — alarmant
  tenantBest:   55,     // % — marché locatif très actif
  tenantWorst:  18,     // % — marché locatif étroit
  growthBest:   8,      // % sur 6 ans — fort dynamisme
  growthWorst:  -5,     // % sur 6 ans — déclin net
  popBest:      100000, // habitants — échelle log
  popMin:       200,    // habitants — seuil de liquidité
};

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf-8"));
}

async function writeJson(filePath, data) {
  await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

async function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { await appendFile(LOG_FILE, line + "\n", "utf-8"); } catch { /* non-fatal */ }
}

async function logError(payload) {
  let list = [];
  if (existsSync(ERRORS_FILE)) {
    try { list = await readJson(ERRORS_FILE); } catch { list = []; }
  }
  list.push({ ...payload, timestamp: new Date().toISOString() });
  try { await writeJson(ERRORS_FILE, list); } catch { /* non-fatal */ }
}

// ---------------------------------------------------------------------------
// Téléchargement avec décompression ZIP automatique
// ---------------------------------------------------------------------------

async function downloadFile(url, destPath) {
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 120000); // 2 min max

  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const writer = createWriteStream(destPath);
    const reader = response.body;

    await new Promise((resolve, reject) => {
      const nodeStream = require("stream").Readable.fromWeb(reader);
      nodeStream.pipe(writer);
      writer.on("finish", resolve);
      writer.on("error", reject);
      nodeStream.on("error", reject);
    });

    return destPath;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

// Extrait un fichier CSV d'un ZIP vers un répertoire
async function extractCsvFromZip(zipPath, targetFileName, destDir) {
  const { exec } = require("child_process");
  const { promisify } = require("util");
  const execAsync = promisify(exec);

  const destPath = path.join(destDir, targetFileName);

  // Utiliser unzip natif (disponible sur macOS/Linux)
  await execAsync(`unzip -p "${zipPath}" "${targetFileName}" > "${destPath}"`);

  return destPath;
}

// ---------------------------------------------------------------------------
// Chargement de la source INSEE
// ---------------------------------------------------------------------------

async function loadComparateurIndex() {
  // Créer le répertoire cache si nécessaire
  if (!existsSync(CACHE_DIR)) {
    await mkdir(CACHE_DIR, { recursive: true });
  }

  const src     = SOURCES.comparateur;
  const zipPath = path.join(CACHE_DIR, src.cache);
  const csvPath = path.join(CACHE_DIR, src.file);

  // Télécharger si nécessaire
  if (FORCE_DOWNLOAD || !existsSync(zipPath)) {
    await log(`[DOWNLOAD] ${src.desc}`);
    await log(`[DOWNLOAD] URL: ${src.url}`);
    await downloadFile(src.url, zipPath);
    const stat = require("fs").statSync(zipPath);
    await log(`[DOWNLOAD] OK — ${(stat.size / 1024 / 1024).toFixed(1)} MB`);
  } else {
    await log(`[CACHE] Using cached ${src.cache}`);
  }

  // Extraire le CSV si nécessaire
  if (FORCE_DOWNLOAD || !existsSync(csvPath)) {
    await log(`[EXTRACT] Extracting ${src.file}...`);
    await extractCsvFromZip(zipPath, src.file, CACHE_DIR);
    await log(`[EXTRACT] OK`);
  }

  // Lire le CSV et construire l'index
  await log(`[INDEX] Building commune index...`);

  const content = await readFile(csvPath, "utf-8");
  const lines   = content.split("\n");
  const header  = lines[0].split(";").map(s => s.trim());

  // Trouver les indices des colonnes
  const idx = {};
  for (const [key, colName] of Object.entries(COL)) {
    idx[key] = header.indexOf(colName);
    if (idx[key] === -1) {
      await log(`[WARN] Column "${colName}" not found in header`);
    }
  }

  // Construire l'index par code INSEE
  const index = new Map();
  let rowCount = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols    = line.split(";");
    const inseeCode = cols[idx.code]?.trim();
    if (!inseeCode || inseeCode.length < 5) continue;

    // Parser une valeur numérique (peut être "s" pour secret statistique)
    const parseNum = (colIdx) => {
      if (colIdx === -1 || colIdx >= cols.length) return null;
      const raw = cols[colIdx]?.trim();
      if (!raw || raw === "s" || raw === "nd" || raw === "") return null;
      const n = parseFloat(raw.replace(",", "."));
      return isNaN(n) ? null : n;
    };

    index.set(inseeCode, {
      pop2022:  parseNum(idx.pop2022),
      pop2016:  parseNum(idx.pop2016),
      surface:  parseNum(idx.surface),
      logTotal: parseNum(idx.logTotal),
      logRP:    parseNum(idx.logRP),
      logVac:   parseNum(idx.logVac),
      logProp:  parseNum(idx.logProp),
      medIncome: parseNum(idx.medIncome),
    });

    rowCount++;
  }

  await log(`[INDEX] ${rowCount.toLocaleString()} communes indexed`);
  return index;
}

// ---------------------------------------------------------------------------
// Calcul des indicateurs
// ---------------------------------------------------------------------------

function computeIndicators(entry) {
  if (!entry) return null;

  const {
    pop2022, pop2016, surface, logTotal, logRP, logVac, logProp, medIncome,
  } = entry;

  // Population
  const population = pop2022;

  // Croissance population 6 ans (2016 → 2022)
  let populationGrowth6Y = null;
  if (pop2022 !== null && pop2016 !== null && pop2016 > 0) {
    populationGrowth6Y = Math.round(((pop2022 - pop2016) / pop2016) * 1000) / 10;
  }

  // Taux de vacance = logements vacants / total logements (×100)
  let vacancyRate = null;
  if (logVac !== null && logTotal !== null && logTotal > 0) {
    vacancyRate = Math.round((logVac / logTotal) * 1000) / 10;
  }

  // Part propriétaires = prop / résidences principales
  let ownerShare = null;
  if (logProp !== null && logRP !== null && logRP > 0) {
    ownerShare = Math.round((logProp / logRP) * 1000) / 10;
  }

  // Part locataires = (RP - propriétaires) / RP
  // Note : inclut les logés gratuitement (~3-5% des RP) — légère surestimation du côté locataires
  let tenantShare = null;
  if (logProp !== null && logRP !== null && logRP > 0) {
    const nonProp  = logRP - logProp;
    tenantShare    = Math.round((nonProp / logRP) * 1000) / 10;
    // Correction minimale : logés gratuit ≈ 4% des RP en moyenne
    // tenantShare_corrected ≈ tenantShare - 4   (à décommenter si précision requise)
  }

  // Revenu médian disponible par UC (€/an, Filosófi 2023)
  const medianIncome = medIncome;

  // Densité
  let density = null;
  if (population !== null && surface !== null && surface > 0) {
    density = Math.round((population / surface) * 10) / 10; // hab/km²
  }

  return {
    population,
    populationGrowth6Y,  // 2016 → 2022
    medianIncome,
    vacancyRate,
    tenantShare,
    ownerShare,
    density,
    dataYear: { population: 2022, income: 2023, housing: 2022 },
  };
}

// ---------------------------------------------------------------------------
// Scores (0–100)
// ---------------------------------------------------------------------------

function clamp(v) {
  return Math.max(0, Math.min(100, Math.round(v)));
}

function linearScore(value, best, worst) {
  if (value === null || value === undefined) return null;
  if (best === worst) return 50;
  return clamp(((value - worst) / (best - worst)) * 100);
}

function computeScores(ind) {
  const scores = {};

  // socioEconomicScore : revenu + vacance + population
  {
    const parts = [];
    if (ind.medianIncome !== null) {
      parts.push({ v: linearScore(ind.medianIncome, REFS.incomeMax, REFS.incomeMin), w: 3 });
    }
    if (ind.vacancyRate !== null) {
      parts.push({ v: linearScore(ind.vacancyRate, REFS.vacancyBest, REFS.vacancyWorst), w: 2 });
    }
    if (ind.population !== null && ind.population > 0) {
      const logScore = clamp(
        (Math.log10(Math.max(1, ind.population)) - Math.log10(REFS.popMin)) /
        (Math.log10(REFS.popBest)               - Math.log10(REFS.popMin)) * 100
      );
      parts.push({ v: logScore, w: 1 });
    }
    if (parts.length > 0) {
      const totalW = parts.reduce((s, p) => s + p.w, 0);
      scores.socioEconomicScore = clamp(
        parts.reduce((s, p) => s + p.v * p.w, 0) / totalW
      );
    } else {
      scores.socioEconomicScore = null;
    }
  }

  // growthScore : croissance population 6 ans
  {
    if (ind.populationGrowth6Y !== null) {
      scores.growthScore = linearScore(ind.populationGrowth6Y, REFS.growthBest, REFS.growthWorst);
    } else {
      scores.growthScore = null;
    }
  }

  // rentalMarketScore : tenantShare + vacance
  {
    const parts = [];
    if (ind.tenantShare !== null) {
      parts.push({ v: linearScore(ind.tenantShare, REFS.tenantBest, REFS.tenantWorst), w: 2 });
    }
    if (ind.vacancyRate !== null) {
      parts.push({ v: linearScore(ind.vacancyRate, REFS.vacancyBest, REFS.vacancyWorst), w: 1 });
    }
    if (parts.length > 0) {
      const totalW = parts.reduce((s, p) => s + p.w, 0);
      scores.rentalMarketScore = clamp(
        parts.reduce((s, p) => s + p.v * p.w, 0) / totalW
      );
    } else {
      scores.rentalMarketScore = null;
    }
  }

  return scores;
}

// ---------------------------------------------------------------------------
// Enrichissement d'une ville
// ---------------------------------------------------------------------------

function enrichCity(city, index) {
  const inseeCode = city.geo?.inseeCode;

  if (!inseeCode) {
    return {
      ...city,
      insee: {
        status: "NO_INSEE_CODE",
        error:  "No inseeCode in geo block",
        population: null, populationGrowth6Y: null, medianIncome: null,
        vacancyRate: null, tenantShare: null, ownerShare: null, density: null,
        socioEconomicScore: null, growthScore: null, rentalMarketScore: null,
        dataYear: null,
      },
    };
  }

  const entry = index.get(inseeCode);

  if (!entry) {
    return {
      ...city,
      insee: {
        status: "NOT_IN_SOURCE",
        error:  `Code ${inseeCode} not found in INSEE comparateur`,
        population: null, populationGrowth6Y: null, medianIncome: null,
        vacancyRate: null, tenantShare: null, ownerShare: null, density: null,
        socioEconomicScore: null, growthScore: null, rentalMarketScore: null,
        dataYear: null,
      },
    };
  }

  const ind    = computeIndicators(entry);
  const scores = computeScores(ind);

  const anyNull = [
    ind.medianIncome, ind.vacancyRate, ind.tenantShare,
  ].some(v => v === null);

  const status = anyNull ? "PARTIAL" : "OK";

  return {
    ...city,
    insee: {
      status,
      error: null,
      population:         ind.population,
      populationGrowth6Y: ind.populationGrowth6Y,
      medianIncome:       ind.medianIncome,
      vacancyRate:        ind.vacancyRate,
      tenantShare:        ind.tenantShare,
      ownerShare:         ind.ownerShare,
      density:            ind.density,
      socioEconomicScore:  scores.socioEconomicScore,
      growthScore:         scores.growthScore,
      rentalMarketScore:   scores.rentalMarketScore,
      dataYear:            ind.dataYear,
    },
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  await log("[START] enrich-insee.js (bulk download mode)");

  // Lire les villes
  let cities;
  try {
    cities = await readJson(INPUT_FILE);
  } catch (err) {
    await log(`[FATAL] Cannot read ${INPUT_FILE}: ${err.message}`);
    process.exit(1);
  }

  if (!Array.isArray(cities)) {
    await log(`[FATAL] ${INPUT_FILE} is not an array`);
    process.exit(1);
  }

  if (TEST_LIMIT !== null) {
    cities = cities.slice(0, TEST_LIMIT);
    await log(`[TEST] Limited to ${TEST_LIMIT} cities`);
  }

  await log(`[START] ${cities.length} cities loaded`);

  // Charger l'index INSEE
  let index;
  try {
    index = await loadComparateurIndex();
  } catch (err) {
    await log(`[FATAL] Cannot load INSEE data: ${err.message}`);
    process.exit(1);
  }

  // Enrichir toutes les villes
  await log(`[ENRICH] Processing ${cities.length} cities...`);
  const start = Date.now();

  const outputArr = cities.map((city) => enrichCity(city, index));

  const elapsed = ((Date.now() - start) / 1000).toFixed(2);

  // Écrire le résultat
  await writeJson(OUTPUT_FILE, outputArr);

  // Stats
  const ok       = outputArr.filter(c => c.insee?.status === "OK").length;
  const partial  = outputArr.filter(c => c.insee?.status === "PARTIAL").length;
  const noCode   = outputArr.filter(c => c.insee?.status === "NO_INSEE_CODE").length;
  const notFound = outputArr.filter(c => c.insee?.status === "NOT_IN_SOURCE").length;

  await log(`[DONE] ${cities.length} cities enriched in ${elapsed}s`);
  await log(`  OK:              ${ok}`);
  await log(`  PARTIAL:         ${partial}`);
  await log(`  NO_INSEE_CODE:   ${noCode}`);
  await log(`  NOT_IN_SOURCE:   ${notFound}`);
  await log(`[DONE] Output: ${OUTPUT_FILE}`);

  // Log des cas NOT_IN_SOURCE pour debug
  if (notFound > 0) {
    const missing = outputArr.filter(c => c.insee?.status === "NOT_IN_SOURCE");
    await log(`[WARN] Missing codes: ${missing.map(c => `${c.city}(${c.geo?.inseeCode})`).join(", ")}`);
    await logError({ type: "NOT_IN_SOURCE", cities: missing.map(c => ({ city: c.city, inseeCode: c.geo?.inseeCode })) });
  }
}

main().catch(async (err) => {
  log(`[FATAL] ${err.message}\n${err.stack}`).catch(() => {});
  process.exit(1);
});
