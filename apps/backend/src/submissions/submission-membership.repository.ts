import { Prisma } from '@prisma/client';
import { programApplicationParticipantWhere } from '../programs/program-participant';

/**
 * 제출·파일 경로가 「이 사람이 **지금** 이 신청의 팀 사람인가」를 쓰기 직전에 되묻는
 * 공통 관문이다(#1269). 두 소비자(제출 쓰기 울타리·비공개 파일 울타리)가 같은 한 벌을
 * 쓰도록 여기 한 곳에만 둔다 — 같은 판정을 SQL로 두 벌 쓰면 그 자체가 갈라짐의 원인이다.
 *
 * ⚠ 잠금 **앞**에서 읽은 멤버십은 권한의 정본이 아니다. 인가와 저장 사이에 탈퇴·제외·승계가
 * 커밋될 수 있으므로, 팀 소속을 바꾸는 경로가 잡는 행(`Team`)을 이 트랜잭션에서 먼저 잡은
 * **뒤에** 소속을 다시 읽는다.
 */

/** 잠금 대상 행 — 존재 여부만 본다. */
type LockedRow = Readonly<{ id: string }>;

/** 신청서에서 바뀌지 않는 좌표. 잠글 대상을 정하는 데만 쓴다. */
type ApplicationCoordinates = Readonly<{ programId: string; teamId: string }>;

/**
 * 잠금 뒤 되읽은 결과가 「이미 이 팀 사람이 아님」일 때 소비자가 던지는 오류다.
 * 소비자는 이것을 각자의 `NOT_APPLICATION_MEMBER`로 매핑한다 — 없는 신청과 같은 응답이라
 * 제출물의 존재 여부가 새지 않는다.
 *
 * 오류 자체를 여기서 던지지는 않는다. 판정 함수는 boolean만 돌려주고, HTTP 계약으로
 * 옮기는 일은 각 서비스의 몫이기 때문이다.
 */
export class SubmissionMembershipChangedError extends Error {
  override readonly name = 'SubmissionMembershipChangedError';

  constructor(
    readonly applicationId: string,
    readonly userId: string,
  ) {
    super('제출 권한이 트랜잭션 도중 사라졌습니다.');
  }
}

/**
 * 신청의 `Program` → `Team`을 `FOR UPDATE`로 잠근 **뒤에** 현재 소속을 되읽어,
 * 지금 이 신청의 팀 구성원일 때만 `true`를 돌려준다.
 *
 * **잠금 순서는 `Program` → `Team`이다.** 신청 생성·수정·삭제 경로가
 * (`student-application-management.repository.ts`) 이미 `Program` → `Team` → `Application`
 * 순으로 잡는다. 여기서 팀을 먼저 잡으면 순서가 갈라 교착이 된다. 나중에 인원 쿼터나
 * 활성 사용자 잠금이 필요해지면 그 잠금은 `Team` **뒤**(`Program` → `Team` → `User`)에
 * 붙인다 — 초대 수락 경로가 `Team` → `User` 순이므로 그 순서와 어긋나지 않는다.
 * 이 함수는 `User` 행을 직접 잠그지 않는다.
 *
 * 판정의 정본은 `programApplicationParticipantWhere` 하나다. `applicantId`(누가 처음 냈는지),
 * `Team.leaderId`(팀장 자리), `SubmissionFile.uploaderId`(누가 올렸는지)는 모두 **기록**이지
 * 권한이 아니다 — 어느 것도 여기서 권한을 만들어 주지 않는다.
 *
 * 신청 상태·기간 같은 자격 판정은 기존대로 서비스의 몫이다. 여기서 새로 만들지 않는다.
 * 잠금은 호출부 트랜잭션 수명 동안 유지되므로 반드시 트랜잭션 클라이언트로 부른다.
 * HTTP·저장소 호출은 하지 않는다.
 */
export async function lockSubmissionMembership(
  tx: Prisma.TransactionClient,
  applicationId: string,
  userId: string,
): Promise<boolean> {
  const coordinates: ApplicationCoordinates | null =
    await tx.application.findUnique({
      where: { id: applicationId },
      select: { programId: true, teamId: true },
    });
  if (!coordinates) return false;

  const lockedPrograms = await tx.$queryRaw<readonly LockedRow[]>(Prisma.sql`
    SELECT "id" FROM "Program" WHERE "id" = ${coordinates.programId} FOR UPDATE
  `);
  if (lockedPrograms.length === 0) return false;

  const lockedTeams = await tx.$queryRaw<readonly LockedRow[]>(Prisma.sql`
    SELECT "id" FROM "Team" WHERE "id" = ${coordinates.teamId} FOR UPDATE
  `);
  if (lockedTeams.length === 0) return false;

  // 잠금 뒤에야 사실을 읽는다 — 기다리는 동안 탈퇴·제외·승계가 커밋되었을 수 있다.
  // 신청서를 다시 읽는 것도 같은 이유다: 팀이 옮겨졌다면 옛 팀 소속으로 통과하면 안 된다.
  const current = await tx.application.findFirst({
    where: {
      id: applicationId,
      ...programApplicationParticipantWhere(userId),
    },
    select: { id: true },
  });
  return current !== null;
}
