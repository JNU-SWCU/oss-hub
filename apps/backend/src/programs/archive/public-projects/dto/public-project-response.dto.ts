import { type ProgramTrackType } from '@prisma/client';
import type {
  PublicProjectContributor,
  PublicProjectDetailResult,
  PublicProjectMetrics,
  PublicProjectPageResult,
} from '../public-project-result';
import type { PublicProjectRow } from '../public-projects.repository';

export enum PublicProjectApplicationMode {
  PERSONAL = 'PERSONAL',
  TEAM = 'TEAM',
}

function applicationMode(
  teamMemberCount: number,
): PublicProjectApplicationMode {
  return teamMemberCount > 1
    ? PublicProjectApplicationMode.TEAM
    : PublicProjectApplicationMode.PERSONAL;
}

function displayNameOf(row: {
  readonly teamName: string | null;
  readonly teamMemberCount: number;
  readonly applicantNickname: string;
}): string {
  if (row.teamMemberCount > 1 && row.teamName) return row.teamName;
  return row.applicantNickname;
}

export class PublicProjectListItemResponseDto {
  readonly projectId: string;
  readonly programId: string;
  readonly programName: string;
  readonly trackType: ProgramTrackType | null;
  readonly applicationMode: PublicProjectApplicationMode;
  readonly displayName: string;
  readonly repositoryName: string;
  readonly githubUrl: string;
  readonly publishedAt: string;

  private constructor(row: PublicProjectRow) {
    this.projectId = row.projectId;
    this.programId = row.programId;
    this.programName = row.programName;
    this.trackType = row.trackType;
    this.applicationMode = applicationMode(row.teamMemberCount);
    this.displayName = displayNameOf(row);
    this.repositoryName = row.repositoryName;
    this.githubUrl = row.githubUrl;
    this.publishedAt = row.publishedAt.toISOString();
  }

  static from(row: PublicProjectRow): PublicProjectListItemResponseDto {
    return new PublicProjectListItemResponseDto(row);
  }
}

export class PublicProjectPageResponseDto {
  readonly items: PublicProjectListItemResponseDto[];
  readonly pageSize: number;
  readonly nextPageId: string | null;

  private constructor(page: PublicProjectPageResult) {
    this.items = page.items.map((row) =>
      PublicProjectListItemResponseDto.from(row),
    );
    this.pageSize = page.pageSize;
    this.nextPageId = page.nextPageId;
  }

  static from(page: PublicProjectPageResult): PublicProjectPageResponseDto {
    return new PublicProjectPageResponseDto(page);
  }
}

export class PublicProjectYearsResponseDto {
  readonly years: readonly number[];

  private constructor(years: readonly number[]) {
    this.years = years;
  }

  static from(years: readonly number[]): PublicProjectYearsResponseDto {
    return new PublicProjectYearsResponseDto(years);
  }
}

export class PublicProjectMetricsResponseDto {
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly releaseCount: number;

  private constructor(metrics: PublicProjectMetrics) {
    this.commitCount = metrics.commitCount;
    this.pullRequestCount = metrics.pullRequestCount;
    this.releaseCount = metrics.releaseCount;
  }

  static from(metrics: PublicProjectMetrics): PublicProjectMetricsResponseDto {
    return new PublicProjectMetricsResponseDto(metrics);
  }
}

class PublicProjectContributorResponseDto {
  readonly githubLogin: string;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly releaseCount: number;

  private constructor(contributor: PublicProjectContributor) {
    this.githubLogin = contributor.githubLogin;
    this.commitCount = contributor.commitCount;
    this.pullRequestCount = contributor.pullRequestCount;
    this.releaseCount = contributor.releaseCount;
  }

  static from(
    contributor: PublicProjectContributor,
  ): PublicProjectContributorResponseDto {
    return new PublicProjectContributorResponseDto(contributor);
  }
}

export class PublicProjectDetailResponseDto {
  readonly projectId: string;
  readonly programId: string;
  readonly programName: string;
  readonly trackType: ProgramTrackType | null;
  readonly applicationMode: PublicProjectApplicationMode;
  readonly displayName: string;
  readonly repositoryName: string;
  readonly githubUrl: string;
  readonly publishedAt: string;
  readonly metrics: PublicProjectMetricsResponseDto;
  readonly contributors: PublicProjectContributorResponseDto[];

  private constructor(detail: PublicProjectDetailResult) {
    this.projectId = detail.row.projectId;
    this.programId = detail.row.programId;
    this.programName = detail.row.programName;
    this.trackType = detail.row.trackType;
    this.applicationMode = applicationMode(detail.row.teamMemberCount);
    this.displayName = displayNameOf(detail.row);
    this.repositoryName = detail.row.repositoryName;
    this.githubUrl = detail.row.githubUrl;
    this.publishedAt = detail.row.publishedAt.toISOString();
    this.metrics = PublicProjectMetricsResponseDto.from(detail.metrics);
    this.contributors = detail.contributors.map((contributor) =>
      PublicProjectContributorResponseDto.from(contributor),
    );
  }

  static from(
    detail: PublicProjectDetailResult,
  ): PublicProjectDetailResponseDto {
    return new PublicProjectDetailResponseDto(detail);
  }
}
