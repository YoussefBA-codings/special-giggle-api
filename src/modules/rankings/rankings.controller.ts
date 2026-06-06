import { Controller, Get, Query } from '@nestjs/common';
import { RankingsService } from './rankings.service';
import { parseIntParam } from '../../shared/utils/pagination.util';

@Controller('rankings')
export class RankingsController {
  constructor(private readonly rankingsService: RankingsService) {}

  @Get('global')
  global(@Query('limit') limit: string) {
    return this.rankingsService.global(parseIntParam(limit, 50));
  }

  @Get('yield')
  yield(@Query('limit') limit: string) {
    return this.rankingsService.yield(parseIntParam(limit, 50));
  }

  @Get('cashflow')
  cashflow(@Query('limit') limit: string) {
    return this.rankingsService.cashflow(parseIntParam(limit, 50));
  }

  @Get('patrimonial')
  patrimonial(@Query('limit') limit: string) {
    return this.rankingsService.patrimonial(parseIntParam(limit, 50));
  }

  @Get('beginner')
  beginner(@Query('limit') limit: string) {
    return this.rankingsService.beginner(parseIntParam(limit, 50));
  }

  @Get('low-risk')
  lowRisk(@Query('limit') limit: string) {
    return this.rankingsService.lowRisk(parseIntParam(limit, 50));
  }

  @Get('yield-traps')
  yieldTraps(@Query('limit') limit: string) {
    return this.rankingsService.yieldTraps(parseIntParam(limit, 50));
  }

  @Get('long-term')
  longTerm(@Query('limit') limit: string) {
    return this.rankingsService.longTerm(parseIntParam(limit, 50));
  }

  @Get('rental-demand')
  rentalDemand(@Query('limit') limit: string) {
    return this.rankingsService.rentalDemand(parseIntParam(limit, 50));
  }
}
