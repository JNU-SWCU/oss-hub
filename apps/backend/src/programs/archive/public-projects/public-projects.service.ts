import { Inject, Injectable } from '@nestjs/common';
import { DomainException } from '../../../common/error-code';
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
  resolvePublicProjectCursorKey,
  type PublicProjectCursorKey,
} from './public-project-cursor';
import {
  PUBLIC_PROJECTS_ERROR_CODES,
  PublicProjectsErrorCode,
} from './public-projects-error-code.enum';
import { PublicProjectMetricsRepository } from './repository/public-project-metrics.repository';
import { PublicProjectsRepository } from './public-projects.repository';
import type { RuntimeConfig } from '../../../runtime-config/runtime-config';
import { RUNTIME_CONFIG } from '../../../runtime-config/runtime-config.module';

@Injectable()
export class PublicProjectsService {
  private readonly cursorKey: PublicProjectCursorKey;

  constructor(
    private readonly repository: PublicProjectsRepository,
    private readonly eligibility: PublicEligibilityService,
    private readonly metrics: PublicProjectMetricsRepository,
    @Inject(RUNTIME_CONFIG)
    runtimeConfig: Pick<RuntimeConfig, 'SESSION_SECRET'>,
  ) {
    this.cursorKey = resolvePublicProjectCursorKey(runtimeConfig);
  }

  async findPage(
    pageId: string | undefined,
    pageSize: number,
    year?: number,
  ): Promise<PublicProjectPageResult> {
    const cursor =
      pageId === undefined
        ? null
        : decodePublicProjectCursor(pageId, this.cursorKey);
    const rows = await this.repository.listPage(cursor, pageSize + 1, year);
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
        ? encodePublicProjectCursor(
            {
              publishedAt: lastRawRow.publishedAt,
              id: lastRawRow.id,
            },
            this.cursorKey,
          )
        : null;

    return { items, pageSize, nextPageId };
  }

  async listYears(): Promise<readonly number[]> {
    return this.repository.listYears();
  }

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
      this.metrics.getRepositoryCumulativeMetrics({
        repositoryIds: [row.githubRepositoryId],
      }),
      this.metrics.getContributorCumulativeMetrics({
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
      this.metrics.getRepositoryCumulativeMetrics({ repositoryIds }),
      this.metrics.getContributorCumulativeMetrics({ repositoryIds }),
    ]);

    const observedByRepository = new Map(
      repositoryMetricsRows.map((metric) => [
        metric.repositoryId.toString(),
        metric,
      ]),
    );

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
            hasCollectedData: false,
            dataAsOf: null,
            metrics: null,
          };
        }
        const own = ownContributionByRepository.get(key);
        return {
          row: project,
          observed: true,
          hasCollectedData: repositoryMetric.hasCollectedData,
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
