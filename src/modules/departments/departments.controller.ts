import { Controller, Get, Param, Query } from '@nestjs/common';
import { DepartmentsService } from './departments.service';
import { parseIntParam } from '../../shared/utils/pagination.util';

@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departmentsService: DepartmentsService) {}

  @Get()
  list() {
    return this.departmentsService.list();
  }

  @Get(':code')
  getDetail(@Param('code') code: string) {
    return this.departmentsService.getDetail(code);
  }

  @Get(':code/cities')
  getCities(
    @Param('code') code: string,
    @Query('page') page: string,
    @Query('limit') limit: string,
  ) {
    return this.departmentsService.getCities(code, parseIntParam(page, 1), parseIntParam(limit, 20));
  }
}
