import { type ProgramTrackType } from '@prisma/client';
import type { PublicProjectApplicationMode } from '../public-projects.repository';
import type {
  PublicProjectMetrics,
  PublicUserProfileProjectResult,
  PublicUserProfileResult,
} from '../public-projects.service';

class PublicUserProfileMetricsResponseDto {
  declare readonly commitCount: number;
  declare readonly pullRequestCount: number;
  declare readonly releaseCount: number;

  static from(
    metrics: PublicProjectMetrics,
  ): PublicUserProfileMetricsResponseDto {
    return {
      commitCount: metrics.commitCount,
      pullRequestCount: metrics.pullRequestCount,
      releaseCount: metrics.releaseCount,
    };
  }
}

class PublicUserProfileProjectResponseDto {
  declare readonly projectId: string;
  declare readonly programId: string;
  declare readonly programName: string;
  declare readonly trackType: ProgramTrackType | null;
  declare readonly applicationMode: PublicProjectApplicationMode;
  declare readonly displayName: string;
  declare readonly repositoryName: string;
  declare readonly githubUrl: string;
  declare readonly publishedAt: string;
  declare readonly observed: boolean;
  declare readonly hasCollectedData: boolean;
  declare readonly dataAsOf: string | null;
  declare readonly metrics: PublicUserProfileMetricsResponseDto | null;

  static from(
    result: PublicUserProfileProjectResult,
  ): PublicUserProfileProjectResponseDto {
    const { row } = result;
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
      observed: result.observed,
      hasCollectedData: result.hasCollectedData,
      dataAsOf: result.dataAsOf === null ? null : result.dataAsOf.toISOString(),
      metrics:
        result.metrics === null
          ? null
          : PublicUserProfileMetricsResponseDto.from(result.metrics),
    };
  }
}

export class PublicUserProfileResponseDto {
  declare readonly userId: string;
  declare readonly githubNickname: string;
  declare readonly avatarUrl: string | null;
  declare readonly projects: PublicUserProfileProjectResponseDto[];

  declare readonly observedTotals: PublicUserProfileMetricsResponseDto;

  static from(result: PublicUserProfileResult): PublicUserProfileResponseDto {
    return {
      userId: result.identity.userId,
      githubNickname: result.identity.githubNickname,
      avatarUrl: result.identity.avatarUrl,
      projects: result.projects.map((project) =>
        PublicUserProfileProjectResponseDto.from(project),
      ),
      observedTotals: PublicUserProfileMetricsResponseDto.from(
        result.observedTotals,
      ),
    };
  }
}
