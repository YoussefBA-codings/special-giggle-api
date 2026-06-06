import { Injectable } from '@nestjs/common';
import { DataLoaderService } from '../data/data-loader.service';
import { CommuneIndex } from '../../shared/types/index.types';

export interface RankingResult {
  ranking: string;
  description: string;
  total: number;
  communes: CommuneIndex[];
}

const RANKING_LIMIT = 50;

@Injectable()
export class RankingsService {
  constructor(private readonly dataLoader: DataLoaderService) {}

  global(limit = RANKING_LIMIT): RankingResult {
    const communes = this.dataLoader.getSortedByGlobalScore().slice(0, limit);
    return {
      ranking: 'global',
      description: 'Meilleurs scores globaux d\'investissement',
      total: communes.length,
      communes,
    };
  }

  yield(limit = RANKING_LIMIT): RankingResult {
    const communes = this.dataLoader.getSortedByYield().slice(0, limit);
    return {
      ranking: 'yield',
      description: 'Meilleurs rendements bruts',
      total: communes.length,
      communes,
    };
  }

  cashflow(limit = RANKING_LIMIT): RankingResult {
    const communes = this.dataLoader.getSortedByCashflow().slice(0, limit);
    return {
      ranking: 'cashflow',
      description: 'Meilleur cashflow potentiel',
      total: communes.length,
      communes,
    };
  }

  patrimonial(limit = RANKING_LIMIT): RankingResult {
    const communes = this.dataLoader.getSortedByPatrimonial().slice(0, limit);
    return {
      ranking: 'patrimonial',
      description: 'Meilleurs profils patrimoniaux',
      total: communes.length,
      communes,
    };
  }

  beginner(limit = RANKING_LIMIT): RankingResult {
    const communes = this.dataLoader.getSortedByBeginner().slice(0, limit);
    return {
      ranking: 'beginner',
      description: 'Meilleures villes pour investisseurs débutants',
      total: communes.length,
      communes,
    };
  }

  lowRisk(limit = RANKING_LIMIT): RankingResult {
    const communes = this.dataLoader.getSortedByLowRisk().slice(0, limit);
    return {
      ranking: 'low-risk',
      description: 'Villes les moins risquées',
      total: communes.length,
      communes,
    };
  }

  yieldTraps(limit = RANKING_LIMIT): RankingResult {
    const communes = this.dataLoader.getYieldTraps().slice(0, limit);
    return {
      ranking: 'yield-traps',
      description: 'Yield traps — rendement élevé mais risque sous-estimé',
      total: communes.length,
      communes,
    };
  }

  longTerm(limit = RANKING_LIMIT): RankingResult {
    const communes = [...this.dataLoader.getIndex()]
      .sort((a, b) => b.longTermScore - a.longTermScore)
      .slice(0, limit);
    return {
      ranking: 'long-term',
      description: 'Meilleures perspectives long terme (croissance + démographie)',
      total: communes.length,
      communes,
    };
  }

  rentalDemand(limit = RANKING_LIMIT): RankingResult {
    const communes = [...this.dataLoader.getIndex()]
      .sort((a, b) => b.rentalDemandScore - a.rentalDemandScore)
      .slice(0, limit);
    return {
      ranking: 'rental-demand',
      description: 'Meilleure demande locative',
      total: communes.length,
      communes,
    };
  }
}
