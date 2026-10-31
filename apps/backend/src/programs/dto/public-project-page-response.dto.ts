import { type ProgramTrackType } from '@prisma/client';
import type {
  PublicProjectContributor,
  PublicProjectDetailResult,
  PublicProjectListItem,
  PublicProjectMetrics,
  PublicProjectPageResult,
} from '../public-projects.service';
import type { PublicProjectApplicationMode } from '../public-projects.config';

class PublicProjectListItemResponseDto {
  declare readonly projectId: string;
  declare readonly programId: string;
  declare readonly programName: string;
  declare readonly trackType: ProgramTrackType | null;
  declare readonly applicationMode: PublicProjectApplicationMode;
  declare readonly displayName: string;
  declare readonly repositoryName: string;
  declare readonly githubUrl: string;
  declare readonly publishedAt: string;

  static from(row: PublicProjectListItem): PublicProjectListItemResponseDto {
    return {
      projectId: row.projectId,
      programId: row.programId,
      programName: row.programName,
      trackType: row.trackType,
      applicationMode: row.applicationMode,
      displayName: row.displayName,
      repositoryName: row.repositoryName,
      githubUrl: row.githubUrl,
      publishedAt: row.publishedAt.toISOString(),
    };
  }
}

export class PublicProjectPageResponseDto {
  declare readonly items: PublicProjectListItemResponseDto[];
  declare readonly pageSize: number;
  declare readonly nextPageId: string | null;

  static from(page: PublicProjectPageResult): PublicProjectPageResponseDto {
    return {
      items: page.items.map((row) =>
        PublicProjectListItemResponseDto.from(row),
      ),
      pageSize: page.pageSize,
      nextPageId: page.nextPageId,
    };
  }
}

class PublicProjectMetricsResponseDto {
  declare readonly commitCount: number;
  declare readonly pullRequestCount: number;
  declare readonly releaseCount: number;

  static from(metrics: PublicProjectMetrics): PublicProjectMetricsResponseDto {
    return {
      commitCount: metrics.commitCount,
      pullRequestCount: metrics.pullRequestCount,
      releaseCount: metrics.releaseCount,
    };
  }
}

class PublicProjectContributorResponseDto {
  declare readonly githubLogin: string;
  declare readonly commitCount: number;
  declare readonly pullRequestCount: number;
  declare readonly releaseCount: number;

  static from(
    contributor: PublicProjectContributor,
  ): PublicProjectContributorResponseDto {
    return {
      githubLogin: contributor.githubLogin,
      commitCount: contributor.commitCount,
      pullRequestCount: contributor.pullRequestCount,
      releaseCount: contributor.releaseCount,
    };
  }
}

export class PublicProjectDetailResponseDto {
  declare readonly projectId: string;
  declare readonly programId: string;
  declare readonly programName: string;
  declare readonly trackType: ProgramTrackType | null;
  declare readonly applicationMode: PublicProjectApplicationMode;
  declare readonly displayName: string;
  declare readonly repositoryName: string;
  declare readonly githubUrl: string;
  declare readonly publishedAt: string;
  declare readonly metrics: PublicProjectMetricsResponseDto;
  declare readonly contributors: PublicProjectContributorResponseDto[];

  static from(
    detail: PublicProjectDetailResult,
  ): PublicProjectDetailResponseDto {
    return {
      projectId: detail.row.projectId,
      programId: detail.row.programId,
      programName: detail.row.programName,
      trackType: detail.row.trackType,
      applicationMode: detail.row.applicationMode,
      displayName: detail.row.displayName,
      repositoryName: detail.row.repositoryName,
      githubUrl: detail.row.githubUrl,
      publishedAt: detail.row.publishedAt.toISOString(),
      metrics: PublicProjectMetricsResponseDto.from(detail.metrics),
      contributors: detail.contributors.map((contributor) =>
        PublicProjectContributorResponseDto.from(contributor),
      ),
    };
  }
}
