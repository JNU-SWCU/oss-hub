import type {
  PublicProjectRow,
  PublicUserIdentity,
} from './public-projects.repository';

/**
 * todo 16 — 서비스 계층이 생산하는 도메인 결과 형태. `dto/*.ts`는 응답 계약(DTO)만 담아야
 * 하는 naming-convention lint 규칙(`*Request|Response Dto`) 대상이라, 그 규칙 대상이 아닌
 * 이 파일에 결과 타입을 둔다(ranking 모듈의 `domain/ranking.ts` 분리와 같은 이유).
 */
export interface PublicProjectPageResult {
  readonly items: readonly PublicProjectRow[];
  readonly pageSize: number;
  readonly nextPageId: string | null;
}

export interface PublicProjectMetrics {
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly releaseCount: number;
}

export interface PublicProjectContributor {
  readonly githubLogin: string;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly releaseCount: number;
}

export interface PublicProjectDetailResult {
  readonly row: PublicProjectRow;
  readonly metrics: PublicProjectMetrics;
  readonly contributors: readonly PublicProjectContributor[];
}

export interface PublicUserProfileResult {
  readonly identity: PublicUserIdentity;
  readonly projects: readonly PublicProjectRow[];
}
