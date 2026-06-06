export interface CommuneIndex {
  inseeCode: string;
  city: string;
  postalCode: string;
  department: string;
  departmentName: string;
  region: string;
  regionSlug: string;
  lat: number | null;
  lon: number | null;
  population: number;
  apartmentPrice: number | null;
  housePrice: number | null;
  apartmentRent: number | null;
  houseRent: number | null;
  apartmentYield: number | null;
  houseYield: number | null;
  dataQuality: 'HIGH' | 'MEDIUM' | 'LOW' | null;
  globalScore: number;
  cashflowScore: number;
  yieldScore: number;
  beginnerScore: number;
  patrimonialScore: number;
  riskScore: number;
  longTermScore: number;
  rentalDemandScore: number;
  profile: string;
  riskLevel: string;
  tags: string[];
  shortVerdict: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
