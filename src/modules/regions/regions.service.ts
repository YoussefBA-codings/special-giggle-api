import { Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { DataLoaderService } from '../data/data-loader.service';
import { CommuneIndex, PaginatedResponse } from '../../shared/types/index.types';
import { RegionListItem, RegionSummary } from '../../shared/types/region.types';
import { REGION_MAPPING } from '../../shared/constants/region-mapping.constant';
import { paginate } from '../../shared/utils/pagination.util';

const DATA_DIR = path.resolve(process.cwd(), 'data', 'regions');

@Injectable()
export class RegionsService {
  constructor(private readonly dataLoader: DataLoaderService) {}

  list(): RegionListItem[] {
    const slugs = this.dataLoader.getRegionSlugs();
    return slugs.map((slug) => {
      const summary = this.loadSummary(slug);
      if (summary) {
        return {
          slug: summary.slug,
          name: summary.name,
          departmentCodes: summary.departmentCodes,
          communesCount: summary.communesCount,
          population: summary.population,
          avgGlobalScore: summary.avgGlobalScore,
          avgApartmentYield: summary.avgApartmentYield,
          avgApartmentPrice: summary.avgApartmentPrice,
        };
      }
      const index = this.dataLoader.getIndexByRegion(slug);
      const regionName = index[0]?.region ?? slug;
      return {
        slug,
        name: regionName,
        departmentCodes: [...new Set(index.map((c) => c.department))],
        communesCount: index.length,
        population: index.reduce((s, c) => s + c.population, 0),
        avgGlobalScore: Math.round(index.reduce((s, c) => s + c.globalScore, 0) / (index.length || 1)),
        avgApartmentYield: null,
        avgApartmentPrice: null,
      };
    });
  }

  getDetail(slug: string): RegionSummary {
    const summary = this.loadSummary(slug);
    if (summary) return summary;

    const index = this.dataLoader.getIndexByRegion(slug);
    if (index.length === 0) throw new NotFoundException(`Région "${slug}" introuvable`);

    throw new NotFoundException(`Données détaillées pour "${slug}" non générées — lancez npm run data:generate`);
  }

  getCities(slug: string, page = 1, limit = 20): PaginatedResponse<CommuneIndex> {
    const index = this.dataLoader.getIndexByRegion(slug);
    if (index.length === 0) throw new NotFoundException(`Région "${slug}" introuvable`);
    const sorted = [...index].sort((a, b) => b.globalScore - a.globalScore);
    return paginate(sorted, page, limit);
  }

  private loadSummary(slug: string): RegionSummary | null {
    const file = path.join(DATA_DIR, `${slug}.json`);
    if (!fs.existsSync(file)) return null;
    try {
      return JSON.parse(fs.readFileSync(file, 'utf-8')) as RegionSummary;
    } catch {
      return null;
    }
  }

  getRegionSlugs(): string[] {
    return this.dataLoader.getRegionSlugs();
  }
}
