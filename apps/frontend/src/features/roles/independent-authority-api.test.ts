import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiClient } from '@/lib/api-client';
import {
  fetchCanonicalAdminAccessDetail,
  parseCanonicalAdminAccessDetail,
  patchAdminAuthority,
  patchStaffAccess,
} from './independent-authority-api';

vi.mock('@/lib/api-client', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/api-client')>(
      '@/lib/api-client',
    );
  return { ...actual, apiClient: vi.fn() };
});

function detail(overrides: Record<string, unknown> = {}) {
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
    createdAt: '2026-09-01T00:00:00.000Z',
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

describe('Task 8 independent authority API', () => {
  // 화살표가 모의 함수를 돌려주면 vitest 가 그것을 정리 함수로 여겨 테스트 뒤에
  // 한 번 더 부른다 — 거절하도록 세운 테스트에서는 그 호출이 처리되지 않은 거절이 된다.
  beforeEach(() => {
    vi.mocked(apiClient).mockReset();
  });

  it.each([
    ['student-admin', 'STUDENT', false, true],
    ['staff-only', 'STAFF', true, false],
    ['staff-admin', 'STAFF', true, true],
    ['admin-only', null, false, true],
  ] as const)(
    'requires canonical detail fields for %s',
    (_, memberKind, hasStaffAccess, hasAdminAccess) => {
      expect(
        parseCanonicalAdminAccessDetail(
          detail({ memberKind, hasStaffAccess, hasAdminAccess }),
        ),
      ).toMatchObject({ memberKind, hasStaffAccess, hasAdminAccess });
    },
  );

  it('rejects a detail response that omits required canonical fields', () => {
    const legacyOnly = Object.fromEntries(
      Object.entries(detail()).filter(([key]) => key !== 'memberKind'),
    );
    expect(() => parseCanonicalAdminAccessDetail(legacyOnly)).toThrow(
      '관리자 접근 API 응답 형식이 올바르지 않습니다.',
    );
  });

  it('loads required canonical detail fields from the exact GET route', async () => {
    vi.mocked(apiClient).mockResolvedValue(detail({ hasAdminAccess: true }));
    await expect(
      fetchCanonicalAdminAccessDetail('target:user'),
    ).resolves.toMatchObject({
      memberKind: 'STUDENT',
      hasStaffAccess: false,
      hasAdminAccess: true,
    });
    expect(apiClient).toHaveBeenCalledWith(
      'users/target%3Auser/access',
      undefined,
    );
  });

  it('revoking staff from staff-admin leaves admin access', async () => {
    vi.mocked(apiClient).mockResolvedValue({
      id: 'target',
      role: 'ADMIN',
      memberKind: 'STAFF',
      hasStaffAccess: false,
      hasAdminAccess: true,
    });
    await expect(
      patchStaffAccess('target', 'REVOKE_STAFF_ACCESS'),
    ).resolves.toMatchObject({ hasStaffAccess: false, hasAdminAccess: true });
    expect(apiClient).toHaveBeenCalledWith('users/target/staff-access', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'REVOKE_STAFF_ACCESS' }),
    });
  });

  it('revoking admin from staff-admin leaves staff access', async () => {
    vi.mocked(apiClient).mockResolvedValue({
      id: 'target',
      role: 'STAFF',
      memberKind: 'STAFF',
      hasStaffAccess: true,
      hasAdminAccess: false,
    });
    await expect(
      patchAdminAuthority('target', 'REVOKE_ADMIN_ACCESS'),
    ).resolves.toMatchObject({ hasStaffAccess: true, hasAdminAccess: false });
    expect(apiClient).toHaveBeenCalledWith('users/target/admin-access', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'REVOKE_ADMIN_ACCESS' }),
    });
  });

  it.each([
    ['GRANT_STAFF_ACCESS', false] as const,
    ['GRANT_ADMIN_ACCESS', true] as const,
  ])('grant %s does not imply the other authority', async (command, admin) => {
    vi.mocked(apiClient).mockResolvedValue({
      id: 'target',
      role: admin ? 'ADMIN' : 'STAFF',
      memberKind: 'STUDENT',
      hasStaffAccess: !admin,
      hasAdminAccess: admin,
    });
    const result = admin
      ? await patchAdminAuthority('target', command)
      : await patchStaffAccess('target', command);
    expect(result).toMatchObject({
      hasStaffAccess: !admin,
      hasAdminAccess: admin,
    });
  });

  // 관리자만 가진 계정(memberKind 없음)의 부여 응답을 다섯 칸 그대로 읽는다.
  // 같은 상태 명령은 #1411 부터 서버가 409 로 거절하므로 이 응답은 실제 변경 뒤의 것이다.
  it('parses an admin-only grant response exactly', async () => {
    vi.mocked(apiClient).mockResolvedValue({
      id: 'target',
      role: 'ADMIN',
      memberKind: null,
      hasStaffAccess: false,
      hasAdminAccess: true,
    });
    await expect(
      patchAdminAuthority('target', 'GRANT_ADMIN_ACCESS'),
    ).resolves.toEqual({
      id: 'target',
      role: 'ADMIN',
      memberKind: null,
      hasStaffAccess: false,
      hasAdminAccess: true,
    });
  });

  // 이슈 1411 — 같은 상태 명령은 서버가 409 로 거절한다.
  it('같은 상태 명령의 409 충돌은 삼키지 않고 그대로 던진다', async () => {
    const conflict = new ApiError({
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
      detail: '접근 상태가 변경되었습니다.',
      instance: '/users/target/staff-access',
      code: 'ROL_013',
    });
    vi.mocked(apiClient).mockRejectedValue(conflict);
    await expect(
      patchStaffAccess('target', 'REVOKE_STAFF_ACCESS'),
    ).rejects.toBe(conflict);
  });
});
