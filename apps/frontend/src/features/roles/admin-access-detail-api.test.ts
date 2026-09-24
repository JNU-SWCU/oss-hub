import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiClient } from '@/lib/api-client';

import type { CanonicalAdminAccessDetail } from './independent-authority-api';
import {
  ADMIN_ACCESS_DETAIL_HISTORY_LIMIT,
  AdminAccessDetailLoadError,
  AdminAccessDetailNotFoundError,
  adminAccessHistoryPageCount,
  deriveAdminAccessGuards,
  formatAdminAccessDateTime,
  loadAdminAccessDetail,
} from './admin-access-detail-api';

vi.mock('@/lib/api-client', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/api-client')>(
      '@/lib/api-client',
    );
  return { ...actual, apiClient: vi.fn() };
});

function detail(
  overrides: Partial<CanonicalAdminAccessDetail> = {},
): CanonicalAdminAccessDetail {
  return {
    id: 'target',
    githubLogin: 'synthetic-target',
    name: '합성 사용자',
    role: 'STUDENT',
    memberKind: 'STUDENT',
    hasStaffAccess: false,
    hasAdminAccess: false,
    accountStatus: 'ACTIVE',
    isSelf: false,
    isProfileComplete: true,
    createdAt: '2026-07-29T00:00:00.000Z',
    pendingRequest: null,
    lastLoginAt: null,
    profile: {
      name: '합성 사용자',
      studentId: '202601',
      department: '인공지능학부',
      isComplete: true,
    },
    ...overrides,
  };
}

function historyPage() {
  return { items: [], page: 1, limit: 20, total: 0 };
}

describe('deriveAdminAccessGuards — 대기 요청·본인 여부·프로필 완료·계정 상태에서 읽기 전용으로 가드를 계산한다', () => {
  it('아무 조건도 걸리지 않으면 다섯 가드 모두 null이다', () => {
    expect(deriveAdminAccessGuards(detail())).toEqual({
      controlBlockedReason: null,
      approvalBlockedReason: null,
      deactivationBlockedReason: null,
      adminRevokeBlockedReason: null,
      elevatedRoleBlockedReason: null,
    });
  });

  it('비활성 계정이면 승인만 막힌다', () => {
    const guards = deriveAdminAccessGuards(
      detail({ accountStatus: 'DEACTIVATED' }),
    );
    expect(guards.approvalBlockedReason).toBe(
      '비활성 계정은 승인할 수 없습니다. 계정이 다시 활성화된 뒤에 처리할 수 있습니다.',
    );
    expect(guards.controlBlockedReason).toBeNull();
    expect(guards.deactivationBlockedReason).toBeNull();
    expect(guards.elevatedRoleBlockedReason).toBeNull();
  });

  it('활성 계정이면 승인 가드가 켜지지 않는다', () => {
    expect(
      deriveAdminAccessGuards(detail({ accountStatus: 'ACTIVE' }))
        .approvalBlockedReason,
    ).toBeNull();
  });

  it('대기 중인 요청이 있으면 전체 컨트롤이 막힌다', () => {
    const guards = deriveAdminAccessGuards(
      detail({
        pendingRequest: {
          id: 'req-1',
          status: 'PENDING',
          createdAt: '2026-07-30T00:00:00.000Z',
        },
      }),
    );
    expect(guards.controlBlockedReason).toBe(
      '대기 중인 요청을 먼저 처리해 주세요.',
    );
  });

  it('본인 계정이면 비활성화와 관리자 접근 회수가 함께 막힌다', () => {
    const guards = deriveAdminAccessGuards(detail({ isSelf: true }));
    expect(guards.deactivationBlockedReason).toBe(
      '자기 계정은 비활성화할 수 없습니다.',
    );
    // #1382 — 서버의 `ROL_022`와 같은 조건을 화면이 미리 말한다.
    expect(guards.adminRevokeBlockedReason).toBe(
      '자기 계정의 관리자 접근은 회수할 수 없습니다.',
    );
    expect(guards.controlBlockedReason).toBeNull();
    expect(guards.elevatedRoleBlockedReason).toBeNull();
  });

  it('남의 계정이면 관리자 접근 회수 가드는 켜지지 않는다', () => {
    expect(
      deriveAdminAccessGuards(detail({ isSelf: false, hasAdminAccess: true }))
        .adminRevokeBlockedReason,
    ).toBeNull();
  });

  it('프로필이 미완료면 교직원·관리자 부여만 막힌다', () => {
    const guards = deriveAdminAccessGuards(
      detail({
        profile: {
          name: null,
          studentId: null,
          department: null,
          isComplete: false,
        },
      }),
    );
    expect(guards.elevatedRoleBlockedReason).toBe(
      '프로필(이름·학번·학과) 완성 전에는 부여할 수 없습니다.',
    );
    expect(guards.controlBlockedReason).toBeNull();
    expect(guards.deactivationBlockedReason).toBeNull();
    expect(guards.adminRevokeBlockedReason).toBeNull();
  });

  it('세 조건이 동시에 성립하면 계정 상태를 제외한 네 가드가 함께 켜진다', () => {
    const guards = deriveAdminAccessGuards(
      detail({
        isSelf: true,
        pendingRequest: {
          id: 'req-1',
          status: 'PENDING',
          createdAt: '2026-07-30T00:00:00.000Z',
        },
        profile: {
          name: null,
          studentId: null,
          department: null,
          isComplete: false,
        },
      }),
    );
    expect(guards.controlBlockedReason).not.toBeNull();
    expect(guards.deactivationBlockedReason).not.toBeNull();
    expect(guards.adminRevokeBlockedReason).not.toBeNull();
    expect(guards.elevatedRoleBlockedReason).not.toBeNull();
  });
});

describe('adminAccessHistoryPageCount — total/limit에서 페이지 수를 계산한다', () => {
  it('total이 limit으로 나누어떨어지면 그 몫이 페이지 수다', () => {
    expect(adminAccessHistoryPageCount({ limit: 20, total: 40 })).toBe(2);
  });

  it('나누어떨어지지 않으면 올림한다', () => {
    expect(adminAccessHistoryPageCount({ limit: 20, total: 25 })).toBe(2);
    expect(adminAccessHistoryPageCount({ limit: 20, total: 21 })).toBe(2);
  });

  it('total이 0이어도 최소 1페이지로 본다', () => {
    expect(adminAccessHistoryPageCount({ limit: 20, total: 0 })).toBe(1);
  });

  it('total이 limit보다 작으면 1페이지다', () => {
    expect(adminAccessHistoryPageCount({ limit: 20, total: 5 })).toBe(1);
  });
});

describe('formatAdminAccessDateTime — ko-KR 날짜·시간 형식으로 표시한다', () => {
  it('ISO 문자열을 로케일 형식 문자열로 바꾼다(연·월 정보 보존)', () => {
    const formatted = formatAdminAccessDateTime('2026-07-30T01:00:00.000Z');
    expect(formatted).toContain('2026');
    expect(formatted).toContain('7');
  });
});

describe('loadAdminAccessDetail — 상세·이력 병렬 조회와 404 판별', () => {
  beforeEach(() => {
    vi.mocked(apiClient).mockReset();
  });

  it('상세·요청 이력·로그인 이력을 병렬로 조회하고 첫 페이지·기본 한도만 요청한다', async () => {
    vi.mocked(apiClient).mockImplementation(async (path: string) => {
      if (path === 'users/target/access') return detail();
      if (
        path ===
        `users/target/access/history?staffAccessRequestPage=1&staffAccessRequestLimit=${ADMIN_ACCESS_DETAIL_HISTORY_LIMIT}&loginPage=1&loginLimit=${ADMIN_ACCESS_DETAIL_HISTORY_LIMIT}`
      ) {
        return {
          staffAccessRequests: historyPage(),
          loginHistory: historyPage(),
        };
      }
      throw new Error(`unexpected path: ${path}`);
    });

    const result = await loadAdminAccessDetail('target');

    expect(result.detail.id).toBe('target');
    expect(result.history.staffAccessRequests).toEqual(historyPage());
    expect(result.history.loginHistory).toEqual(historyPage());
  });

  it('404(ROL_010) 응답은 AdminAccessDetailNotFoundError로 수렴한다', async () => {
    vi.mocked(apiClient).mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'Not Found',
        status: 404,
        detail: '사용자를 찾을 수 없습니다.',
        instance: '/users/unknown/access',
        code: 'ROL_010',
      }),
    );

    await expect(loadAdminAccessDetail('unknown')).rejects.toBeInstanceOf(
      AdminAccessDetailNotFoundError,
    );
  });

  it('404가 아닌 실패는 AdminAccessDetailLoadError로 수렴한다', async () => {
    vi.mocked(apiClient).mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'Server Error',
        status: 500,
        detail: '서버 오류',
        instance: '/users/target/access',
        code: 'SYS_001',
      }),
    );

    await expect(loadAdminAccessDetail('target')).rejects.toBeInstanceOf(
      AdminAccessDetailLoadError,
    );
  });

  it('400(INVALID_USER_ID)처럼 404가 아닌 사용자 오류도 not-found로 보지 않는다', async () => {
    vi.mocked(apiClient).mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'Bad Request',
        status: 400,
        detail: '올바르지 않은 사용자 ID입니다.',
        instance: '/users/bad id/access',
        code: 'ROL_011',
      }),
    );

    await expect(loadAdminAccessDetail('bad id')).rejects.toBeInstanceOf(
      AdminAccessDetailLoadError,
    );
  });
});
