export interface CommuneGeo {
  inseeCode: string;
  apiName: string;
  lat: number;
  lon: number;
  population: number;
  surface: number | null;
  densityRaw: number | null;
  matchScore: number;
  matchStrategy: string;
}

export interface CommuneEnrichment {
  geoStatus: string;
  geoError: string | null;
  updatedAt: string;
}

export interface CommunePriceDetails {
  average: number | null;
  min: number | null;
  max: number | null;
  rent: number | null;
  grossYield: number | null;
}

export interface CommunePrices {
  apartment: CommunePriceDetails | null;
  house: CommunePriceDetails | null;
  all: { rent: number | null } | null;
}

export interface PriceReliabilityFactors {
  volume: number;
  consistency: number;
  rentData: number;
  completeness: number;
}

export interface PriceReliabilityIndex {
  score: number;
  grade: 'A' | 'B' | 'C';
  confidence: 'TRES_FIABLE' | 'FIABLE' | 'PEU_FIABLE';
  factors: PriceReliabilityFactors;
}

export interface CommunePriceSources {
  purchase: string;
  rent: string;
  purchaseMethod: string;
  apartmentSalesCount: number;
  houseSalesCount: number;
  dataQuality: 'HIGH' | 'MEDIUM' | 'LOW';
  priceReliabilityIndex: PriceReliabilityIndex;
}

export interface CommuneInseeDataYear {
  population: number;
  income: number;
  housing: number;
}

export interface CommuneInsee {
  status: string;
  error: string | null;
  population: number;
  populationGrowth6Y: number | null;
  medianIncome: number | null;
  vacancyRate: number | null;
  tenantShare: number | null;
  ownerShare: number | null;
  density: number | null;
  socioEconomicScore: number;
  growthScore: number;
  rentalMarketScore: number;
  dataYear: CommuneInseeDataYear | null;
}

export interface NearestTransportPoint {
  name: string;
  type?: string;
  distanceKm: number;
}

export interface CommuneTransportInsights {
  strengths: string[];
  weaknesses: string[];
  summary: string;
}

export interface CommuneTransportFutureProjects {
  grandParis: boolean;
  newStationPlanned: boolean;
  futureTransportScore: number | null;
}

export interface CommuneTransport {
  status: string;
  error: string | null;
  nearestStation: NearestTransportPoint | null;
  nearestRer: NearestTransportPoint | null;
  nearestTrain: NearestTransportPoint | null;
  nearestMetro: NearestTransportPoint | null;
  nearestTram: NearestTransportPoint | null;
  stationsWithin2Km: number;
  stationsWithin5Km: number;
  stationsWithin10Km: number;
  hasMetro: boolean;
  hasRer: boolean;
  hasTrain: boolean;
  hasTram: boolean;
  transportScore: number;
  transportInvestmentScore: number;
  classification: string;
  transportInsights: CommuneTransportInsights | null;
  futureProjects: CommuneTransportFutureProjects | null;
}

export type InvestmentProfile =
  | 'BEGINNER_FRIENDLY'
  | 'BALANCED_OPPORTUNITY'
  | 'PATRIMONIAL'
  | 'HIGH_YIELD'
  | 'YIELD_TRAP'
  | 'SPECULATIVE'
  | 'DEFAULT';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export type PropertyType = 'apartment' | 'house';

export interface CommuneInvestment {
  profile: InvestmentProfile;
  riskLevel: RiskLevel;
  globalScore: number;
  cashflowScore: number;
  beginnerScore: number;
  longTermScore: number;
  patrimonialScore: number;
  rentalDemandScore: number;
  riskScore: number;
  yieldScore: number;
  priceAccessibilityScore: number;
  rentPowerScore: number;
  socioScore: number;
  growthScore: number;
  transportScore: number;
  bestPropertyType: PropertyType;
  recommendation: string;
}

export interface CommuneContextFlags {
  priceVsDataset: string;
  yieldVsDataset: string;
  rentVsDataset: string;
  growthVsDataset: string;
  vacancyVsDataset: string;
  transportVsDataset: string;
  incomeVsDataset: string;
}

export interface CommuneInsights {
  tags: string[];
  strengths: string[];
  weaknesses: string[];
  verdict: string;
  shortVerdict: string;
  investorProfile: string;
  contextFlags: CommuneContextFlags | null;
}

export interface Commune {
  city: string;
  postalCode: string;
  department: string;
  geo: CommuneGeo;
  enrichment: CommuneEnrichment | null;
  prices: CommunePrices | null;
  priceSources: CommunePriceSources | null;
  population: number;
  insee: CommuneInsee | null;
  transport: CommuneTransport | null;
  investment: CommuneInvestment;
  insights: CommuneInsights | null;
}
