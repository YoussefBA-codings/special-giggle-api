import { Commune } from '../../shared/types/commune.types';
import { CommuneIndex } from '../../shared/types/index.types';
import { DepartmentSummary } from '../../shared/types/department.types';
import { RegionSummary } from '../../shared/types/region.types';
import { DEPARTMENT_NAMES, REGION_MAPPING } from '../../shared/constants/region-mapping.constant';

function avg(values: (number | null | undefined)[]): number | null {
  const valid = values.filter((v) => v !== null && v !== undefined && isFinite(v as number)) as number[];
  if (valid.length === 0) return null;
  return Math.round((valid.reduce((a, b) => a + b, 0) / valid.length) * 100) / 100;
}

function avgScore(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

function top(items: CommuneIndex[], key: keyof CommuneIndex, n = 5, desc = true): CommuneIndex[] {
  return [...items]
    .filter((c) => c[key] !== null && c[key] !== undefined)
    .sort((a, b) => {
      const av = a[key] as number;
      const bv = b[key] as number;
      return desc ? bv - av : av - bv;
    })
    .slice(0, n);
}

function yieldTrapsFromIndex(items: CommuneIndex[]): CommuneIndex[] {
  return items
    .filter((c) => c.yieldScore >= 65 && c.riskScore < 40)
    .sort((a, b) => b.yieldScore - a.yieldScore)
    .slice(0, 5);
}

export function buildDepartmentSummary(
  code: string,
  communes: Commune[],
  indexEntries: CommuneIndex[],
): DepartmentSummary {
  const regionInfo = REGION_MAPPING[code];

  return {
    code,
    name: DEPARTMENT_NAMES[code] ?? code,
    regionSlug: regionInfo?.slug ?? 'inconnue',
    regionName: regionInfo?.name ?? 'Inconnue',
    communesCount: communes.length,
    population: communes.reduce((s, c) => s + (c.population ?? 0), 0),
    avgApartmentPrice: avg(communes.map((c) => c.prices?.apartment?.average)),
    avgHousePrice: avg(communes.map((c) => c.prices?.house?.average)),
    avgApartmentRent: avg(communes.map((c) => c.prices?.apartment?.rent)),
    avgHouseRent: avg(communes.map((c) => c.prices?.house?.rent)),
    avgApartmentYield: avg(communes.map((c) => c.prices?.apartment?.grossYield)),
    avgHouseYield: avg(communes.map((c) => c.prices?.house?.grossYield)),
    avgGlobalScore: avgScore(communes.map((c) => c.investment?.globalScore ?? 0)),
    avgYieldScore: avgScore(communes.map((c) => c.investment?.yieldScore ?? 0)),
    avgCashflowScore: avgScore(communes.map((c) => c.investment?.cashflowScore ?? 0)),
    avgPatrimonialScore: avgScore(communes.map((c) => c.investment?.patrimonialScore ?? 0)),
    avgBeginnerScore: avgScore(communes.map((c) => c.investment?.beginnerScore ?? 0)),
    avgRiskScore: avgScore(communes.map((c) => c.investment?.riskScore ?? 0)),
    avgVacancyRate: avg(communes.map((c) => c.insee?.vacancyRate)),
    avgTenantShare: avg(communes.map((c) => c.insee?.tenantShare)),
    avgMedianIncome: avg(communes.map((c) => c.insee?.medianIncome)),
    topGlobal: top(indexEntries, 'globalScore'),
    topYield: top(indexEntries, 'yieldScore'),
    topCashflow: top(indexEntries, 'cashflowScore'),
    topPatrimonial: top(indexEntries, 'patrimonialScore'),
    topBeginner: top(indexEntries, 'beginnerScore'),
    lowRisk: top(indexEntries, 'riskScore'),
    yieldTraps: yieldTrapsFromIndex(indexEntries),
    generatedAt: new Date().toISOString(),
  };
}

export function buildRegionSummary(
  slug: string,
  name: string,
  deptCodes: string[],
  communes: Commune[],
  indexEntries: CommuneIndex[],
): RegionSummary {
  return {
    slug,
    name,
    departmentCodes: deptCodes,
    communesCount: communes.length,
    population: communes.reduce((s, c) => s + (c.population ?? 0), 0),
    avgApartmentPrice: avg(communes.map((c) => c.prices?.apartment?.average)),
    avgHousePrice: avg(communes.map((c) => c.prices?.house?.average)),
    avgApartmentRent: avg(communes.map((c) => c.prices?.apartment?.rent)),
    avgHouseRent: avg(communes.map((c) => c.prices?.house?.rent)),
    avgApartmentYield: avg(communes.map((c) => c.prices?.apartment?.grossYield)),
    avgHouseYield: avg(communes.map((c) => c.prices?.house?.grossYield)),
    avgGlobalScore: avgScore(communes.map((c) => c.investment?.globalScore ?? 0)),
    avgYieldScore: avgScore(communes.map((c) => c.investment?.yieldScore ?? 0)),
    avgCashflowScore: avgScore(communes.map((c) => c.investment?.cashflowScore ?? 0)),
    avgPatrimonialScore: avgScore(communes.map((c) => c.investment?.patrimonialScore ?? 0)),
    avgBeginnerScore: avgScore(communes.map((c) => c.investment?.beginnerScore ?? 0)),
    avgRiskScore: avgScore(communes.map((c) => c.investment?.riskScore ?? 0)),
    avgVacancyRate: avg(communes.map((c) => c.insee?.vacancyRate)),
    avgTenantShare: avg(communes.map((c) => c.insee?.tenantShare)),
    avgMedianIncome: avg(communes.map((c) => c.insee?.medianIncome)),
    topGlobal: top(indexEntries, 'globalScore'),
    topYield: top(indexEntries, 'yieldScore'),
    topCashflow: top(indexEntries, 'cashflowScore'),
    topPatrimonial: top(indexEntries, 'patrimonialScore'),
    topBeginner: top(indexEntries, 'beginnerScore'),
    lowRisk: top(indexEntries, 'riskScore'),
    yieldTraps: yieldTrapsFromIndex(indexEntries),
    generatedAt: new Date().toISOString(),
  };
}
