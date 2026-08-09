import type { CollectionRepositoryMetricsDto } from '../../../../github/collection-read.port';

type CollectionRepositoryVisibility =
  CollectionRepositoryMetricsDto['visibility'];
type CollectionRepositoryPresence = CollectionRepositoryMetricsDto['presence'];

/**
 * todo 15 — 저장소 하나에 대한 최신 complete inventory 관측.
 *
 * `observedAt`이 `null`이면 아직 complete 관측이 한 번도 없었다는 뜻이다(unknown).
 * `collection-sync`(todo 10)는 partial run(inventory 예외 발생)에서는 visibility/presence를
 * 절대 갱신하지 않으므로, 이 필드가 항상 "가장 최근 complete 관측"만 담는다 — 진행 중인
 * partial 관측으로 값이 섞이지 않는다.
 */
export interface PublicEligibilityObservation {
  readonly visibility: CollectionRepositoryVisibility;
  readonly presence: CollectionRepositoryPresence;
  readonly observedAt: Date | null;
}

/**
 * todo 15 — public eligibility 정책 입력.
 *
 * `platformPublic`/`publishedAt`은 이미 확정된 platform eligibility(managed publish 발행
 * 결정 — 예: `PublicShowcaseRepository` projection)를 그대로 전달받는다. 이 정책은 그 결정을
 * 다시 계산하지 않고, 그 위에 Collection freshness fence만 얹는다.
 */
export interface PublicEligibilityInput {
  readonly platformPublic: boolean;
  readonly publishedAt: Date | null;
  /** 해당 저장소의 최신 collection 관측. 관측 자체가 없으면 `null`(unknown과 동일하게 처리). */
  readonly observation: PublicEligibilityObservation | null;
}

/**
 * todo 15 — public eligibility 정책의 단일 원본(list/detail/profile/ranking 행 선택이
 * 공유한다). 경계 규칙:
 *
 * 1. platform-private(또는 미발행)이면 항상 비공개.
 * 2. complete 관측이 없으면(observation `null` 또는 `observedAt` `null`, 즉 unknown/partial)
 *    "missing"을 주장하지 않는다 — 비공개로 만들지 않는다.
 * 3. complete 관측이 private/missing이고 그 관측이 발행 "이후"(`observedAt > publishedAt`)면
 *    회수한다(비공개) — out-of-band 변경이 노출을 즉시 회수한다.
 * 4. complete 관측이 private/missing이지만 발행 "이전이거나 동시"(`observedAt <= publishedAt`)면
 *    stale 관측이다 — 비공개로 만들지 않는다.
 */
export function isPublicEligible(input: PublicEligibilityInput): boolean {
  if (!input.platformPublic || input.publishedAt === null) return false;

  const observation = input.observation;
  if (observation === null || observation.observedAt === null) return true;

  const isPrivateOrMissing =
    observation.visibility === 'PRIVATE' || observation.presence === 'ABSENT';
  if (!isPrivateOrMissing) return true;

  return observation.observedAt.getTime() <= input.publishedAt.getTime();
}
