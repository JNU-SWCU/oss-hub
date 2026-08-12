import { Prisma } from '@prisma/client';
import type { Prisma as PrismaTypes } from '@prisma/client';

/** 삭제 확인 화면(GET edit)과 purge 트랜잭션이 공유하는 4종 자식 범위. */
export type ProgramDeletionScopeCounts = {
  readonly applications: number;
  readonly teams: number;
  readonly boardPosts: number;
  readonly submissions: number;
};

type DeletionScopeCountsRow = Readonly<{
  applications: bigint;
  teams: bigint;
  boardPosts: bigint;
  submissions: bigint;
}>;

/**
 * 한 SQL 문장의 snapshot으로 4종 삭제 범위를 읽는다.
 *
 * `program-editor.repository.ts`(GET edit 확인 화면)와 `program-lifecycle.service.ts`
 * (purge 트랜잭션의 재확인)가 **같은 쿼리**를 공유한다 — 두 곳이 각자 count를 세면 문장이
 * 갈라질 여지가 생기고, 그 틈이 다시 TOCTOU가 된다(#F2). 호출자는 반드시 같은 트랜잭션의
 * `TransactionClient`를 넘겨 단일 스냅샷을 보장해야 한다.
 */
export async function readProgramDeletionScopeCounts(
  transaction: PrismaTypes.TransactionClient,
  programId: string,
): Promise<ProgramDeletionScopeCounts> {
  const [row] = await transaction.$queryRaw<readonly DeletionScopeCountsRow[]>(
    Prisma.sql`
      SELECT
        (SELECT count(*) FROM "Application" WHERE "programId" = ${programId}) AS applications,
        (SELECT count(*) FROM "Team" WHERE "programId" = ${programId}) AS teams,
        (SELECT count(*) FROM "BoardPost" WHERE "programId" = ${programId}) AS "boardPosts",
        (SELECT count(*) FROM "Submission" WHERE "milestoneId" IN (
          SELECT id FROM "Milestone" WHERE "programId" = ${programId}
        )) AS submissions
    `,
  );
  if (!row) throw new Error('Deletion scope count query returned no result.');
  return {
    applications: Number(row.applications),
    teams: Number(row.teams),
    boardPosts: Number(row.boardPosts),
    submissions: Number(row.submissions),
  };
}

export function sameProgramDeletionScopeCounts(
  left: ProgramDeletionScopeCounts,
  right: ProgramDeletionScopeCounts,
): boolean {
  return (
    left.applications === right.applications &&
    left.teams === right.teams &&
    left.boardPosts === right.boardPosts &&
    left.submissions === right.submissions
  );
}
