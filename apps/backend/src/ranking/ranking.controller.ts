import { Controller, Get, Query } from '@nestjs/common';
import { RankingQueryDto } from './dto/ranking-query.dto';
import { RankingPageResponseDto } from './dto/ranking-response.dto';
import { RankingService } from './ranking.service';

@Controller('ranking')
export class RankingController {
  constructor(private readonly rankingService: RankingService) {}

  @Get()
  async findPage(
    @Query() query: RankingQueryDto,
  ): Promise<RankingPageResponseDto> {
    return RankingPageResponseDto.from(
      await this.rankingService.findPage(
        query.period,
        query.page,
        query.pageSize,
      ),
    );
  }
}
