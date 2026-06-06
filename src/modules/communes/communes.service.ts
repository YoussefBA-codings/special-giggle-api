import { Injectable, NotFoundException } from '@nestjs/common';
import { DataLoaderService } from '../data/data-loader.service';
import { CommuneIndex, PaginatedResponse } from '../../shared/types/index.types';
import { Commune } from '../../shared/types/commune.types';
import { paginate } from '../../shared/utils/pagination.util';

export interface CommuneFilters {
  search?: string;
  department?: string;
  region?: string;
  profile?: string;
  riskLevel?: string;
  minGlobalScore?: number;
  maxGlobalScore?: number;
  minYield?: number;
  maxYield?: number;
  minPrice?: number;
  maxPrice?: number;
  dataQuality?: string;
  minMedianIncome?: number;
  maxMedianIncome?: number;
  maxDistanceToStation?: number;
}

export type CommuneSortField =
  | 'globalScore'
  | 'yieldScore'
  | 'cashflowScore'
  | 'beginnerScore'
  | 'patrimonialScore'
  | 'riskScore'
  | 'population'
  | 'apartmentPrice'
  | 'apartmentYield'
  | 'city';

@Injectable()
export class CommunesService {
  constructor(private readonly dataLoader: DataLoaderService) {}

  list(
    filters: CommuneFilters,
    sortBy: CommuneSortField = 'globalScore',
    sortOrder: 'asc' | 'desc' = 'desc',
    page = 1,
    limit = 20,
  ): PaginatedResponse<CommuneIndex> {
    let items = this.dataLoader.getIndex();

    items = this.applyFilters(items, filters);
    items = this.applySort(items, sortBy, sortOrder);

    return paginate(items, page, limit);
  }

  getDetail(inseeCode: string): Commune {
    const commune = this.dataLoader.getCommune(inseeCode);
    if (!commune) throw new NotFoundException(`Commune ${inseeCode} introuvable`);
    return commune;
  }

  compare(inseeCodes: string[]): Commune[] {
    return inseeCodes.map((code) => {
      const commune = this.dataLoader.getCommune(code);
      if (!commune) throw new NotFoundException(`Commune ${code} introuvable`);
      return commune;
    });
  }

  private applyFilters(items: CommuneIndex[], filters: CommuneFilters): CommuneIndex[] {
    return items.filter((c) => {
      if (filters.search) {
        const q = filters.search.toLowerCase();
        if (!c.city.toLowerCase().includes(q) && !c.postalCode.includes(q) && !c.inseeCode.includes(q)) {
          return false;
        }
      }
      if (filters.department && c.department !== filters.department) return false;
      if (filters.region && c.regionSlug !== filters.region) return false;
      if (filters.profile && c.profile !== filters.profile) return false;
      if (filters.riskLevel && c.riskLevel !== filters.riskLevel) return false;
      if (filters.dataQuality && c.dataQuality !== filters.dataQuality) return false;
      if (filters.minGlobalScore !== undefined && c.globalScore < filters.minGlobalScore) return false;
      if (filters.maxGlobalScore !== undefined && c.globalScore > filters.maxGlobalScore) return false;
      if (filters.minYield !== undefined) {
        const y = Math.max(c.apartmentYield ?? 0, c.houseYield ?? 0);
        if (y < filters.minYield) return false;
      }
      if (filters.maxYield !== undefined) {
        const y = Math.max(c.apartmentYield ?? 0, c.houseYield ?? 0);
        if (y > filters.maxYield) return false;
      }
      if (filters.minPrice !== undefined) {
        const p = c.apartmentPrice ?? c.housePrice ?? 0;
        if (p < filters.minPrice) return false;
      }
      if (filters.maxPrice !== undefined) {
        const p = c.apartmentPrice ?? c.housePrice ?? Infinity;
        if (p > filters.maxPrice) return false;
      }
      if (filters.minMedianIncome !== undefined) {
        if (c.medianIncome == null || c.medianIncome < filters.minMedianIncome) return false;
      }
      if (filters.maxMedianIncome !== undefined) {
        if (c.medianIncome == null || c.medianIncome > filters.maxMedianIncome) return false;
      }
      if (filters.maxDistanceToStation !== undefined) {
        if (c.distanceToStation == null || c.distanceToStation > filters.maxDistanceToStation) return false;
      }
      return true;
    });
  }

  private applySort(
    items: CommuneIndex[],
    sortBy: CommuneSortField,
    order: 'asc' | 'desc',
  ): CommuneIndex[] {
    return [...items].sort((a, b) => {
      let av: number | string = 0;
      let bv: number | string = 0;

      if (sortBy === 'city') {
        av = a.city;
        bv = b.city;
        return order === 'asc' ? (av < bv ? -1 : 1) : av > bv ? -1 : 1;
      }

      av = (a[sortBy] as number) ?? 0;
      bv = (b[sortBy] as number) ?? 0;
      return order === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }
}
