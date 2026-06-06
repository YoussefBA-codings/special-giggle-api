import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { Commune } from '../../shared/types/commune.types';
import { CommuneIndex } from '../../shared/types/index.types';
import { Thresholds } from '../../shared/types/thresholds.types';
import { DEPARTMENT_NAMES, REGION_MAPPING } from '../../shared/constants/region-mapping.constant';

const SOURCE_FILE = path.resolve(process.cwd(), 'communes-all.final.json');
const INDEX_FILE = path.resolve(process.cwd(), 'data', 'index.json');
const THRESHOLDS_FILE = path.resolve(process.cwd(), 'data', 'thresholds.json');

@Injectable()
export class DataLoaderService implements OnModuleInit {
  private readonly logger = new Logger(DataLoaderService.name);

  private communesMap = new Map<string, Commune>();
  private communeIndex: CommuneIndex[] = [];
  private departmentIndex = new Map<string, string[]>();
  private regionIndex = new Map<string, string[]>();
  private thresholds: Thresholds | null = null;

  // Pre-sorted arrays for O(1) ranking slices
  private sortedByGlobalScore: CommuneIndex[] = [];
  private sortedByYield: CommuneIndex[] = [];
  private sortedByCashflow: CommuneIndex[] = [];
  private sortedByPatrimonial: CommuneIndex[] = [];
  private sortedByBeginner: CommuneIndex[] = [];
  private sortedByLowRisk: CommuneIndex[] = [];
  private yieldTraps: CommuneIndex[] = [];

  async onModuleInit() {
    this.logger.log('Loading communes-all.final.json…');
    const start = Date.now();

    if (!fs.existsSync(SOURCE_FILE)) {
      this.logger.error(`Source file not found: ${SOURCE_FILE}`);
      this.logger.warn('API will start without data — run npm run data:generate first');
      return;
    }

    const raw = fs.readFileSync(SOURCE_FILE, 'utf-8');
    const communes: Commune[] = JSON.parse(raw);

    this.logger.log(`Parsed ${communes.length} communes in ${Date.now() - start}ms`);

    for (const commune of communes) {
      const inseeCode = commune.geo?.inseeCode;
      if (!inseeCode) continue;

      this.communesMap.set(inseeCode, commune);

      const dept = commune.department;
      if (!this.departmentIndex.has(dept)) this.departmentIndex.set(dept, []);
      this.departmentIndex.get(dept)!.push(inseeCode);

      const region = REGION_MAPPING[dept];
      if (region) {
        if (!this.regionIndex.has(region.slug)) this.regionIndex.set(region.slug, []);
        this.regionIndex.get(region.slug)!.push(inseeCode);
      }
    }

    this.loadIndex();
    this.loadThresholds();
    this.buildSortedRankings();

    this.logger.log(`DataLoader ready — ${this.communesMap.size} communes indexed in ${Date.now() - start}ms`);
  }

  private loadIndex() {
    if (!fs.existsSync(INDEX_FILE)) {
      this.logger.warn('data/index.json not found — run npm run data:generate');
      this.communeIndex = this.buildIndexFromMemory();
      return;
    }
    const raw = fs.readFileSync(INDEX_FILE, 'utf-8');
    this.communeIndex = JSON.parse(raw);
    this.logger.log(`Loaded index with ${this.communeIndex.length} entries`);
  }

  private loadThresholds() {
    if (!fs.existsSync(THRESHOLDS_FILE)) return;
    const raw = fs.readFileSync(THRESHOLDS_FILE, 'utf-8');
    this.thresholds = JSON.parse(raw);
    this.logger.log('Loaded thresholds.json');
  }

  private buildIndexFromMemory(): CommuneIndex[] {
    const index: CommuneIndex[] = [];
    for (const commune of this.communesMap.values()) {
      const entry = communeToIndex(commune);
      if (entry) index.push(entry);
    }
    return index;
  }

  private buildSortedRankings() {
    this.sortedByGlobalScore = [...this.communeIndex].sort((a, b) => b.globalScore - a.globalScore);
    this.sortedByYield = [...this.communeIndex]
      .filter((c) => c.apartmentYield !== null || c.houseYield !== null)
      .sort((a, b) => Math.max(b.apartmentYield ?? 0, b.houseYield ?? 0) - Math.max(a.apartmentYield ?? 0, a.houseYield ?? 0));
    this.sortedByCashflow = [...this.communeIndex].sort((a, b) => b.cashflowScore - a.cashflowScore);
    this.sortedByPatrimonial = [...this.communeIndex].sort((a, b) => b.patrimonialScore - a.patrimonialScore);
    this.sortedByBeginner = [...this.communeIndex].sort((a, b) => b.beginnerScore - a.beginnerScore);
    this.sortedByLowRisk = [...this.communeIndex].sort((a, b) => b.riskScore - a.riskScore);
    this.yieldTraps = [...this.communeIndex]
      .filter((c) => c.yieldScore >= 65 && c.riskScore < 40)
      .sort((a, b) => b.yieldScore - a.yieldScore);
  }

  getCommune(inseeCode: string): Commune | undefined {
    return this.communesMap.get(inseeCode);
  }

  getIndex(): CommuneIndex[] {
    return this.communeIndex;
  }

  getThresholds(): Thresholds | null {
    return this.thresholds;
  }

  getCommunesByDepartment(dept: string): Commune[] {
    const codes = this.departmentIndex.get(dept) ?? [];
    return codes.map((c) => this.communesMap.get(c)!).filter(Boolean);
  }

  getCommunesByRegion(slug: string): Commune[] {
    const codes = this.regionIndex.get(slug) ?? [];
    return codes.map((c) => this.communesMap.get(c)!).filter(Boolean);
  }

  getIndexByDepartment(dept: string): CommuneIndex[] {
    return this.communeIndex.filter((c) => c.department === dept);
  }

  getIndexByRegion(slug: string): CommuneIndex[] {
    return this.communeIndex.filter((c) => c.regionSlug === slug);
  }

  getDepartmentCodes(): string[] {
    return [...this.departmentIndex.keys()].sort();
  }

  getRegionSlugs(): string[] {
    return [...this.regionIndex.keys()].sort();
  }

  getSortedByGlobalScore(): CommuneIndex[] { return this.sortedByGlobalScore; }
  getSortedByYield(): CommuneIndex[] { return this.sortedByYield; }
  getSortedByCashflow(): CommuneIndex[] { return this.sortedByCashflow; }
  getSortedByPatrimonial(): CommuneIndex[] { return this.sortedByPatrimonial; }
  getSortedByBeginner(): CommuneIndex[] { return this.sortedByBeginner; }
  getSortedByLowRisk(): CommuneIndex[] { return this.sortedByLowRisk; }
  getYieldTraps(): CommuneIndex[] { return this.yieldTraps; }
}

export function communeToIndex(commune: Commune): CommuneIndex | null {
  const inseeCode = commune.geo?.inseeCode;
  if (!inseeCode) return null;

  const dept = commune.department;
  const regionInfo = REGION_MAPPING[dept];

  return {
    inseeCode,
    city: commune.city,
    postalCode: commune.postalCode,
    department: dept,
    departmentName: DEPARTMENT_NAMES[dept] ?? dept,
    region: regionInfo?.name ?? 'Inconnue',
    regionSlug: regionInfo?.slug ?? 'inconnue',
    lat: commune.geo?.lat ?? null,
    lon: commune.geo?.lon ?? null,
    population: commune.population ?? commune.geo?.population ?? 0,
    apartmentPrice: commune.prices?.apartment?.average ?? null,
    housePrice: commune.prices?.house?.average ?? null,
    apartmentRent: commune.prices?.apartment?.rent ?? null,
    houseRent: commune.prices?.house?.rent ?? null,
    apartmentYield: commune.prices?.apartment?.grossYield ?? null,
    houseYield: commune.prices?.house?.grossYield ?? null,
    dataQuality: (commune.priceSources?.dataQuality as 'HIGH' | 'MEDIUM' | 'LOW') ?? null,
    globalScore: commune.investment?.globalScore ?? 0,
    cashflowScore: commune.investment?.cashflowScore ?? 0,
    yieldScore: commune.investment?.yieldScore ?? 0,
    beginnerScore: commune.investment?.beginnerScore ?? 0,
    patrimonialScore: commune.investment?.patrimonialScore ?? 0,
    riskScore: commune.investment?.riskScore ?? 0,
    longTermScore: commune.investment?.longTermScore ?? 0,
    rentalDemandScore: commune.investment?.rentalDemandScore ?? 0,
    profile: commune.investment?.profile ?? 'DEFAULT',
    riskLevel: commune.investment?.riskLevel ?? 'MEDIUM',
    tags: commune.insights?.tags ?? [],
    shortVerdict: commune.insights?.shortVerdict ?? '',
  };
}
