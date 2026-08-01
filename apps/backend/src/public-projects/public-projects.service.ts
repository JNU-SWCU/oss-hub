import { Inject, Injectable } from '@nestjs/common';
import {
  COLLECTION_READ_PORT,
  type CollectionReadPort,
} from '../collection/collection-read.port';
import { DomainException } from '../common/error-code';
import { PublicEligibilityService } from '../public-eligibility/public-eligibility.service';
import type {
  PublicProjectDetailResult,
  PublicProjectMetrics,
  PublicProjectPageResult,
  PublicUserProfileProjectResult,
  PublicUserProfileResult,
} from './public-project-result';
import {
  decodePublicProjectCursor,
  encodePublicProjectCursor,
} from './public-project-cursor';
import {
  PUBLIC_PROJECTS_ERROR_CODES,
  PublicProjectsErrorCode,
} from './public-projects-error-code.enum';
import { PublicProjectsRepository } from './public-projects.repository';

/**
 * todo 16 — list/detail/profile 행 선택이 todo 15의 `PublicEligibilityService` 하나를
 * 공유한다. 이 서비스가 하는 일은 (1) 전용 repository로 platform-public 후보를 읽고,
 * (2) eligibility fence를 배치로 적용하고, (3) 필요할 때만 `CollectionReadPort`로 지표/
 * 기여자를 배치 조회하는 것뿐이다 — 페이지 크기가 커져도 페이지당 질의 개수는 상수다.
 */
@Injectable()
export class PublicProjectsService {
  constructor(
    private readonly repository: PublicProjectsRepository,
    private readonly eligibility: PublicEligibilityService,
    @Inject(COLLECTION_READ_PORT)
    private readonly collection: CollectionReadPort,
  ) {}

  /**
   * 페이지 경계는 원본 keyset 조회(`pageSize + 1` lookahead)만으로 결정되고, eligibility
   * 필터링은 그 경계 안에서 항목을 지울 뿐 다음 페이지로 밀어내지 않는다 — freshness fence가
   * 드물게 저장소를 회수하면 그 페이지가 `pageSize`보다 적게 보일 수 있다(의도된 trade-off).
   * 페이지당 질의: 원본 조회 1개 + eligibility의 배치 조회 1개 = 2개, pageSize와 무관하다.
   */
  async findPage(
    pageId: string | undefined,
    pageSize: number,
  ): Promise<PublicProjectPageResult> {
    const cursor =
      pageId === undefined ? null : decodePublicProjectCursor(pageId);
    const rows = await this.repository.listPage(cursor, pageSize + 1);
    const hasMore = rows.length > pageSize;
    const pageRows = rows.slice(0, pageSize);

    const eligible = await this.eligibility.filterEligibleRepositoryIds(
      pageRows.map((row) => ({
        githubRepositoryId: row.githubRepositoryId,
        publishedAt: row.publishedAt,
      })),
    );
    const items = pageRows.filter((row) =>
      eligible.has(row.githubRepositoryId),
    );

    const lastRawRow = pageRows[pageRows.length - 1];
    const nextPageId =
      hasMore && lastRawRow !== undefined
        ? encodePublicProjectCursor({
            publishedAt: lastRawRow.publishedAt,
            id: lastRawRow.id,
          })
        : null;

    return { items, pageSize, nextPageId };
  }

  /**
   * 페이지당 질의: 원본 조회 1개 + eligibility의 배치 조회 1개 + 지표 배치 조회 1개 +
   * 기여자 배치 조회 1개 = 4개, 상수다. private/미존재 저장소는 항상 같은 404다.
   */
  async findDetail(projectId: string): Promise<PublicProjectDetailResult> {
    const row = await this.repository.findById(projectId);
    if (row === null) {
      throw new DomainException(
        PUBLIC_PROJECTS_ERROR_CODES[PublicProjectsErrorCode.PROJECT_NOT_FOUND],
      );
    }

    const eligible = await this.eligibility.isEligible({
      githubRepositoryId: row.githubRepositoryId,
      publishedAt: row.publishedAt,
    });
    if (!eligible) {
      throw new DomainException(
        PUBLIC_PROJECTS_ERROR_CODES[PublicProjectsErrorCode.PROJECT_NOT_FOUND],
      );
    }

    const [metricsRows, contributorRows] = await Promise.all([
      this.collection.getRepositoryCumulativeMetrics({
        repositoryIds: [row.githubRepositoryId],
      }),
      this.collection.getContributorCumulativeMetrics({
        repositoryIds: [row.githubRepositoryId],
      }),
    ]);
    const metric = metricsRows[0];

    return {
      row,
      metrics: {
        commitCount: metric?.commitCount ?? 0,
        pullRequestCount: metric?.pullRequestCount ?? 0,
        releaseCount: metric?.releaseCount ?? 0,
      },
      contributors: [...contributorRows]
        .sort((left, right) => right.commitCount - left.commitCount)
        .map((contributor) => ({
          githubLogin: contributor.githubLogin,
          commitCount: contributor.commitCount,
          pullRequestCount: contributor.pullRequestCount,
          releaseCount: contributor.releaseCount,
        })),
    };
  }

  /**
   * 존재하지 않는 사용자와 공개 가능한 프로젝트가 하나도 없는 사용자를 항상 동일한 404로
   * 응답한다. 페이지당 질의: 신원 조회 1개 + 후보 조회 1개(병렬) + eligibility 배치 조회 1개
   * + 저장소 지표 배치 조회 1개 + 기여자 지표 배치 조회 1개(병렬) = 5개, 사용자가 참여한
   * 저장소 개수와 무관하다.
   */
  async findProfile(userId: string): Promise<PublicUserProfileResult> {
    const [identity, rows] = await Promise.all([
      this.repository.findUserIdentity(userId),
      this.repository.listForUser(userId),
    ]);
    if (identity === null) {
      throw new DomainException(
        PUBLIC_PROJECTS_ERROR_CODES[
          PublicProjectsErrorCode.USER_PROFILE_NOT_FOUND
        ],
      );
    }

    const eligible = await this.eligibility.filterEligibleRepositoryIds(
      rows.map((row) => ({
        githubRepositoryId: row.githubRepositoryId,
        publishedAt: row.publishedAt,
      })),
    );
    const projects = rows.filter((row) => eligible.has(row.githubRepositoryId));
    if (projects.length === 0) {
      throw new DomainException(
        PUBLIC_PROJECTS_ERROR_CODES[
          PublicProjectsErrorCode.USER_PROFILE_NOT_FOUND
        ],
      );
    }

    const repositoryIds = projects.map((project) => project.githubRepositoryId);
    const [repositoryMetricsRows, contributorRows] = await Promise.all([
      this.collection.getRepositoryCumulativeMetrics({ repositoryIds }),
      this.collection.getContributorCumulativeMetrics({ repositoryIds }),
    ]);

    const observedByRepository = new Map(
      repositoryMetricsRows.map((metric) => [
        metric.repositoryId.toString(),
        metric,
      ]),
    );
    // 이 사용자의 githubId와 정확히 일치하는 기여자 행만 남긴다 — 다른 기여자(null author를
    // 포함해 애초에 이 집계 테이블에 행이 생기지 않는 경우도 마찬가지)의 활동은 절대 섞이지
    // 않는다.
    const ownContributionByRepository = new Map(
      contributorRows
        .filter((contributor) => contributor.githubUserId === identity.githubId)
        .map((contributor) => [
          contributor.repositoryId.toString(),
          contributor,
        ]),
    );

    const profileProjects: PublicUserProfileProjectResult[] = projects.map(
      (project) => {
        const key = project.githubRepositoryId.toString();
        const repositoryMetric = observedByRepository.get(key);
        if (repositoryMetric === undefined) {
          return {
            row: project,
            observed: false,
            dataAsOf: null,
            metrics: null,
          };
        }
        const own = ownContributionByRepository.get(key);
        return {
          row: project,
          observed: true,
          dataAsOf: repositoryMetric.dataAsOf,
          metrics: {
            commitCount: own?.commitCount ?? 0,
            pullRequestCount: own?.pullRequestCount ?? 0,
            releaseCount: own?.releaseCount ?? 0,
          },
        };
      },
    );

    const observedTotals = profileProjects.reduce<PublicProjectMetrics>(
      (totals, project) =>
        project.metrics === null
          ? totals
          : {
              commitCount: totals.commitCount + project.metrics.commitCount,
              pullRequestCount:
                totals.pullRequestCount + project.metrics.pullRequestCount,
              releaseCount: totals.releaseCount + project.metrics.releaseCount,
            },
      { commitCount: 0, pullRequestCount: 0, releaseCount: 0 },
    );

    return { identity, projects: profileProjects, observedTotals };
  }
}
