import { type ProgramTrackType } from '@prisma/client';
import {
  applicationMode,
  displayNameOf,
  type PublicProjectApplicationMode,
} from '../public-projects.policy';
import type {
  PublicProjectMetrics,
  PublicUserProfileProjectResult,
  PublicUserProfileResult,
} from '../programs.types';

class PublicUserProfileMetricsResponseDto {
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly releaseCount: number;

  private constructor(metrics: PublicProjectMetrics) {
    this.commitCount = metrics.commitCount;
    this.pullRequestCount = metrics.pullRequestCount;
    this.releaseCount = metrics.releaseCount;
  }

  static from(
    metrics: PublicProjectMetrics,
  ): PublicUserProfileMetricsResponseDto {
    return new PublicUserProfileMetricsResponseDto(metrics);
  }
}

class PublicUserProfileProjectResponseDto {
  readonly projectId: string;
  readonly programId: string;
  readonly programName: string;
  readonly trackType: ProgramTrackType | null;
  readonly applicationMode: PublicProjectApplicationMode;
  readonly displayName: string;
  readonly repositoryName: string;
  readonly githubUrl: string;
  readonly publishedAt: string;
  readonly observed: boolean;
  readonly hasCollectedData: boolean;
  readonly dataAsOf: string | null;
  readonly metrics: PublicUserProfileMetricsResponseDto | null;

  private constructor(result: PublicUserProfileProjectResult) {
    const { row } = result;
    this.projectId = row.projectId;
    this.programId = row.programId;
    this.programName = row.programName;
    this.trackType = row.trackType;
    this.applicationMode = applicationMode(row.teamMemberCount);
    this.displayName = displayNameOf(row);
    this.repositoryName = row.repositoryName;
    this.githubUrl = row.githubUrl;
    this.publishedAt = row.publishedAt.toISOString();
    this.observed = result.observed;
    this.hasCollectedData = result.hasCollectedData;
    this.dataAsOf =
      result.dataAsOf === null ? null : result.dataAsOf.toISOString();
    this.metrics =
      result.metrics === null
        ? null
        : PublicUserProfileMetricsResponseDto.from(result.metrics);
  }

  static from(
    result: PublicUserProfileProjectResult,
  ): PublicUserProfileProjectResponseDto {
    return new PublicUserProfileProjectResponseDto(result);
  }
}

export class PublicUserProfileResponseDto {
  readonly userId: string;
  readonly githubNickname: string;
  readonly avatarUrl: string | null;
  readonly projects: PublicUserProfileProjectResponseDto[];

  readonly observedTotals: PublicUserProfileMetricsResponseDto;

  private constructor(result: PublicUserProfileResult) {
    this.userId = result.identity.userId;
    this.githubNickname = result.identity.githubNickname;
    this.avatarUrl = result.identity.avatarUrl;
    this.projects = result.projects.map((project) =>
      PublicUserProfileProjectResponseDto.from(project),
    );
    this.observedTotals = PublicUserProfileMetricsResponseDto.from(
      result.observedTotals,
    );
  }

  static from(result: PublicUserProfileResult): PublicUserProfileResponseDto {
    return new PublicUserProfileResponseDto(result);
  }
}
