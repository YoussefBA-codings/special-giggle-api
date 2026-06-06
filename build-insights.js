// =============================================================================
// build-insights.js
// Moteur de décision immobilier — enrichit cities.transport.json
// Usage : node build-insights.js
// =============================================================================

"use strict";

const { readFile, writeFile } = require("fs/promises");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const INPUT_FILE  = process.env.INPUT_FILE  || "cities.transport.json";
const OUTPUT_FILE = process.env.OUTPUT_FILE || "cities.final.json";

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf-8"));
}

async function writeJson(filePath, data) {
  await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function safeNumber(value) {
  const n = Number(value);
  return isFinite(n) ? n : 0;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function median(values) {
  if (!values || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function average(values) {
  if (!values || values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

// Retourne le score 0-100 de positionnement de value dans sortedValues.
// direction 'asc'  → valeur haute = rang haut
// direction 'desc' → valeur basse = rang haut
function percentileRank(value, sortedValues, direction = "asc") {
  if (!sortedValues || sortedValues.length === 0 || value === null || value === undefined)
    return 50;
  const n = sortedValues.length;
  let below = 0;
  for (const v of sortedValues) {
    if (v < value) below++;
  }
  const rank = (below / n) * 100;
  return Math.round(direction === "asc" ? rank : 100 - rank);
}

// Valeur au percentile donné d'un tableau trié
function percentileValue(sortedValues, pct) {
  if (!sortedValues || sortedValues.length === 0) return 0;
  const idx = Math.floor((pct / 100) * sortedValues.length);
  return sortedValues[Math.min(idx, sortedValues.length - 1)];
}

// Moyenne pondérée : items = [{ value, weight }]
function weightedAverage(items) {
  let totalWeight = 0;
  let totalValue  = 0;
  for (const { value, weight } of items) {
    totalWeight += weight;
    totalValue  += safeNumber(value) * weight;
  }
  return totalWeight === 0 ? 0 : totalValue / totalWeight;
}

// ---------------------------------------------------------------------------
// Contexte global (médianes, percentiles, stats)
// ---------------------------------------------------------------------------

function buildGlobalContext(cities) {
  const yields     = [];
  const prices     = [];
  const rents      = [];
  const growths    = [];
  const vacancies  = [];
  const transports = [];
  const incomes    = [];
  const populations = [];
  const densities   = [];
  const tenantShares = [];

  for (const c of cities) {
    const aptY  = safeNumber(c.prices?.apartment?.grossYield);
    const hseY  = safeNumber(c.prices?.house?.grossYield);
    if (aptY > 0) yields.push(aptY);
    if (hseY > 0) yields.push(hseY);

    const aptP = safeNumber(c.prices?.apartment?.average);
    const hseP = safeNumber(c.prices?.house?.average);
    if (aptP > 0) prices.push(aptP);
    if (hseP > 0) prices.push(hseP);

    const aptR = safeNumber(c.prices?.apartment?.rent);
    const hseR = safeNumber(c.prices?.house?.rent);
    if (aptR > 0) rents.push(aptR);
    if (hseR > 0) rents.push(hseR);

    const g = c.insee?.populationGrowth6Y;
    if (g !== null && g !== undefined) growths.push(g);

    const v = c.insee?.vacancyRate;
    if (v !== null && v !== undefined) vacancies.push(v);

    transports.push(safeNumber(c.transport?.transportInvestmentScore));

    const inc = c.insee?.medianIncome;
    if (inc) incomes.push(inc);

    const pop = c.insee?.population || safeNumber(c.geo?.population);
    if (pop > 0) populations.push(pop);

    const den = c.insee?.density;
    if (den) densities.push(den);

    const ten = c.insee?.tenantShare;
    if (ten) tenantShares.push(ten);
  }

  const sort = (a) => [...a].sort((x, y) => x - y);
  const sy = sort(yields);
  const sp = sort(prices);
  const sr = sort(rents);
  const sg = sort(growths);
  const sv = sort(vacancies);
  const st = sort(transports);
  const si = sort(incomes);

  return {
    yields:      sy,
    prices:      sp,
    rents:       sr,
    growthRates: sg,
    vacancyRates: sv,
    transportScores: st,
    medianIncomes: si,
    populations: sort(populations),
    densities:   sort(densities),
    tenantShares: sort(tenantShares),
    medians: {
      yield:         median(sy),
      price:         median(sp),
      rent:          median(sr),
      growthRate:    median(sg),
      vacancyRate:   median(sv),
      transportScore: median(st),
      medianIncome:  median(si),
    },
    percentiles: {
      yield_20:    percentileValue(sy, 20),
      yield_80:    percentileValue(sy, 80),
      price_20:    percentileValue(sp, 20),
      price_80:    percentileValue(sp, 80),
      rent_20:     percentileValue(sr, 20),
      rent_80:     percentileValue(sr, 80),
      transport_20: percentileValue(st, 20),
      transport_80: percentileValue(st, 80),
      income_20:   percentileValue(si, 20),
      income_80:   percentileValue(si, 80),
      vacancy_20:  percentileValue(sv, 20),
      vacancy_80:  percentileValue(sv, 80),
      growth_20:   percentileValue(sg, 20),
      growth_80:   percentileValue(sg, 80),
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers internes
// ---------------------------------------------------------------------------

function getBestPropertyType(city) {
  const aptY  = safeNumber(city.prices?.apartment?.grossYield);
  const hseY  = safeNumber(city.prices?.house?.grossYield);
  if (aptY > 0 && hseY > 0) return aptY >= hseY ? "apartment" : "house";
  if (aptY > 0) return "apartment";
  if (hseY > 0) return "house";
  if (safeNumber(city.prices?.apartment?.average) > 0) return "apartment";
  if (safeNumber(city.prices?.house?.average) > 0) return "house";
  return "apartment";
}

function getBestYield(city) {
  return Math.max(
    safeNumber(city.prices?.apartment?.grossYield),
    safeNumber(city.prices?.house?.grossYield)
  );
}

function hasNoPriceData(city) {
  return !city.prices?.apartment?.grossYield && !city.prices?.house?.grossYield;
}

// ---------------------------------------------------------------------------
// Scores de base (0-100)
// ---------------------------------------------------------------------------

function calculateYieldScore(city) {
  const y = getBestYield(city);
  if (y <= 0) return 0;
  if (y >= 10) return 100;
  if (y >= 8)  return 90;
  if (y >= 6)  return 75;
  if (y >= 4)  return 55;
  if (y >= 3)  return 35;
  return 15;
}

function calculatePriceAccessibilityScore(city, context) {
  const type  = getBestPropertyType(city);
  const price = safeNumber(city.prices?.[type]?.average);
  if (price <= 0) return 50;
  // Moins cher = meilleur score (percentile inversé)
  return percentileRank(price, context.prices, "desc");
}

function calculateRentPowerScore(city, context) {
  const type = getBestPropertyType(city);
  const rent = safeNumber(city.prices?.[type]?.rent);
  if (rent <= 0) return 50;
  return percentileRank(rent, context.rents, "asc");
}

function calculateSocioScore(city, context) {
  // Utiliser le score pré-calculé INSEE si disponible
  if (city.insee?.socioEconomicScore !== null && city.insee?.socioEconomicScore !== undefined) {
    return clamp(city.insee.socioEconomicScore);
  }
  // Calcul de secours
  const income  = safeNumber(city.insee?.medianIncome);
  const vacancy = safeNumber(city.insee?.vacancyRate);
  const pop     = safeNumber(city.insee?.population || city.geo?.population);
  let s = 0;
  if (income > 0) s += percentileRank(income, context.medianIncomes, "asc") * 0.5;
  if (vacancy > 0) s += (100 - percentileRank(vacancy, context.vacancyRates, "asc")) * 0.3;
  if (pop > 0) s += Math.min(100, (pop / 50000) * 100) * 0.2;
  return clamp(s);
}

function calculateGrowthScore(city) {
  if (city.insee?.growthScore !== null && city.insee?.growthScore !== undefined) {
    return clamp(city.insee.growthScore);
  }
  const g = city.insee?.populationGrowth6Y;
  if (g === null || g === undefined) return 30;
  if (g >= 10)  return 100;
  if (g >= 5)   return 85;
  if (g >= 2)   return 68;
  if (g >= 0)   return 52;
  if (g >= -3)  return 35;
  if (g >= -7)  return 18;
  return 5;
}

function calculateRentalDemandScore(city, context) {
  const transportInvest = safeNumber(city.transport?.transportInvestmentScore);

  // Score pré-calculé INSEE + bonus transport
  if (city.insee?.rentalMarketScore !== null && city.insee?.rentalMarketScore !== undefined) {
    const base    = clamp(city.insee.rentalMarketScore);
    const tBonus  = transportInvest * 0.30;
    return clamp(base * 0.70 + tBonus);
  }

  // Calcul de secours
  const tenantShare = safeNumber(city.insee?.tenantShare);
  const vacancy     = safeNumber(city.insee?.vacancyRate);
  const pop         = safeNumber(city.insee?.population || city.geo?.population);
  const density     = safeNumber(city.insee?.density);

  let s = 0;
  if (tenantShare > 0) s += Math.min(100, (tenantShare / 50) * 100) * 0.30;
  if (vacancy > 0)     s += Math.max(0, 100 - (vacancy / 15) * 100) * 0.25;
  else                 s += 60 * 0.25;
  s += transportInvest * 0.25;
  if (pop > 0) s += Math.min(100, Math.log10(Math.max(1, pop)) / Math.log10(100000) * 100) * 0.10;
  if (density > 0) s += Math.min(100, (density / 5000) * 100) * 0.10;
  return clamp(s);
}

function calculateTransportScore(city) {
  return clamp(safeNumber(city.transport?.transportInvestmentScore));
}

// ---------------------------------------------------------------------------
// Score de risque (0 = peu risqué, 100 = très risqué)
// ---------------------------------------------------------------------------

function calculateRiskScore(city, context) {
  let risk = 0;

  const vacancy         = safeNumber(city.insee?.vacancyRate);
  const populationGrowth = city.insee?.populationGrowth6Y;
  const transportInvest = safeNumber(city.transport?.transportInvestmentScore);
  const pop             = safeNumber(city.insee?.population || city.geo?.population);
  const rentalMarket    = city.insee?.rentalMarketScore;
  const medianIncome    = safeNumber(city.insee?.medianIncome);
  const bestYield       = getBestYield(city);

  // Vacance
  if (vacancy > 20)     risk += 30;
  else if (vacancy > 15) risk += 22;
  else if (vacancy > 10) risk += 15;
  else if (vacancy > 7)  risk += 8;
  else if (vacancy > 0)  risk += 2;

  // Démographie
  if (populationGrowth !== null && populationGrowth !== undefined) {
    if (populationGrowth < -10)  risk += 25;
    else if (populationGrowth < -5) risk += 18;
    else if (populationGrowth < -2) risk += 10;
    else if (populationGrowth < 0)  risk += 5;
  }

  // Transport
  if (transportInvest < 10)      risk += 20;
  else if (transportInvest < 20) risk += 15;
  else if (transportInvest < 30) risk += 10;
  else if (transportInvest < 50) risk += 4;

  // Taille de commune
  if (pop > 0) {
    if (pop < 500)       risk += 20;
    else if (pop < 1000) risk += 14;
    else if (pop < 2000) risk += 8;
    else if (pop < 5000) risk += 3;
  }

  // Marché locatif
  if (rentalMarket !== null && rentalMarket !== undefined) {
    if (rentalMarket < 15)      risk += 14;
    else if (rentalMarket < 25) risk += 9;
    else if (rentalMarket < 35) risk += 4;
  }

  // Revenu
  if (medianIncome > 0) {
    const incRank = percentileRank(medianIncome, context.medianIncomes, "asc");
    if (incRank < 15) risk += 10;
    else if (incRank < 25) risk += 5;
  }

  // Signal rendement piège : yield très élevé avec mauvais fondamentaux
  if (bestYield >= 10 && (vacancy > 10 || transportInvest < 25)) risk += 10;

  // Données manquantes
  if (hasNoPriceData(city)) risk += 12;

  return clamp(risk);
}

// ---------------------------------------------------------------------------
// Scores composites
// ---------------------------------------------------------------------------

function calculateCashflowScore(city, scores) {
  const { yieldScore, priceAccessibilityScore, rentPowerScore, riskScore } = scores;
  const inverseRisk = 100 - riskScore;

  let s = weightedAverage([
    { value: yieldScore,              weight: 0.45 },
    { value: priceAccessibilityScore, weight: 0.25 },
    { value: rentPowerScore,          weight: 0.15 },
    { value: inverseRisk,             weight: 0.15 },
  ]);

  const vacancy  = safeNumber(city.insee?.vacancyRate);
  const transport = safeNumber(city.transport?.transportInvestmentScore);
  if (vacancy > 12)   s *= 0.74;
  else if (vacancy > 8) s *= 0.88;
  if (transport < 20) s *= 0.84;
  else if (transport < 35) s *= 0.92;

  return clamp(s);
}

function calculateBeginnerScore(city, scores) {
  const { riskScore, transportScore, socioScore, rentalDemandScore, yieldScore } = scores;
  const inverseRisk = 100 - riskScore;

  let s = weightedAverage([
    { value: inverseRisk,        weight: 0.30 },
    { value: transportScore,     weight: 0.25 },
    { value: socioScore,         weight: 0.20 },
    { value: rentalDemandScore,  weight: 0.15 },
    { value: yieldScore,         weight: 0.10 },
  ]);

  const vacancy  = safeNumber(city.insee?.vacancyRate);
  const transport = safeNumber(city.transport?.transportInvestmentScore);
  if (riskScore > 65)  s = Math.min(s, 35);
  if (vacancy > 12)    s = Math.min(s, 45);
  if (transport < 20)  s = Math.min(s, 40);

  return clamp(s);
}

function calculateLongTermScore(city, scores) {
  const { growthScore, transportScore, socioScore, rentalDemandScore, priceAccessibilityScore } = scores;

  return clamp(weightedAverage([
    { value: growthScore,              weight: 0.35 },
    { value: transportScore,           weight: 0.25 },
    { value: socioScore,               weight: 0.20 },
    { value: rentalDemandScore,        weight: 0.10 },
    { value: priceAccessibilityScore,  weight: 0.10 },
  ]));
}

function calculatePatrimonialScore(city, scores) {
  const { socioScore, transportScore, rentalDemandScore, growthScore, riskScore } = scores;
  const inverseRisk = 100 - riskScore;

  return clamp(weightedAverage([
    { value: socioScore,        weight: 0.35 },
    { value: transportScore,    weight: 0.25 },
    { value: rentalDemandScore, weight: 0.20 },
    { value: growthScore,       weight: 0.10 },
    { value: inverseRisk,       weight: 0.10 },
  ]));
}

function calculateGlobalScore(city, scores) {
  const { cashflowScore, beginnerScore, longTermScore, patrimonialScore, riskScore } = scores;
  const inverseRisk = 100 - riskScore;
  const transport   = safeNumber(city.transport?.transportInvestmentScore);
  const vacancy     = safeNumber(city.insee?.vacancyRate);

  let s = weightedAverage([
    { value: cashflowScore,    weight: 0.25 },
    { value: beginnerScore,    weight: 0.20 },
    { value: longTermScore,    weight: 0.20 },
    { value: patrimonialScore, weight: 0.20 },
    { value: inverseRisk,      weight: 0.15 },
  ]);

  if (riskScore > 80)                        s = Math.min(s, 45);
  if (transport < 10 && vacancy > 10)        s = Math.min(s, 40);
  if (hasNoPriceData(city))                  s = Math.min(s, 25);
  if (city.insee?.status !== "OK")           s = Math.min(s, 50);

  return clamp(s);
}

// ---------------------------------------------------------------------------
// Flags de contexte percentile
// ---------------------------------------------------------------------------

function computeContextFlags(city, context) {
  const type   = getBestPropertyType(city);
  const price  = safeNumber(city.prices?.[type]?.average);
  const bestY  = getBestYield(city);
  const rent   = safeNumber(city.prices?.[type]?.rent);
  const growth = city.insee?.populationGrowth6Y;
  const vac    = safeNumber(city.insee?.vacancyRate);
  const trans  = safeNumber(city.transport?.transportInvestmentScore);
  const income = safeNumber(city.insee?.medianIncome);

  const flag = (rank) => {
    if (rank <= 20) return "bottom_20";
    if (rank >= 80) return "top_20";
    return "middle";
  };

  return {
    priceVsDataset:     price  > 0 ? flag(percentileRank(price,  context.prices,           "asc")) : null,
    yieldVsDataset:     bestY  > 0 ? flag(percentileRank(bestY,  context.yields,           "asc")) : null,
    rentVsDataset:      rent   > 0 ? flag(percentileRank(rent,   context.rents,            "asc")) : null,
    growthVsDataset:    growth !== null && growth !== undefined ? flag(percentileRank(growth, context.growthRates, "asc")) : null,
    vacancyVsDataset:   vac    > 0 ? flag(percentileRank(vac,   context.vacancyRates,     "asc")) : null,
    transportVsDataset: flag(percentileRank(trans, context.transportScores, "asc")),
    incomeVsDataset:    income > 0 ? flag(percentileRank(income, context.medianIncomes,    "asc")) : null,
  };
}

// ---------------------------------------------------------------------------
// Profil, risk level, recommendation
// ---------------------------------------------------------------------------

function detectInvestmentProfile(city, scores) {
  const { cashflowScore, yieldScore, riskScore, beginnerScore, patrimonialScore,
          longTermScore, globalScore, growthScore, socioScore, rentalDemandScore } = scores;
  const bestYield   = getBestYield(city);
  const vacancy     = safeNumber(city.insee?.vacancyRate);
  const transport   = safeNumber(city.transport?.transportInvestmentScore);

  if (hasNoPriceData(city) || city.insee?.status !== "OK") return "DATA_INCOMPLETE";

  // YIELD_TRAP : rendement élevé mais risque
  if ((yieldScore >= 85 && riskScore >= 65) ||
      (bestYield >= 10 && transport < 25) ||
      (bestYield >= 10 && vacancy > 12)) return "YIELD_TRAP";

  // CASHFLOW_OPPORTUNITY
  if (cashflowScore >= 70 && riskScore < 65 && yieldScore >= 70) return "CASHFLOW_OPPORTUNITY";

  // BEGINNER_FRIENDLY
  if (beginnerScore >= 70 && riskScore < 45 && transport >= 50 && rentalDemandScore >= 50)
    return "BEGINNER_FRIENDLY";

  // PATRIMONIAL_SAFE
  if (patrimonialScore >= 70 && riskScore < 45 && socioScore >= 60 && transport >= 60)
    return "PATRIMONIAL_SAFE";

  // LONG_TERM_POTENTIAL
  if (longTermScore >= 70 && growthScore >= 60 && transport >= 50) return "LONG_TERM_POTENTIAL";

  // BALANCED_OPPORTUNITY
  if (globalScore >= 65 && riskScore < 60) return "BALANCED_OPPORTUNITY";

  // LOW_INTEREST
  if (globalScore < 40) return "LOW_INTEREST";

  return "BALANCED_OPPORTUNITY";
}

function detectRiskLevel(scores) {
  const r = scores.riskScore;
  if (r < 30) return "LOW";
  if (r < 55) return "MODERATE";
  if (r < 75) return "HIGH";
  return "VERY_HIGH";
}

function detectRecommendation(city, scores) {
  const { globalScore, riskScore, yieldScore, beginnerScore } = scores;

  if (hasNoPriceData(city) || city.insee?.status !== "OK") return "DATA_TO_VERIFY";
  if (globalScore >= 75 && riskScore < 50)  return "STRONG_OPPORTUNITY";
  if (globalScore >= 60 && riskScore < 65)  return "GOOD_TO_ANALYZE";
  if (yieldScore  >= 80 && riskScore >= 60) return "ONLY_EXPERIENCED";
  if (globalScore < 35  && riskScore >= 70) return "AVOID";
  if (beginnerScore < 40 && riskScore >= 60) return "AVOID_FOR_BEGINNER";
  return "GOOD_TO_ANALYZE";
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

function detectTags(city, scores, context) {
  const tags = [];
  const { yieldScore, priceAccessibilityScore, rentPowerScore, riskScore,
          beginnerScore, cashflowScore, longTermScore, patrimonialScore,
          socioScore, rentalDemandScore } = scores;

  const bestYield   = getBestYield(city);
  const vacancy     = safeNumber(city.insee?.vacancyRate);
  const growth      = city.insee?.populationGrowth6Y;
  const tenantShare = safeNumber(city.insee?.tenantShare);
  const transport   = safeNumber(city.transport?.transportInvestmentScore);

  // Rendement
  if (bestYield >= 10)     tags.push("Très haut rendement apparent");
  else if (bestYield >= 6) tags.push("Bon rendement");
  else if (bestYield > 0 && bestYield < 4) tags.push("Rendement faible");

  // Prix
  if (priceAccessibilityScore >= 80) tags.push("Prix très accessible");
  else if (priceAccessibilityScore <= 20) tags.push("Prix élevé");

  // Loyer
  if (rentPowerScore >= 75) tags.push("Loyer élevé");

  // Vacance
  if (vacancy > 12)                  tags.push("Vacance élevée");
  else if (vacancy > 0 && vacancy <= 5) tags.push("Faible vacance");

  // Croissance
  if (growth !== null && growth !== undefined) {
    if (growth > 3)  tags.push("Population en croissance");
    else if (growth < -3) tags.push("Population en baisse");
  }

  // Revenu / socio
  if (socioScore >= 70)      tags.push("Revenus élevés");
  else if (socioScore <= 35) tags.push("Revenus modestes");

  // Marché locatif
  if (tenantShare >= 45)              tags.push("Forte part de locataires");
  else if (tenantShare > 0 && tenantShare < 20) tags.push("Faible marché locatif");

  // Transport
  if (transport >= 70)      tags.push("Très bien desservie");
  else if (transport >= 40) tags.push("Correctement desservie");
  else if (transport < 20)  tags.push("Commune isolée");

  // Profils
  if (beginnerScore >= 65) tags.push("Adaptée débutant");
  if (cashflowScore >= 70 && riskScore < 65) tags.push("Cashflow intéressant");

  // Piège rendement
  if (bestYield >= 10 && (vacancy > 10 || transport < 25)) tags.push("Rendement potentiellement piège");

  if (patrimonialScore >= 70 && riskScore < 45) tags.push("Patrimonial sécurisé");
  if (longTermScore >= 70)                       tags.push("Potentiel long terme");

  if (hasNoPriceData(city) || city.insee?.status !== "OK") tags.push("Données à vérifier");

  return tags;
}

// ---------------------------------------------------------------------------
// Forces
// ---------------------------------------------------------------------------

function detectStrengths(city, scores) {
  const strengths = [];
  const { yieldScore, priceAccessibilityScore, rentPowerScore,
          growthScore, socioScore, rentalDemandScore, cashflowScore, riskScore } = scores;

  const bestYield = getBestYield(city);
  const vacancy   = safeNumber(city.insee?.vacancyRate);
  const tenant    = safeNumber(city.insee?.tenantShare);
  const growth    = city.insee?.populationGrowth6Y;
  const transport = safeNumber(city.transport?.transportInvestmentScore);

  if (bestYield >= 8) strengths.push(`Rendement brut très élevé (${bestYield.toFixed(1)}%)`);
  else if (bestYield >= 5) strengths.push(`Rendement brut solide (${bestYield.toFixed(1)}%)`);

  if (priceAccessibilityScore >= 75) strengths.push("Prix au m² très accessible");

  if (rentPowerScore >= 70) strengths.push("Loyer au m² intéressant");

  if (growth !== null && growth !== undefined && growth > 3) {
    strengths.push(`Population en croissance (+${growth.toFixed(1)}% sur 6 ans)`);
  }

  if (socioScore >= 65) strengths.push("Revenus médians solides");

  if (vacancy > 0 && vacancy <= 5) strengths.push(`Faible vacance logement (${vacancy}%)`);

  if (transport >= 60) strengths.push("Bonne desserte en transports");

  if (tenant >= 40) strengths.push(`Forte part de locataires (${tenant}%)`);

  if (cashflowScore >= 65 && riskScore < 60) strengths.push("Bon équilibre rendement / risque");

  return strengths;
}

// ---------------------------------------------------------------------------
// Faiblesses
// ---------------------------------------------------------------------------

function detectWeaknesses(city, scores) {
  const weaknesses = [];
  const { yieldScore, riskScore, socioScore, priceAccessibilityScore } = scores;

  const bestYield = getBestYield(city);
  const vacancy   = safeNumber(city.insee?.vacancyRate);
  const growth    = city.insee?.populationGrowth6Y;
  const tenant    = safeNumber(city.insee?.tenantShare);
  const pop       = safeNumber(city.insee?.population || city.geo?.population);
  const transport = safeNumber(city.transport?.transportInvestmentScore);

  if (vacancy > 10) weaknesses.push(`Vacance logement élevée (${vacancy}%)`);

  if (growth !== null && growth !== undefined && growth < -2) {
    weaknesses.push(`Croissance démographique négative (${growth.toFixed(1)}% sur 6 ans)`);
  }

  if (transport < 20)      weaknesses.push("Transport très faible — commune isolée");
  else if (transport < 35) weaknesses.push("Desserte transport limitée");

  if (pop > 0 && pop < 2000) weaknesses.push(`Commune de petite taille (${pop} hab.)`);

  if (socioScore < 35) weaknesses.push("Revenus médians modestes");

  if (tenant > 0 && tenant < 20) weaknesses.push(`Faible part de locataires (${tenant}%)`);

  if (bestYield > 0 && bestYield < 3.5) weaknesses.push(`Rendement faible (${bestYield.toFixed(1)}%)`);

  if (priceAccessibilityScore <= 25) weaknesses.push("Prix au m² élevé par rapport au marché");

  if (hasNoPriceData(city))       weaknesses.push("Données de prix indisponibles");
  else if (city.insee?.status !== "OK") weaknesses.push("Données INSEE incomplètes");

  return weaknesses;
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

function generateVerdict(city, scores, profile) {
  const { riskScore, cashflowScore, beginnerScore, patrimonialScore,
          longTermScore, yieldScore, globalScore } = scores;
  const bestYield = getBestYield(city);
  const vacancy   = safeNumber(city.insee?.vacancyRate);
  const transport = safeNumber(city.transport?.transportInvestmentScore);
  const growth    = city.insee?.populationGrowth6Y;

  let verdict, shortVerdict, investorProfile;

  if (hasNoPriceData(city) || city.insee?.status !== "OK") {
    return {
      verdict: "Les données disponibles sont insuffisantes pour établir un verdict fiable. Cette ville doit être vérifiée manuellement.",
      shortVerdict: "Données à vérifier",
      investorProfile: "Non défini — données incomplètes",
    };
  }

  switch (profile) {
    case "YIELD_TRAP": {
      const details = [
        vacancy > 10        ? `vacance élevée (${vacancy}%)` : null,
        transport < 25      ? "transport très limité" : null,
        growth !== null && growth < -2 ? "baisse démographique" : null,
      ].filter(Boolean).join(", ");
      verdict = `Rendement très attractif sur le papier (${bestYield.toFixed(1)}%), mais les indicateurs de risque sont élevés${details ? ` : ${details}` : ""}. À réserver à un investisseur expérimenté après vérification terrain.`;
      shortVerdict = "Très rentable mais risqué";
      investorProfile = "Investisseur expérimenté uniquement";
      break;
    }
    case "CASHFLOW_OPPORTUNITY":
      verdict = "Ville intéressante pour une stratégie cashflow : rendement solide, prix accessibles et risque contenu. À analyser en priorité si le marché locatif local est confirmé.";
      shortVerdict = "Cashflow intéressant";
      investorProfile = "Investisseur cashflow";
      break;
    case "BEGINNER_FRIENDLY":
      verdict = "Ville plutôt adaptée à un premier investissement : risque modéré, demande locative correcte et accessibilité acceptable. Le rendement n'est pas maximal mais le profil est plus sécurisant.";
      shortVerdict = "Adaptée débutant";
      investorProfile = "Primo-investisseur";
      break;
    case "PATRIMONIAL_SAFE":
      verdict = "Ville plus patrimoniale que cashflow : rendement modéré, mais indicateurs socio-économiques et transport favorables. Intéressant pour une stratégie de constitution de patrimoine à long terme.";
      shortVerdict = "Patrimonial sécurisé";
      investorProfile = "Investisseur patrimonial";
      break;
    case "LONG_TERM_POTENTIAL":
      verdict = "Commune avec de bonnes perspectives à long terme : dynamique démographique positive et infrastructures de transport solides. Le rendement immédiat est secondaire dans cette stratégie.";
      shortVerdict = "Potentiel long terme";
      investorProfile = "Investisseur long terme";
      break;
    case "BALANCED_OPPORTUNITY":
      verdict = "Profil équilibré entre rendement et sécurité. Cette commune présente des opportunités sans excès de risque. Une analyse approfondie du marché local est recommandée avant engagement.";
      shortVerdict = "Opportunité équilibrée";
      investorProfile = "Investisseur polyvalent";
      break;
    case "DATA_INCOMPLETE":
      verdict = "Les données disponibles sont insuffisantes pour établir un verdict fiable. Cette ville doit être vérifiée manuellement.";
      shortVerdict = "Données à vérifier";
      investorProfile = "Non défini — données incomplètes";
      break;
    default: // LOW_INTEREST
      verdict = "Les indicateurs actuels ne font pas ressortir d'opportunité claire : rendement limité, risque élevé ou attractivité insuffisante. D'autres communes du dataset sont plus favorables.";
      shortVerdict = "Peu attractive";
      investorProfile = "Non recommandé actuellement";
  }

  return { verdict, shortVerdict, investorProfile };
}

// ---------------------------------------------------------------------------
// Enrichissement d'une ville
// ---------------------------------------------------------------------------

function enrichCity(city, context) {
  // --- Scores de base ---
  const yieldScore              = calculateYieldScore(city);
  const priceAccessibilityScore = calculatePriceAccessibilityScore(city, context);
  const rentPowerScore          = calculateRentPowerScore(city, context);
  const socioScore              = calculateSocioScore(city, context);
  const growthScore             = calculateGrowthScore(city);
  const rentalDemandScore       = calculateRentalDemandScore(city, context);
  const transportScore          = calculateTransportScore(city);

  // --- Scores composites (nécessitent riskScore) ---
  const baseScores = {
    yieldScore, priceAccessibilityScore, rentPowerScore,
    socioScore, growthScore, rentalDemandScore, transportScore,
  };

  const riskScore = calculateRiskScore(city, context);
  const allScores = { ...baseScores, riskScore };

  const cashflowScore    = calculateCashflowScore(city, allScores);
  const beginnerScore    = calculateBeginnerScore(city, allScores);
  const longTermScore    = calculateLongTermScore(city, allScores);
  const patrimonialScore = calculatePatrimonialScore(city, allScores);

  const fullScores = {
    ...allScores,
    cashflowScore, beginnerScore, longTermScore, patrimonialScore,
  };

  const globalScore = calculateGlobalScore(city, fullScores);
  const finalScores = { ...fullScores, globalScore };

  // --- Profil, risk level, recommendation ---
  const profile        = detectInvestmentProfile(city, finalScores);
  const riskLevel      = detectRiskLevel(finalScores);
  const recommendation = detectRecommendation(city, finalScores);

  finalScores.profile        = profile;
  finalScores.riskLevel      = riskLevel;
  finalScores.recommendation = recommendation;

  // --- Tags, forces, faiblesses ---
  const tags       = detectTags(city, finalScores, context);
  const strengths  = detectStrengths(city, finalScores);
  const weaknesses = detectWeaknesses(city, finalScores);

  // --- Verdict ---
  const { verdict, shortVerdict, investorProfile } = generateVerdict(city, finalScores, profile);

  // --- Flags contextuels ---
  const contextFlags = computeContextFlags(city, context);

  // --- Meilleur type de bien ---
  const bestPropertyType = getBestPropertyType(city);

  return {
    ...city,
    investment: {
      profile,
      riskLevel,
      globalScore,
      cashflowScore,
      beginnerScore,
      longTermScore,
      patrimonialScore,
      rentalDemandScore,
      riskScore,
      yieldScore,
      priceAccessibilityScore,
      rentPowerScore,
      socioScore,
      growthScore,
      transportScore,
      bestPropertyType,
      recommendation,
    },
    insights: {
      tags,
      strengths,
      weaknesses,
      verdict,
      shortVerdict,
      investorProfile,
      contextFlags,
    },
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("[START] build-insights.js");

  let cities;
  try {
    cities = await readJson(INPUT_FILE);
    if (!Array.isArray(cities)) throw new Error("not an array");
  } catch (err) {
    console.error(`[FATAL] Cannot read ${INPUT_FILE}:`, err.message);
    process.exit(1);
  }

  console.log(`[CONTEXT] Building global context from ${cities.length} cities...`);
  const context = buildGlobalContext(cities);
  console.log(`[CONTEXT] Medians — yield: ${context.medians.yield.toFixed(1)}% | price: ${context.medians.price.toFixed(0)}€ | rent: ${context.medians.rent.toFixed(1)}€/m²`);
  console.log(`[CONTEXT] Percentiles p20/p80 — yield: ${context.percentiles.yield_20.toFixed(1)}%/${context.percentiles.yield_80.toFixed(1)}% | transport: ${context.percentiles.transport_20}/${context.percentiles.transport_80}`);

  console.log(`[ENRICH] Processing ${cities.length} cities...`);
  const start = Date.now();

  const output = cities.map((city) => {
    try {
      return enrichCity(city, context);
    } catch (err) {
      console.error(`[ERROR] ${city.city}: ${err.message}`);
      return {
        ...city,
        investment: {
          profile: "DATA_INCOMPLETE", riskLevel: "HIGH", globalScore: 0,
          cashflowScore: 0, beginnerScore: 0, longTermScore: 0,
          patrimonialScore: 0, rentalDemandScore: 0, riskScore: 100,
          yieldScore: 0, priceAccessibilityScore: 0, rentPowerScore: 0,
          socioScore: 0, growthScore: 0, transportScore: 0,
          bestPropertyType: null, recommendation: "DATA_TO_VERIFY",
        },
        insights: {
          tags: ["Données à vérifier"],
          strengths: [],
          weaknesses: ["Erreur de traitement"],
          verdict: "Erreur de traitement.",
          shortVerdict: "Données à vérifier",
          investorProfile: "Non défini",
          contextFlags: {},
        },
      };
    }
  });

  const elapsed = ((Date.now() - start) / 1000).toFixed(2);

  // --- Stats de sortie ---
  const profiles = {};
  const riskLevels = {};
  const recs = {};
  let totalGlobal = 0;

  for (const c of output) {
    const inv = c.investment;
    profiles[inv.profile]         = (profiles[inv.profile] || 0) + 1;
    riskLevels[inv.riskLevel]     = (riskLevels[inv.riskLevel] || 0) + 1;
    recs[inv.recommendation]      = (recs[inv.recommendation] || 0) + 1;
    totalGlobal += inv.globalScore;
  }

  console.log(`\n[DONE] ${output.length} villes enrichies en ${elapsed}s`);
  console.log(`  Score global moyen : ${(totalGlobal / output.length).toFixed(1)}/100`);
  console.log("\n  Profils :");
  Object.entries(profiles).sort((a,b) => b[1]-a[1]).forEach(([k,v]) => console.log(`    ${k.padEnd(25)} ${v}`));
  console.log("\n  Niveaux de risque :");
  ["LOW","MODERATE","HIGH","VERY_HIGH"].forEach(k => {
    if (riskLevels[k]) console.log(`    ${k.padEnd(12)} ${riskLevels[k]}`);
  });
  console.log("\n  Recommandations :");
  Object.entries(recs).sort((a,b) => b[1]-a[1]).forEach(([k,v]) => console.log(`    ${k.padEnd(25)} ${v}`));

  await writeJson(OUTPUT_FILE, output);
  console.log(`\n[DONE] Output: ${OUTPUT_FILE}`);
}

main().catch((err) => {
  console.error("[FATAL]", err.message, "\n", err.stack);
  process.exit(1);
});
