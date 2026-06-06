import { Controller, Get, Param, Query, BadRequestException } from '@nestjs/common';
import { CommunesService, CommuneFilters, CommuneSortField } from './communes.service';
import { parseFloatParam, parseIntParam } from '../../shared/utils/pagination.util';

@Controller('cities')
export class CommunesController {
  constructor(private readonly communesService: CommunesService) {}

  @Get()
  list(@Query() query: Record<string, string>) {
    const filters: CommuneFilters = {
      search: query.search,
      department: query.department,
      region: query.region,
      profile: query.profile,
      riskLevel: query.riskLevel,
      dataQuality: query.dataQuality,
      minGlobalScore: parseFloatParam(query.minGlobalScore),
      maxGlobalScore: parseFloatParam(query.maxGlobalScore),
      minYield: parseFloatParam(query.minYield),
      maxYield: parseFloatParam(query.maxYield),
      minPrice: parseFloatParam(query.minPrice),
      maxPrice: parseFloatParam(query.maxPrice),
    };

    const sortBy = (query.sortBy as CommuneSortField) ?? 'globalScore';
    const sortOrder = (query.sortOrder as 'asc' | 'desc') ?? 'desc';
    const page = parseIntParam(query.page, 1);
    const limit = parseIntParam(query.limit, 20);

    return this.communesService.list(filters, sortBy, sortOrder, page, limit);
  }

  @Get('compare')
  compare(@Query('codes') codes: string) {
    if (!codes) throw new BadRequestException('Le paramètre "codes" est requis (ex: ?codes=75056,92012)');
    const inseeCodes = codes.split(',').map((c) => c.trim()).filter(Boolean);
    if (inseeCodes.length < 2) throw new BadRequestException('Fournissez au moins 2 codes INSEE');
    if (inseeCodes.length > 10) throw new BadRequestException('Maximum 10 communes par comparaison');
    return this.communesService.compare(inseeCodes);
  }

  @Get(':inseeCode')
  getDetail(@Param('inseeCode') inseeCode: string) {
    return this.communesService.getDetail(inseeCode);
  }
}
