import { type ProgramTrackType } from '@prisma/client';
import type {
  PublicUserProfileProjectResult,
  PublicUserProfileResult,
} from '../public-project-result';
import {
  PublicProjectApplicationMode,
  PublicProjectListItemResponseDto,
  PublicProjectMetricsResponseDto,
} from './public-project-response.dto';

export class PublicUserProfileProjectResponseDto {
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
  readonly metrics: PublicProjectMetricsResponseDto | null;

  private constructor(result: PublicUserProfileProjectResult) {
    const item = PublicProjectListItemResponseDto.from(result.row);
    this.projectId = item.projectId;
    this.programId = item.programId;
    this.programName = item.programName;
    this.trackType = item.trackType;
    this.applicationMode = item.applicationMode;
    this.displayName = item.displayName;
    this.repositoryName = item.repositoryName;
    this.githubUrl = item.githubUrl;
    this.publishedAt = item.publishedAt;
    this.observed = result.observed;
    this.hasCollectedData = result.hasCollectedData;
    this.dataAsOf =
      result.dataAsOf === null ? null : result.dataAsOf.toISOString();
    this.metrics =
      result.metrics === null
        ? null
        : PublicProjectMetricsResponseDto.from(result.metrics);
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

  readonly observedTotals: PublicProjectMetricsResponseDto;

  private constructor(result: PublicUserProfileResult) {
    this.userId = result.identity.userId;
    this.githubNickname = result.identity.githubNickname;
    this.avatarUrl = result.identity.avatarUrl;
    this.projects = result.projects.map((project) =>
      PublicUserProfileProjectResponseDto.from(project),
    );
    this.observedTotals = PublicProjectMetricsResponseDto.from(
      result.observedTotals,
    );
  }

  static from(result: PublicUserProfileResult): PublicUserProfileResponseDto {
    return new PublicUserProfileResponseDto(result);
  }
}
