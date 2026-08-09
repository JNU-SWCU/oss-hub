import { Controller, Get, Header, Query } from '@nestjs/common';
import {
  RankingQueryRequestDto,
  resolveRankingQueryYear,
} from '../dto/ranking-query.dto';
import {
  RankingPageResponseDto,
  RankingYearsResponseDto,
} from '../dto/ranking-response.dto';
import { RankingService } from '../service/ranking.service';

@Controller('ranking')
export class RankingController {
  constructor(private readonly rankingService: RankingService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async findPage(
    @Query() query: RankingQueryRequestDto,
  ): Promise<RankingPageResponseDto> {
    return RankingPageResponseDto.from(
      await this.rankingService.findPage(
        resolveRankingQueryYear(query),
        query.page,
        query.pageSize,
      ),
    );
  }

  /** Distinct years that have public ranking data (desc). Sidebar year list. */
  @Get('years')
  @Header('Cache-Control', 'no-store')
  async listYears(): Promise<RankingYearsResponseDto> {
    return RankingYearsResponseDto.from(await this.rankingService.listYears());
  }
}
