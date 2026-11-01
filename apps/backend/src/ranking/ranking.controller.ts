import { Controller, Get, Header, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { type OptionalSessionRequest } from '../auth/http-auth.types';
import { OptionalSession, Public } from '../auth/auth-route.decorator';
import {
  RankingRequestDto,
  RankingTimelineRequestDto,
} from './dto/ranking-request.dto';
import {
  RankingPageResponseDto,
  RankingTimelineResponseDto,
  RankingYearsResponseDto,
} from './dto/ranking-page-response.dto';
import { RankingService } from './ranking.service';
import { RankingTimelineService } from './ranking-timeline.service';

@Controller('ranking')
export class RankingController {
  constructor(
    private readonly rankingService: RankingService,
    private readonly rankingTimeline: RankingTimelineService,
  ) {}

  @Get()
  @OptionalSession()
  async findPage(
    @Query() query: RankingRequestDto,
    @Req() request: OptionalSessionRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<RankingPageResponseDto> {
    return RankingPageResponseDto.from(
      await this.rankingService.findPageFromRequest(
        query,
        request.auth,
        response,
      ),
    );
  }

  @Get('timeline')
  @Public()
  @Header('Cache-Control', 'no-store')
  async findTimeline(
    @Query() query: RankingTimelineRequestDto,
  ): Promise<RankingTimelineResponseDto> {
    return RankingTimelineResponseDto.from(
      await this.rankingTimeline.findTimelineFromRequest(query),
    );
  }

  @Get('years')
  @Public()
  @Header('Cache-Control', 'no-store')
  async listYears(): Promise<RankingYearsResponseDto> {
    return RankingYearsResponseDto.from(await this.rankingService.listYears());
  }
}
