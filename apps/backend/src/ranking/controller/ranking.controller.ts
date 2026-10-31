import { Controller, Get, Header, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  OptionalSession,
  Public,
} from '../../auth/controller/auth-route-metadata';
import {
  assertNeverHttpAuth,
  HTTP_AUTH_KINDS,
  type OptionalSessionRequest,
} from '../../auth/controller/http-auth';
import {
  RANKING_VIEWER_CLASSES,
  type RankingViewerClass,
} from '../domain/ranking';
import { rankingYearInAsiaSeoul } from '../domain/ranking-event';
import {
  RankingQueryRequestDto,
  RankingTimelineQueryRequestDto,
  resolveRankingQueryYear,
} from '../dto/ranking-query.dto';
import {
  RankingPageResponseDto,
  RankingYearsResponseDto,
} from '../dto/ranking-response.dto';
import { RankingTimelineResponseDto } from '../dto/ranking-timeline-response.dto';
import { RankingService } from '../service/ranking.service';

@Controller('ranking')
export class RankingController {
  constructor(private readonly rankingService: RankingService) {}

  @Get()
  @OptionalSession()
  async findPage(
    @Query() query: RankingQueryRequestDto,
    @Req() request: OptionalSessionRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<RankingPageResponseDto> {
    const page = await this.rankingService.findPage(
      resolveRankingQueryYear(query),
      query.page,
      query.pageSize,
      githubIdFrom(request),
    );
    applyViewerCacheHeaders(response, page.viewerClass);
    return RankingPageResponseDto.from(page);
  }

  @Get('timeline')
  @OptionalSession()
  async findTimeline(
    @Query() query: RankingTimelineQueryRequestDto,
    @Req() request: OptionalSessionRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<RankingTimelineResponseDto> {
    const timeline = await this.rankingService.findTimeline(
      query.year ?? rankingYearInAsiaSeoul(new Date()),
      githubIdFrom(request),
    );
    applyViewerCacheHeaders(response, timeline.viewerClass);
    return RankingTimelineResponseDto.from(timeline);
  }

  @Get('years')
  @Public()
  @Header('Cache-Control', 'no-store')
  async listYears(): Promise<RankingYearsResponseDto> {
    return RankingYearsResponseDto.from(await this.rankingService.listYears());
  }
}

function applyViewerCacheHeaders(
  response: Response,
  viewerClass: RankingViewerClass,
): void {
  if (viewerClass === RANKING_VIEWER_CLASSES.PUBLIC) {
    response.setHeader('Cache-Control', 'no-store');
    return;
  }
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('Vary', 'Cookie');
}

function githubIdFrom(request: OptionalSessionRequest): bigint | null {
  switch (request.auth.kind) {
    case HTTP_AUTH_KINDS.ANONYMOUS:
      return null;
    case HTTP_AUTH_KINDS.AUTHENTICATED:
      return request.auth.principal.githubId;
    default:
      return assertNeverHttpAuth(request.auth);
  }
}
