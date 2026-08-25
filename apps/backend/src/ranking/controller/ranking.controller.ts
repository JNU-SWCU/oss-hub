import { Controller, Get, Header, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { OptionalSession, Public } from '../../auth/auth-route-metadata';
import {
  assertNeverHttpAuth,
  HTTP_AUTH_KINDS,
  type OptionalSessionRequest,
} from '../../auth/http-auth';
import { RANKING_VIEWER_CLASSES } from '../domain/ranking';
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

  /**
   * Public ranking — the global AuthenticationGuard attaches optional auth.
   * Anonymous or invalid sessions yield `githubId: null` and the public
   * envelope (200); authenticated sessions use the guard's live principal.
   * Cache headers follow `page.viewerClass` so a fail-closed public page is
   * never stored as a staff response.
   */
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
    if (page.viewerClass === RANKING_VIEWER_CLASSES.STAFF) {
      response.setHeader('Cache-Control', 'private, no-store');
      response.setHeader('Vary', 'Cookie');
    } else {
      response.setHeader('Cache-Control', 'no-store');
    }
    return RankingPageResponseDto.from(page);
  }

  /** Distinct years that have public ranking data (desc). Sidebar year list. */
  @Get('years')
  @Public()
  @Header('Cache-Control', 'no-store')
  async listYears(): Promise<RankingYearsResponseDto> {
    return RankingYearsResponseDto.from(await this.rankingService.listYears());
  }
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
