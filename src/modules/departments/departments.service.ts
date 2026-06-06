import { Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { DataLoaderService } from '../data/data-loader.service';
import { CommuneIndex, PaginatedResponse } from '../../shared/types/index.types';
import { DepartmentListItem, DepartmentSummary } from '../../shared/types/department.types';
import { DEPARTMENT_NAMES, REGION_MAPPING } from '../../shared/constants/region-mapping.constant';
import { paginate } from '../../shared/utils/pagination.util';

const DATA_DIR = path.resolve(process.cwd(), 'data', 'departments');

@Injectable()
export class DepartmentsService {
  constructor(private readonly dataLoader: DataLoaderService) {}

  list(): DepartmentListItem[] {
    return this.dataLoader.getDepartmentCodes().map((code) => {
      const summary = this.loadSummary(code);
      if (summary) {
        return {
          code: summary.code,
          name: summary.name,
          regionSlug: summary.regionSlug,
          regionName: summary.regionName,
          communesCount: summary.communesCount,
          population: summary.population,
          avgGlobalScore: summary.avgGlobalScore,
          avgApartmentYield: summary.avgApartmentYield,
          avgApartmentPrice: summary.avgApartmentPrice,
        };
      }
      const index = this.dataLoader.getIndexByDepartment(code);
      const regionInfo = REGION_MAPPING[code];
      return {
        code,
        name: DEPARTMENT_NAMES[code] ?? code,
        regionSlug: regionInfo?.slug ?? 'inconnue',
        regionName: regionInfo?.name ?? 'Inconnue',
        communesCount: index.length,
        population: index.reduce((s, c) => s + c.population, 0),
        avgGlobalScore: Math.round(index.reduce((s, c) => s + c.globalScore, 0) / (index.length || 1)),
        avgApartmentYield: null,
        avgApartmentPrice: null,
      };
    });
  }

  getDetail(code: string): DepartmentSummary {
    const summary = this.loadSummary(code);
    if (summary) return summary;

    const index = this.dataLoader.getIndexByDepartment(code);
    if (index.length === 0) throw new NotFoundException(`Département "${code}" introuvable`);

    throw new NotFoundException(`Données détaillées pour le département "${code}" non générées — lancez npm run data:generate`);
  }

  getCities(code: string, page = 1, limit = 20): PaginatedResponse<CommuneIndex> {
    const index = this.dataLoader.getIndexByDepartment(code);
    if (index.length === 0) throw new NotFoundException(`Département "${code}" introuvable`);
    const sorted = [...index].sort((a, b) => b.globalScore - a.globalScore);
    return paginate(sorted, page, limit);
  }

  private loadSummary(code: string): DepartmentSummary | null {
    const file = path.join(DATA_DIR, `${code}.json`);
    if (!fs.existsSync(file)) return null;
    try {
      return JSON.parse(fs.readFileSync(file, 'utf-8')) as DepartmentSummary;
    } catch {
      return null;
    }
  }
}
