import { Controller, Get, Header, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthConfig } from '../../auth/auth.config';
import { OptionalSession, Public } from '../../auth/auth-route-metadata';
import { resolveSession } from '../../auth/session-resolution';
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
  constructor(
    private readonly rankingService: RankingService,
    private readonly config: AuthConfig,
  ) {}

  /**
   * Public ranking — no auth guard. `resolveSession` is optional: missing or
   * invalid cookies yield `githubId: null` and the public envelope (200).
   * Cache headers follow `page.viewerClass` so a fail-closed public page is
   * never stored as a staff response.
   */
  @Get()
  @OptionalSession()
  async findPage(
    @Query() query: RankingQueryRequestDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<RankingPageResponseDto> {
    const page = await this.rankingService.findPage(
      resolveRankingQueryYear(query),
      query.page,
      query.pageSize,
      (await resolveSession(this.config, request.headers.cookie)).githubId,
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
