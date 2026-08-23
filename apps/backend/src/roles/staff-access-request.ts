import { MemberKind, StaffAccessRequestStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';

/**
 * 교직원 접근 요청을 **여는** 단 하나의 자리(#569).
 *
 * 교직원으로 가입을 마친 사람에게 승인 대기 요청을 만든다. 예전에는 역할 선택 화면이
 * 누르는 즉시 요청을 만들었다 — 그래서 이름·소속이 빈 미완성 신청이 관리자 대기줄에
 * 올라갔고, 잘못 고른 사람은 되돌릴 방법이 없었다.
 *
 * 여는 시점은 이제 **가입을 마치는 순간**, 곧 프로필이 만들어지는 순간이다. 그 순간이
 * 오는 길이 둘이라 이 함수를 두 곳이 부른다.
 *
 * 1. `users.repository.ts` — 프로필을 완료 저장할 때(대부분의 신규 가입).
 * 2. `roles.service.ts` — 회원 유형을 고르는 시점에 프로필이 **이미** 완료돼 있을 때.
 *    회수된 뒤 다시 고르는 사용자가 그렇다. 그에게는 남은 단계가 없어서, 기록만 하고
 *    끝내면 요청이 영원히 열리지 않는다.
 *
 * 두 곳 모두 **프로필을 쓰는 트랜잭션 안에서** 부른다. 따로 떼어 두면 그 사이에서
 * 끊겼을 때 "프로필은 완료됐는데 요청이 없는" 계정이 남고, 그 계정은 프로필 화면이
 * 이미 완료라며 내보내 다시는 요청을 열 기회를 얻지 못한다.
 *
 * 학생에게는 열 요청이 없다. 학생의 회원 정체성은 프로필 행 자체가 담고 있고,
 * 접근 권한(`hasStaffAccess`·`hasAdminAccess`)은 그와 독립이다.
 */
export type StaffAccessRequestTransaction = {
  readonly staffAccessRequest: Pick<
    Prisma.TransactionClient['staffAccessRequest'],
    'findFirst' | 'create'
  >;
};

export type StaffAccessRequestTarget = {
  readonly id: string;
  readonly memberKind: MemberKind;
  /** 이미 교직원 접근 권한이 있으면 승인받을 것이 없다(관리자가 미리 부여한 경우). */
  readonly hasStaffAccess: boolean;
};

/**
 * 요청을 연 결과 — 무엇이 대기 중인가.
 *
 * 열 것이 없었으면 `null`이다. 호출부가 "요청이 열렸다"를 조용히 가정하지 않도록
 * 결과를 값으로 돌려준다.
 */
export type StaffAccessRequestOutcome = {
  readonly requestStatus: StaffAccessRequestStatus | null;
};

const NOTHING_REQUESTED: StaffAccessRequestOutcome = { requestStatus: null };

export async function requestStaffAccess(
  transaction: StaffAccessRequestTransaction,
  target: StaffAccessRequestTarget,
): Promise<StaffAccessRequestOutcome> {
  if (target.memberKind !== MemberKind.STAFF || target.hasStaffAccess) {
    return NOTHING_REQUESTED;
  }

  // 사용자당 PENDING은 하나뿐이다(마이그레이션의 partial unique). 이미 있으면
  // 그것이 이 사람의 신청이므로 다시 만들지 않는다.
  const pending = await transaction.staffAccessRequest.findFirst({
    where: { userId: target.id, status: StaffAccessRequestStatus.PENDING },
  });
  if (pending) {
    return { requestStatus: pending.status };
  }
  const created = await transaction.staffAccessRequest.create({
    data: { userId: target.id },
  });
  return { requestStatus: created.status };
}
