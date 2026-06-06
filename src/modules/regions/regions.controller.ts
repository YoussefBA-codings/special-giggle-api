import { Controller, Get, Param, Query } from '@nestjs/common';
import { RegionsService } from './regions.service';
import { parseIntParam } from '../../shared/utils/pagination.util';

@Controller('regions')
export class RegionsController {
  constructor(private readonly regionsService: RegionsService) {}

  @Get()
  list() {
    return this.regionsService.list();
  }

  @Get(':slug')
  getDetail(@Param('slug') slug: string) {
    return this.regionsService.getDetail(slug);
  }

  @Get(':slug/cities')
  getCities(
    @Param('slug') slug: string,
    @Query('page') page: string,
    @Query('limit') limit: string,
  ) {
    return this.regionsService.getCities(slug, parseIntParam(page, 1), parseIntParam(limit, 20));
  }
}
