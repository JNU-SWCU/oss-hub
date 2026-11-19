import type { Response } from 'express';
import { type OptionalSessionRequest } from '../auth/http-auth.types';
import { HTTP_AUTH_KINDS } from '../platform/auth.config';
import { Injectable } from '@nestjs/common';
import { CollectionScheduleService } from '../github/collection-schedule.service';
import {
  RankingRepository,
  type RankedPageRow,
  type RankingStreak,
} from './ranking.repository';
import {
  RankingYearService,
  RankingYear,
  RANKING_YEAR_ALL,
} from './ranking-year.service';

const RANKING_VIEWER_CLASSES = {
  PUBLIC: 'public',
  MEMBER: 'member',
  STAFF: 'staff',
} as const;

export type RankingViewerClass =
  (typeof RANKING_VIEWER_CLASSES)[keyof typeof RANKING_VIEWER_CLASSES];

interface RankingMetrics {
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly issueCount: number;
  readonly repositoryCount: number;
  readonly starCount: number;
}

export interface RankingEntry extends RankingMetrics {
  readonly rank: number;
  readonly previousRank: number | null;
  readonly streak?: RankingStreak | null;

  readonly githubLogin: string;
  readonly department: string | null;

  readonly name?: string | null;
  readonly total: number;
}

export interface RankingPage {
  readonly year: RankingYear;
  readonly items: readonly RankingEntry[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;

  readonly dataAsOf: Date | null;
  readonly viewerClass: RankingViewerClass;
  readonly nextCycleAt: Date | null;
}

@Injectable()
export class RankingService {
  constructor(
    private readonly ranking: RankingRepository,
    private readonly rankingYearService: RankingYearService,
    private readonly collectionSchedule: CollectionScheduleService,
  ) {}

  async findPageFromRequest(
    request: Parameters<RankingYearService['resolveRankingQueryYear']>[0] & {
      readonly page: number;
      readonly pageSize: number;
    },
    auth: OptionalSessionRequest['auth'],
    response: Pick<Response, 'setHeader'>,
  ): Promise<RankingPage> {
    const page = await this.findPage(
      this.rankingYearService.resolveRankingQueryYear(request),
      request.page,
      request.pageSize,
      githubIdFrom(auth),
    );
    if (page.viewerClass === RANKING_VIEWER_CLASSES.PUBLIC) {
      response.setHeader('Cache-Control', 'no-store');
    } else {
      response.setHeader('Cache-Control', 'private, no-store');
      response.setHeader('Vary', 'Cookie');
    }
    return page;
  }

  async findPage(
    year: RankingYear,
    page: number,
    pageSize: number,
    githubId: bigint | null,
    now: Date = new Date(),
  ): Promise<RankingPage> {
    const [ranked, dataAsOf, viewerClass] = await Promise.all([
      this.ranking.findRankedPage(
        year === RANKING_YEAR_ALL ? {} : { currentYear: year },
        { offset: (page - 1) * pageSize, limit: pageSize },
        now,
      ),
      this.ranking.findDataAsOf(),
      this.ranking.findViewerClass(githubId),
    ]);
    const slice = ranked.rows;
    const nextCycleAt = this.collectionSchedule.nextScheduledCollectionAt(now);

    if (viewerClass !== RANKING_VIEWER_CLASSES.STAFF) {
      return {
        year,
        items: slice.map(toPublicEntry),
        page,
        pageSize,
        total: ranked.total,
        dataAsOf,
        viewerClass,
        nextCycleAt,
      };
    }

    try {
      return {
        year,
        items: await this.attachStaffNames(slice),
        page,
        pageSize,
        total: ranked.total,
        dataAsOf,
        viewerClass: RANKING_VIEWER_CLASSES.STAFF,
        nextCycleAt,
      };
    } catch {
      return {
        year,
        items: slice.map(toPublicEntry),
        page,
        pageSize,
        total: ranked.total,
        dataAsOf,
        viewerClass: RANKING_VIEWER_CLASSES.PUBLIC,
        nextCycleAt,
      };
    }
  }

  async listYears(): Promise<readonly number[]> {
    return this.ranking.listYears();
  }

  private async attachStaffNames(
    slice: readonly RankedPageRow[],
  ): Promise<readonly RankingEntry[]> {
    const names = await this.ranking.findNamesByGithubIds(
      slice.map((entry) => entry.githubId),
    );
    return slice.map((entry) => ({
      ...toPublicEntry(entry),
      name: names.get(entry.githubId) ?? null,
    }));
  }
}

function toPublicEntry(entry: RankedPageRow): RankingEntry {
  return {
    rank: entry.rank,
    previousRank: entry.previousRank,
    ...(entry.rank <= 10 ? { streak: entry.streak ?? null } : {}),
    githubLogin: entry.githubLogin,
    department: entry.department,
    commitCount: entry.commitCount,
    pullRequestCount: entry.pullRequestCount,
    issueCount: entry.issueCount,
    repositoryCount: entry.repositoryCount,
    starCount: entry.starCount,
    total: entry.total,
  };
}

function githubIdFrom(auth: OptionalSessionRequest['auth']): bigint | null {
  switch (auth.kind) {
    case HTTP_AUTH_KINDS.ANONYMOUS:
      return null;
    case HTTP_AUTH_KINDS.AUTHENTICATED:
      return auth.principal.githubId;
    default:
      return assertNeverHttpAuth(auth);
  }
}

function assertNeverHttpAuth(auth: never): never {
  throw new TypeError(`Unexpected HTTP authentication kind: ${String(auth)}`);
}
