import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  AcquireCutoverLeaseInput,
  CutoverLeaseToken,
} from '../collection-cutover.types';
import type { RegisteredGithubIdSet } from '../collection-incremental.types';

/**
 * todo 14 원자 전환 quiesce lease + 검증 보조 조회. lease 획득/해제는 `CollectionSyncLease`와
 * 동일한 epoch-fenced raw SQL 패턴을 `CollectionCutoverLease` 테이블에 재구현한 것이다(별도 run
 * 후보 테이블 없음). `isQuiesced`는 스케줄러/관리자 트리거가 매 호출마다 값싸게 확인하는
 * best-effort 게이트다 — 단일 조직/앱 배포를 전제로 key 없이 활성 lease 존재 여부만 본다.
 */
@Injectable()
export class CollectionCutoverRepository {
  constructor(private readonly db: PrismaService) {}

  async acquireLease(
    input: AcquireCutoverLeaseInput,
  ): Promise<CutoverLeaseToken | null> {
    const rows = await this.db.$queryRawUnsafe<CutoverLeaseToken[]>(
      `INSERT INTO "CollectionCutoverLease" ("appId", "scope", "epoch", "ownerId", "expiresAt", "runId", "updatedAt")
       VALUES ($1, $2, 1, $3, $4, $5, $6)
       ON CONFLICT ("appId", "scope") DO UPDATE SET
         "epoch" = "CollectionCutoverLease"."epoch" + 1, "ownerId" = EXCLUDED."ownerId",
         "expiresAt" = EXCLUDED."expiresAt", "runId" = EXCLUDED."runId", "updatedAt" = EXCLUDED."updatedAt"
       WHERE "CollectionCutoverLease"."expiresAt" <= $6
       RETURNING "appId", "scope", "ownerId", "epoch", "runId", "expiresAt"`,
      input.appId,
      input.scope,
      input.ownerId,
      input.expiresAt,
      input.runId,
      input.now,
    );
    return rows[0] ?? null;
  }

  /** best-effort 정리 — 이미 다른 owner가 훔친 lease라면 아무 것도 하지 않는다. */
  async releaseLease(token: CutoverLeaseToken, now: Date): Promise<void> {
    await this.db.$executeRawUnsafe(
      `UPDATE "CollectionCutoverLease" SET "expiresAt" = $6, "updatedAt" = $6
       WHERE "appId" = $1 AND "scope" = $2 AND "ownerId" = $3 AND "epoch" = $4 AND "runId" = $5`,
      token.appId,
      token.scope,
      token.ownerId,
      token.epoch,
      token.runId,
      now,
    );
  }

  /**
   * 스케줄러/관리자 트리거 경로가 매 호출마다 값싸게 확인하는 게이트. 단일 조직/앱 배포를
   * 전제로 key를 요구하지 않는다 — RUNTIME_CONFIG를 로드하지 않고도(자격증명 검증을 지연한 채)
   * 호출할 수 있어야 하기 때문이다.
   */
  async isQuiesced(now: Date): Promise<boolean> {
    const rows = await this.db.$queryRawUnsafe<Array<{ quiesced: boolean }>>(
      `SELECT EXISTS(SELECT 1 FROM "CollectionCutoverLease" WHERE "expiresAt" > $1) AS "quiesced"`,
      now,
    );
    return rows[0]?.quiesced ?? false;
  }

  async countVerifyingStreams(): Promise<number> {
    return this.db.collectionRepositoryStream.count({
      where: { status: 'VERIFYING' },
    });
  }

  async countCommitFactsForRepositories(
    repositoryIds: readonly string[],
    registeredGithubIds: RegisteredGithubIdSet,
  ): Promise<number> {
    if (repositoryIds.length === 0 || registeredGithubIds.size === 0) return 0;
    const rows = await this.db.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS "count"
      FROM "CollectionCommitFact" f
      WHERE f."repositoryId" = ANY(${[...repositoryIds]})
        AND f."authorGithubId" = ANY(${[...registeredGithubIds]})
    `;
    return Number(rows[0]?.count ?? 0n);
  }

  async countPullRequestFactsForRepositories(
    repositoryIds: readonly string[],
    registeredGithubIds: RegisteredGithubIdSet,
  ): Promise<number> {
    if (repositoryIds.length === 0 || registeredGithubIds.size === 0) return 0;
    const rows = await this.db.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS "count"
      FROM "CollectionPullRequestFact" f
      WHERE f."repositoryId" = ANY(${[...repositoryIds]})
        AND f."authorGithubId" = ANY(${[...registeredGithubIds]})
    `;
    return Number(rows[0]?.count ?? 0n);
  }

  async countReleaseFactsForRepositories(
    repositoryIds: readonly string[],
    registeredGithubIds: RegisteredGithubIdSet,
  ): Promise<number> {
    if (repositoryIds.length === 0 || registeredGithubIds.size === 0) return 0;
    const rows = await this.db.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS "count"
      FROM "CollectionReleaseFact" f
      WHERE f."repositoryId" = ANY(${[...repositoryIds]})
        AND f."authorGithubId" = ANY(${[...registeredGithubIds]})
    `;
    return Number(rows[0]?.count ?? 0n);
  }
}
