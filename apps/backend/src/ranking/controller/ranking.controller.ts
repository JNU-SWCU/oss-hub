import { Controller, Get, Header, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthConfig } from '../../auth/auth.config';
import { resolveSession } from '../../auth/session-resolution';
import { RANKING_VIEWER_TIERS } from '../domain/ranking';
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
   * 공개 랭킹 — **인증 가드를 붙이지 않는다.** 붙이면 비로그인이 401 이 돼 공개
   * 랭킹이 죽는다. 대신 `resolveSession` 을 optional 로 쓴다 — 그 함수는 실패해도
   * 예외가 아니라 `githubId: null` 을 돌려주므로, 쿠키가 없거나 무효하면 그대로
   * 공개 계층이 된다.
   *
   * 교직원·관리자 응답에는 실명이 들어가므로 `private, no-store` 로 내린다
   * (보호 경로의 가드가 쓰는 값과 동일) — 공유 캐시가 그 응답을 비로그인
   * 방문자에게 되돌려주는 경로를 막는다. 비로그인 응답은 데코레이터의 `no-store` 그대로다.
   */
  @Get()
  @Header('Cache-Control', 'no-store')
  async findPage(
    @Query() query: RankingQueryRequestDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<RankingPageResponseDto> {
    const tier = await this.rankingService.resolveViewerTier(
      (await resolveSession(this.config, request.headers.cookie)).githubId,
    );
    if (tier !== RANKING_VIEWER_TIERS.PUBLIC) {
      response.setHeader('Cache-Control', 'private, no-store');
    }
    return RankingPageResponseDto.from(
      await this.rankingService.findPage(
        resolveRankingQueryYear(query),
        query.page,
        query.pageSize,
        tier,
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
