import { Commune } from '../../shared/types/commune.types';
import { PercentileThresholds, Thresholds } from '../../shared/types/thresholds.types';

function extractSorted(values: (number | null | undefined)[]): number[] {
  return (values.filter((v) => v !== null && v !== undefined && isFinite(v)) as number[]).sort(
    (a, b) => a - b,
  );
}

function percentileOf(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function buildThresholds(sorted: number[]): PercentileThresholds {
  return {
    p10: percentileOf(sorted, 10),
    p25: percentileOf(sorted, 25),
    p50: percentileOf(sorted, 50),
    p75: percentileOf(sorted, 75),
    p90: percentileOf(sorted, 90),
  };
}

export function calculateThresholds(communes: Commune[]): Thresholds {
  const yields = communes.flatMap((c) => [
    c.prices?.apartment?.grossYield,
    c.prices?.house?.grossYield,
  ]);

  const prices = communes.flatMap((c) => [
    c.prices?.apartment?.average,
    c.prices?.house?.average,
  ]);

  const rents = communes.flatMap((c) => [
    c.prices?.all?.rent,
    c.prices?.apartment?.rent,
    c.prices?.house?.rent,
  ]);

  const vacancies = communes.map((c) => c.insee?.vacancyRate);
  const incomes = communes.map((c) => c.insee?.medianIncome);
  const growths = communes.map((c) => c.insee?.populationGrowth6Y);
  const tenantShares = communes.map((c) => c.insee?.tenantShare);

  return {
    yield: buildThresholds(extractSorted(yields)),
    price: buildThresholds(extractSorted(prices)),
    rent: buildThresholds(extractSorted(rents)),
    vacancy: buildThresholds(extractSorted(vacancies)),
    income: buildThresholds(extractSorted(incomes)),
    growth: buildThresholds(extractSorted(growths)),
    tenantShare: buildThresholds(extractSorted(tenantShares)),
    generatedAt: new Date().toISOString(),
    totalCommunes: communes.length,
  };
}
