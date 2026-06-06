import { CommuneIndex } from './index.types';

export interface RegionSummary {
  slug: string;
  name: string;
  departmentCodes: string[];
  communesCount: number;
  population: number;
  avgApartmentPrice: number | null;
  avgHousePrice: number | null;
  avgApartmentRent: number | null;
  avgHouseRent: number | null;
  avgApartmentYield: number | null;
  avgHouseYield: number | null;
  avgGlobalScore: number;
  avgYieldScore: number;
  avgCashflowScore: number;
  avgPatrimonialScore: number;
  avgBeginnerScore: number;
  avgRiskScore: number;
  avgVacancyRate: number | null;
  avgTenantShare: number | null;
  avgMedianIncome: number | null;
  topGlobal: CommuneIndex[];
  topYield: CommuneIndex[];
  topCashflow: CommuneIndex[];
  topPatrimonial: CommuneIndex[];
  topBeginner: CommuneIndex[];
  lowRisk: CommuneIndex[];
  yieldTraps: CommuneIndex[];
  generatedAt: string;
}

export interface RegionListItem {
  slug: string;
  name: string;
  departmentCodes: string[];
  communesCount: number;
  population: number;
  avgGlobalScore: number;
  avgApartmentYield: number | null;
  avgApartmentPrice: number | null;
}
