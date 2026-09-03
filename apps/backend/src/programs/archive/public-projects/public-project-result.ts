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

/**
 * todo 18 — profile의 project 행 하나. `observed`는 이 저장소가 collection에 관측된 적이
 * 있는지(즉 `CollectionRepository` 행 존재)를 뜻하고, `metrics`는 그 저장소에서 **이 사용자만의**
 * 누적 기여다. `observed`가 `false`면 아직 아무것도 관측되지 않은 것이라 `metrics`/`dataAsOf`가
 * `null`이다. `observed`가 `true`인데 이 사용자의 기여자 행이 없으면(다른 사람만 기여했거나
 * 아직 이 사용자 기여가 전혀 없으면) 관측은 됐지만 0인 것이라 `metrics`가 0값으로 채워진다 —
 * 이 두 상태(미관측 vs 관측된 0)를 프런트가 구분해서 보여줄 수 있게 한다.
 *
 * `hasCollectedData`(#893)는 세 번째 상태를 더 나눈다 — #617 단계 D 이후 `presence: PRESENT`가
 * provisioning 시점부터 참이라 `observed`는 실제 inventory sweep 여부와 무관하게 `true`가 될 수
 * 있다(알려진 갭, `public-exposure-matrix.integration.spec.ts` outcome-3). `observed: true`이면서
 * `hasCollectedData: false`면 "첫 sweep 전이라 관측은 PRESENT이지만 실제 수집 데이터는 아직
 * 없다"는 뜻이고, `observed: false`면 애초에 PRESENT조차 아니므로 `hasCollectedData`도 항상
 * `false`다.
 */
export interface PublicUserProfileProjectResult {
  readonly row: PublicProjectRow;
  readonly observed: boolean;
  readonly hasCollectedData: boolean;
  readonly dataAsOf: Date | null;
  readonly metrics: PublicProjectMetrics | null;
}

export interface PublicUserProfileResult {
  readonly identity: PublicUserIdentity;
  readonly projects: readonly PublicUserProfileProjectResult[];
  /** 관측된 project들만 합산한 사용자 전체 누적 — 미관측 project는 합계에 넣지 않는다. */
  readonly observedTotals: PublicProjectMetrics;
}
