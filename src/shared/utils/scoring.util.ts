import { Commune, CommuneInvestment, InvestmentProfile } from '../types/commune.types';
import { PercentileThresholds, Thresholds } from '../types/thresholds.types';

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function scoreFromPercentile(
  value: number,
  t: PercentileThresholds,
  higherIsBetter: boolean,
): number {
  if (t.p90 === t.p10) return 50;

  let raw: number;
  if (value <= t.p10) raw = 5;
  else if (value <= t.p25) raw = 5 + ((value - t.p10) / (t.p25 - t.p10)) * 20;
  else if (value <= t.p50) raw = 25 + ((value - t.p25) / (t.p50 - t.p25)) * 25;
  else if (value <= t.p75) raw = 50 + ((value - t.p50) / (t.p75 - t.p50)) * 25;
  else if (value <= t.p90) raw = 75 + ((value - t.p75) / (t.p90 - t.p75)) * 20;
  else raw = 95;

  return clamp(Math.round(higherIsBetter ? raw : 100 - raw));
}

function weightedAvg(components: [number, number][]): number {
  const totalWeight = components.reduce((sum, [, w]) => sum + w, 0);
  if (totalWeight === 0) return 0;
  const sum = components.reduce((acc, [score, w]) => acc + score * w, 0);
  return clamp(Math.round(sum / totalWeight));
}

function determineProfile(scores: {
  yieldScore: number;
  riskScore: number;
  beginnerScore: number;
  patrimonialScore: number;
  cashflowScore: number;
}): InvestmentProfile {
  const { yieldScore, riskScore, beginnerScore, patrimonialScore, cashflowScore } = scores;

  if (yieldScore >= 70 && riskScore < 35) return 'YIELD_TRAP';
  if (yieldScore >= 75 && riskScore >= 55) return 'HIGH_YIELD';
  if (patrimonialScore >= 75 && riskScore >= 60) return 'PATRIMONIAL';
  if (beginnerScore >= 70 && riskScore >= 65) return 'BEGINNER_FRIENDLY';
  if (cashflowScore >= 60 && riskScore >= 50) return 'BALANCED_OPPORTUNITY';
  return 'DEFAULT';
}

export function recalculateScores(commune: Commune, thresholds: Thresholds): CommuneInvestment {
  const aptYield = commune.prices?.apartment?.grossYield ?? 0;
  const houseYield = commune.prices?.house?.grossYield ?? 0;
  const bestYield = Math.max(aptYield, houseYield);

  const aptPrice = commune.prices?.apartment?.average ?? null;
  const housePrice = commune.prices?.house?.average ?? null;
  const avgPrice =
    aptPrice !== null && housePrice !== null
      ? (aptPrice + housePrice) / 2
      : aptPrice ?? housePrice ?? 0;

  const rent =
    commune.prices?.all?.rent ??
    commune.prices?.apartment?.rent ??
    commune.prices?.house?.rent ??
    0;

  const vacancy = commune.insee?.vacancyRate ?? thresholds.vacancy.p50;
  const tenantShare = commune.insee?.tenantShare ?? thresholds.tenantShare.p50;
  const medianIncome = commune.insee?.medianIncome ?? thresholds.income.p50;
  const popGrowth = commune.insee?.populationGrowth6Y ?? 0;
  const rawTransportScore = commune.transport?.transportScore ?? 0;

  const yieldScore = scoreFromPercentile(bestYield, thresholds.yield, true);
  const priceAccessibilityScore = scoreFromPercentile(avgPrice, thresholds.price, false);
  const rentPowerScore = scoreFromPercentile(rent, thresholds.rent, true);
  const riskScore = scoreFromPercentile(vacancy, thresholds.vacancy, false);
  const rentalDemandScore = weightedAvg([
    [scoreFromPercentile(tenantShare, thresholds.tenantShare, true), 0.5],
    [rawTransportScore, 0.5],
  ]);
  const socioScore = scoreFromPercentile(medianIncome, thresholds.income, true);
  const growthScore = scoreFromPercentile(popGrowth, thresholds.growth, true);
  const transportScore = clamp(Math.round(rawTransportScore));

  const cashflowScore = weightedAvg([
    [yieldScore, 0.5],
    [priceAccessibilityScore, 0.3],
    [rentPowerScore, 0.2],
  ]);

  const patrimonialScore = weightedAvg([
    [socioScore, 0.3],
    [growthScore, 0.25],
    [transportScore, 0.2],
    [clamp(100 - priceAccessibilityScore), 0.25],
  ]);

  const beginnerScore = weightedAvg([
    [riskScore, 0.35],
    [rentalDemandScore, 0.25],
    [yieldScore, 0.25],
    [priceAccessibilityScore, 0.15],
  ]);

  const longTermScore = weightedAvg([
    [growthScore, 0.35],
    [socioScore, 0.25],
    [transportScore, 0.2],
    [riskScore, 0.2],
  ]);

  const globalScore = weightedAvg([
    [yieldScore, 0.2],
    [riskScore, 0.2],
    [rentalDemandScore, 0.15],
    [socioScore, 0.15],
    [growthScore, 0.1],
    [transportScore, 0.1],
    [cashflowScore, 0.1],
  ]);

  const profile = determineProfile({ yieldScore, riskScore, beginnerScore, patrimonialScore, cashflowScore });

  return {
    globalScore,
    cashflowScore,
    yieldScore,
    beginnerScore,
    longTermScore,
    patrimonialScore,
    rentalDemandScore,
    riskScore,
    priceAccessibilityScore,
    rentPowerScore,
    socioScore,
    growthScore,
    transportScore,
    profile,
    riskLevel: riskScore >= 65 ? 'LOW' : riskScore >= 40 ? 'MEDIUM' : 'HIGH',
    bestPropertyType: aptYield >= houseYield ? 'apartment' : 'house',
    recommendation:
      globalScore >= 70
        ? 'GOOD_TO_ANALYZE'
        : globalScore >= 45
          ? 'TO_WATCH'
          : 'NOT_RECOMMENDED',
  };
}
