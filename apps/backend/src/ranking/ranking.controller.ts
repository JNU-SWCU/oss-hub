import { Controller, Get, Header, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger';
import { type OptionalSessionRequest } from '../auth/http-auth.types';
import { OptionalSession, Public } from '../auth/auth-route.decorator';
import {
  RankingRequestDto,
  RankingTimelineRequestDto,
} from './dto/ranking-request.dto';
import {
  RankingPageResponseDto,
  RankingAllTimelineResponseDto,
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
  @ApiExtraModels(RankingTimelineResponseDto, RankingAllTimelineResponseDto)
  @ApiOkResponse({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(RankingTimelineResponseDto) },
        { $ref: getSchemaPath(RankingAllTimelineResponseDto) },
      ],
    },
  })
  async findTimeline(
    @Query() query: RankingTimelineRequestDto,
  ): Promise<RankingTimelineResponseDto | RankingAllTimelineResponseDto> {
    const timeline = await this.rankingTimeline.findTimelineFromRequest(query);
    return timeline.year === 'all'
      ? RankingAllTimelineResponseDto.from(timeline)
      : RankingTimelineResponseDto.from(timeline);
  }

  @Get('years')
  @Public()
  @Header('Cache-Control', 'no-store')
  async listYears(): Promise<RankingYearsResponseDto> {
    return RankingYearsResponseDto.from(await this.rankingService.listYears());
  }
}
