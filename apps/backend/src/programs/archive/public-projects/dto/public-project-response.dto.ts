import { type ProgramCategory } from '@prisma/client';
import type {
  PublicProjectCategoryCountsResult,
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

/**
 * 개인 참여도 팀을 갖게 되면서(D5) 팀 유무로는 구분되지 않는다. 멤버가 1명뿐이면
 * 개인 참여로 읽는다 — 팀 유무로 가르면 모든 프로젝트가 TEAM이 된다.
 */
function applicationMode(
  teamMemberCount: number,
): PublicProjectApplicationMode {
  return teamMemberCount > 1
    ? PublicProjectApplicationMode.TEAM
    : PublicProjectApplicationMode.PERSONAL;
}

/**
 * 공개 표시명. **실명을 넣지 않는다** — 이 응답은 무인증 공개 endpoint로 나간다.
 * 1인 팀은 자동 생성 팀명 대신 GitHub 닉네임을 보여 준다.
 */
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
  readonly category: ProgramCategory;
  readonly applicationMode: PublicProjectApplicationMode;
  readonly displayName: string;
  readonly repositoryName: string;
  readonly githubUrl: string;
  readonly publishedAt: string;

  private constructor(row: PublicProjectRow) {
    this.projectId = row.projectId;
    this.programId = row.programId;
    this.programName = row.programName;
    this.category = row.category;
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

/** `GET /projects/category-counts` — 좌측 아카이브 메뉴 뱃지용. */
export class PublicProjectCategoryCountsResponseDto {
  readonly all: number;
  readonly BASIC: number;
  readonly SW_VALUE_SPREAD: number;
  readonly OSS_CONTEST: number;
  readonly CAPSTONE: number;
  readonly SW_CONVERGENCE: number;
  readonly GLOBAL_MAKERTHON: number;
  readonly CORPORATE_INTERNSHIP: number;

  private constructor(counts: PublicProjectCategoryCountsResult) {
    this.all = counts.all;
    this.BASIC = counts.BASIC;
    this.SW_VALUE_SPREAD = counts.SW_VALUE_SPREAD;
    this.OSS_CONTEST = counts.OSS_CONTEST;
    this.CAPSTONE = counts.CAPSTONE;
    this.SW_CONVERGENCE = counts.SW_CONVERGENCE;
    this.GLOBAL_MAKERTHON = counts.GLOBAL_MAKERTHON;
    this.CORPORATE_INTERNSHIP = counts.CORPORATE_INTERNSHIP;
  }

  static from(
    counts: PublicProjectCategoryCountsResult,
  ): PublicProjectCategoryCountsResponseDto {
    return new PublicProjectCategoryCountsResponseDto(counts);
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
  readonly category: ProgramCategory;
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
    this.category = detail.row.category;
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
