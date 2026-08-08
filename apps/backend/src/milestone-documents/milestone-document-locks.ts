import { Prisma } from '@prisma/client';

/** 잠근 서류 항목 행 — 목적이 잠금이라 id만 읽는다. */
export interface LockedMilestoneDocumentRow {
  readonly id: string;
}

/**
 * 한 마일스톤의 서류 항목(`MilestoneDocument`) 행 **전부**를 `id` 오름차순으로 `FOR UPDATE` 잠근다.
 * 두 경로가 같은 문장을 쓰도록 여기 한 벌만 둔다 — 잠금 순서 규칙이 두 벌로 갈라지면 그 자체가
 * 교착의 원인이 된다.
 *
 * **왜 id 오름차순인가**: 서류 항목 여러 행을 만지는 경로(순서 재부여)가 「요청받은 순서」대로
 * 잠그면, 같은 목록을 서로 반대 방향으로 재정렬하는 두 교직원이 A→B와 B→A로 엇갈려 서로를
 * 기다린다. PostgreSQL이 한쪽을 교착으로 중단시키고, 정상 동작이 500이 된다. 정해진 한 가지
 * 순서로 먼저 잠그면 두 트랜잭션 중 하나가 반드시 먼저 전부를 잡는다.
 *
 * **왜 `FOR UPDATE`인가**: 학생 제출 경로(`upsertSubmission`)가 같은 `MilestoneDocument` 행을
 * `FOR SHARE`로 잡는다. `FOR UPDATE`는 그 공유 잠금과 충돌하므로 둘 중 하나는 반드시 기다린다
 * — 이것이 「제출 수를 셌더니 0이었다」와 「학생이 제출을 커밋했다」를 실제로 직렬화하는 지점이다.
 *
 * **전체 잠금 순서 규칙**: `Program` → `Milestone` → `MilestoneDocument`(id asc). 마일스톤 삭제
 * 경로는 셋을 이 순서로 모두 잡고, 순서 재부여 경로는 마지막 하나만 잡는다. 부분집합을 같은
 * 순서로 잡는 것이므로 두 경로 사이에 순환이 생기지 않는다.
 *
 * `ORDER BY` + `FOR UPDATE`는 PostgreSQL에서 정렬 뒤에 잠금이 걸린다(LockRows가 Sort 위 노드).
 * 즉 실제로 정렬된 순서대로 잠긴다.
 */
export function lockMilestoneDocumentsOfMilestone(
  client: Prisma.TransactionClient,
  milestoneId: string,
): Promise<readonly LockedMilestoneDocumentRow[]> {
  return client.$queryRaw<readonly LockedMilestoneDocumentRow[]>(Prisma.sql`
    SELECT "id"
    FROM "MilestoneDocument"
    WHERE "milestoneId" = ${milestoneId}
    ORDER BY "id"
    FOR UPDATE
  `);
}
