import { Inject, Injectable } from '@nestjs/common';
import {
  COLLECTION_READ_PORT,
  type CollectionReadPort,
} from '../collection/collection-read.port';
import { isPublicEligible } from './domain/public-eligibility';

/**
 * todo 15 — 이미 platform eligibility가 확정된(managed publish) 저장소 하나.
 * `publishedAt`은 그 발행 결정이 내려진 시각이다(예: `PublicShowcaseRepository.publishedAt`).
 */
export interface PublicEligibilityCandidate {
  readonly githubRepositoryId: bigint;
  readonly publishedAt: Date;
}

/**
 * todo 15 — Public eligibility service.
 *
 * platform eligibility(managed publish)가 이미 확정된 후보 배치를 받아 `CollectionReadPort`의
 * 최신 complete inventory 관측(`visibility`/`presence`/`visibilityObservedAt`)으로 Collection
 * freshness fence(`domain/public-eligibility.ts`)를 적용한다. list/detail/profile/ranking
 * 행 선택이 이 서비스 하나를 공유한다 — 반환값은 공개 가능한 `githubRepositoryId` 집합뿐이며,
 * Collection control 메타데이터(cursor/lease/run/watermark)는 응답에 전혀 포함하지 않는다.
 */
@Injectable()
export class PublicEligibilityService {
  constructor(
    @Inject(COLLECTION_READ_PORT)
    private readonly collection: CollectionReadPort,
  ) {}

  async filterEligibleRepositoryIds(
    candidates: readonly PublicEligibilityCandidate[],
  ): Promise<ReadonlySet<bigint>> {
    if (candidates.length === 0) return new Set();

    const metrics = await this.collection.getRepositoryMetrics({
      repositoryIds: candidates.map(
        (candidate) => candidate.githubRepositoryId,
      ),
    });
    const observationByRepositoryId = new Map(
      metrics.map((metric) => [metric.repositoryId, metric]),
    );

    const eligible = new Set<bigint>();
    for (const candidate of candidates) {
      const metric = observationByRepositoryId.get(
        candidate.githubRepositoryId,
      );
      const decision = isPublicEligible({
        platformPublic: true,
        publishedAt: candidate.publishedAt,
        observation:
          metric === undefined
            ? null
            : {
                visibility: metric.visibility,
                presence: metric.presence,
                observedAt: metric.visibilityObservedAt,
              },
      });
      if (decision) eligible.add(candidate.githubRepositoryId);
    }
    return eligible;
  }

  /** detail/profile 라우트처럼 배치 없이 저장소 하나만 판정할 때 쓴다. */
  async isEligible(candidate: PublicEligibilityCandidate): Promise<boolean> {
    const eligible = await this.filterEligibleRepositoryIds([candidate]);
    return eligible.has(candidate.githubRepositoryId);
  }
}
