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

/**
 * todo 18 — profile의 project 한 행. `PublicProjectListItemResponseDto`와 같은 project
 * 식별/표시 필드에 `observed`/`dataAsOf`/`metrics`(이 사용자만의 누적 기여, todo 16의
 * `getContributorCumulativeMetrics`를 githubId로 좁힌 값)를 더한다. `observed`가 `false`면
 * 아직 collection이 이 저장소를 관측하지 않은 것이라 `dataAsOf`/`metrics`가 `null`이고,
 * `observed`가 `true`인데 `metrics`가 0값이면 관측은 됐지만 이 사용자의 기여가 없다는
 * 뜻이다 — 두 상태를 프런트가 구분할 수 있다.
 *
 * `hasCollectedData`(#893)는 `observed: true`를 다시 나눈다 — presence는 provisioning
 * 시점부터 PRESENT라 `observed`만으로는 "첫 inventory sweep이 실제로 끝났는지"를 알 수 없다
 * (알려진 갭, `public-exposure-matrix.integration.spec.ts` outcome-3). 이 필드는
 * `lastCompleteInventoryObservedAt` 존재 여부로 서버가 파생한 boolean일 뿐, 원시 시각이나
 * `presence`/`nextRunAt` 같은 collection-control 필드 자체는 노출하지 않는다.
 */
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
  /** 관측된 project들만 합산한 사용자 전체 누적. */
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
