import { Role, RoleRequestStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';

/**
 * 고른 역할을 **확정**하는 단 하나의 자리(#569).
 *
 * 확정이란 학생에게 `User.role = STUDENT`를 붙이고, 교직원에게 승인 대기 요청을 만드는
 * 일이다. 예전에는 역할 선택 화면이 누르는 즉시 둘 다 했다 — 그래서 이름·학과가 빈
 * 미완성 신청이 관리자 대기줄에 올라갔고, 잘못 고른 사람은 되돌릴 방법이 없었다.
 *
 * 확정 시점은 이제 **가입을 마치는 순간**, 곧 프로필이 고른 역할 기준으로 완료되는
 * 순간이다. 그 순간이 오는 길이 둘이라 이 함수를 두 곳이 부른다.
 *
 * 1. `users.repository.ts` — 프로필을 완료 저장할 때(대부분의 신규 가입).
 * 2. `roles.service.ts` — 역할을 고르는 시점에 프로필이 **이미** 완료돼 있을 때. 회수된
 *    뒤 역할을 다시 고르는 사용자가 그렇다. 그에게는 남은 단계가 없어서, 기록만 하고
 *    끝내면 확정이 영원히 오지 않는다.
 *
 * 두 곳 모두 **프로필을 쓰는 트랜잭션 안에서** 부른다. 따로 떼어 두면 그 사이에서
 * 끊겼을 때 "프로필은 완료됐는데 역할이 없는" 계정이 남고, 그 계정은 프로필 화면이
 * 이미 완료라며 내보내 다시는 확정될 기회를 얻지 못한다.
 */
export type RoleConfirmationTransaction = {
  readonly user: Pick<Prisma.TransactionClient['user'], 'updateMany'>;
  readonly roleRequest: Pick<
    Prisma.TransactionClient['roleRequest'],
    'findFirst' | 'create'
  >;
};

export type RoleConfirmationTarget = {
  readonly id: string;
  readonly role: Role | null;
  readonly selectedRole: Role | null;
};

/**
 * 확정한 결과 — 무엇이 붙었고 무엇이 대기 중인가.
 *
 * 확정할 것이 없었으면 둘 다 `null`이다. 호출부가 "확정됐다"를 조용히 가정하지 않도록
 * 결과를 값으로 돌려준다.
 */
export type RoleConfirmation = {
  readonly role: Role | null;
  readonly requestStatus: RoleRequestStatus | null;
};

const NOTHING_CONFIRMED: RoleConfirmation = { role: null, requestStatus: null };

export async function confirmSelectedRole(
  transaction: RoleConfirmationTransaction,
  target: RoleConfirmationTarget,
): Promise<RoleConfirmation> {
  // 이미 확정된 역할이 있으면 손대지 않는다. 승인을 받은 교직원·시드된 관리자가
  // 프로필을 고치러 들어와도 그 권한이 다시 계산되지 않아야 한다.
  if (target.role !== null) {
    return { role: target.role, requestStatus: null };
  }

  switch (target.selectedRole) {
    case Role.STUDENT: {
      // 역할이 아직 비어 있을 때만 쓴다(CAS). 같은 순간 관리자가 이 계정에 역할을
      // 붙였다면 그쪽이 이긴다 — 관리자의 결정을 가입 절차가 덮어쓸 이유는 없다.
      const promoted = await transaction.user.updateMany({
        where: { id: target.id, role: null },
        data: { role: Role.STUDENT },
      });
      return promoted.count === 1
        ? { role: Role.STUDENT, requestStatus: null }
        : NOTHING_CONFIRMED;
    }
    case Role.STAFF: {
      // 사용자당 PENDING은 하나뿐이다(마이그레이션의 partial unique). 이미 있으면
      // 그것이 이 사람의 신청이므로 다시 만들지 않는다.
      const pending = await transaction.roleRequest.findFirst({
        where: { userId: target.id, status: RoleRequestStatus.PENDING },
      });
      if (pending) {
        return { role: null, requestStatus: pending.status };
      }
      const created = await transaction.roleRequest.create({
        data: { userId: target.id },
      });
      return { role: null, requestStatus: created.status };
    }
    // 고른 것이 없으면(null) 확정할 것도 없다. ADMIN은 역할 선택 화면에 없는 값이라
    // `selectedRole`에 들어오지 않지만, 들어오더라도 가입 절차가 관리자를 만들지는 않는다.
    case Role.ADMIN:
    case null:
      return NOTHING_CONFIRMED;
  }
}
