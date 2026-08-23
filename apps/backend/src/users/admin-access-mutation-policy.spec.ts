import { AccountStatus } from '@prisma/client';
import { RolesErrorCode } from '../roles/roles-error-code.enum';
import { enforceAdminAccessGuards } from './admin-access-mutation-policy';
import { accessUser, adminActor } from './admin-access.service.spec-support';
import type { AdminAccessMutationCommand } from './domain/admin-access';

/**
 * 자기 승격 가드는 **현재 호출 순서에서 도달 불가능한 백스톱**이다(근거는
 * `admin-access-mutation-policy.ts`의 `grantsAdminToSelf` 주석).
 *
 * 그래서 서비스를 통과시켜 검사하지 않는다 — 그러려면 인메모리 대역이 실제 저장소가
 * 만들 수 없는 상태(actor는 ADMIN인데 같은 행인 대상은 STAFF)를 꾸며 내야 하고, 그건
 * 가드가 아니라 대역의 빈틈을 시험하는 것이 된다. 순수 함수를 직접 부른다.
 */
const ALLOW_ALL = {
  requiresCompleteProfile: false,
  requiresSelfDeactivationGuard: false,
  requiresLastActiveAdminGuard: false,
} as const;

function promoteToAdmin(): AdminAccessMutationCommand {
  return {
    expectedRole: 'STAFF',
    desiredRole: 'ADMIN',
    expectedAccountStatus: AccountStatus.ACTIVE,
    desiredAccountStatus: AccountStatus.ACTIVE,
    expectedPendingRequest: null,
  };
}

describe('enforceAdminAccessGuards — 자기 승격 백스톱', () => {
  it('actor와 대상이 같은 행이고 ADMIN을 부여하는 전이면 ROL_004로 막는다', () => {
    // Given — 잠금·재조회 순서가 무너져 대상 행이 잠기지 않은 채 읽힌 상황을 직접 만든다.
    const actor = adminActor();
    const before = accessUser({ id: actor.id, role: 'STAFF' });

    // When
    let thrown: unknown;
    try {
      enforceAdminAccessGuards(actor, before, promoteToAdmin(), ALLOW_ALL, 2);
    } catch (error: unknown) {
      thrown = error;
    }

    // Then
    expect(thrown).toMatchObject({
      errorCode: { code: RolesErrorCode.ADMIN_ONLY, status: 403 },
    });
  });

  it('대상이 다른 행이면 ADMIN 부여를 막지 않는다', () => {
    // Given — 관리자 임명 자체를 막아 버리면 운영이 멈춘다.
    const actor = adminActor();
    const before = accessUser({ id: 'someone-else', role: 'STAFF' });

    // When / Then
    expect(() =>
      enforceAdminAccessGuards(actor, before, promoteToAdmin(), ALLOW_ALL, 2),
    ).not.toThrow();
  });

  it('같은 행이어도 이미 ADMIN이면 막지 않는다 — 이게 실제 저장소가 만드는 상태다', () => {
    // Given — 잠금 뒤 재조회를 거치면 actor==대상일 때 대상은 반드시 ADMIN이다.
    const actor = adminActor();
    const before = accessUser({ id: actor.id, role: 'ADMIN' });

    // When / Then
    expect(() =>
      enforceAdminAccessGuards(actor, before, promoteToAdmin(), ALLOW_ALL, 2),
    ).not.toThrow();
  });
});
