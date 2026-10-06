import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiClient } from '@/lib/api-client';
import {
  fetchCanonicalAdminAccessDetail,
  parseCanonicalAdminAccessDetail,
  patchAdminAuthority,
  patchMemberKind,
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
      staffNumber: null,
      department: '인공지능학부',
      isComplete: true,
    },
    ...overrides,
  };
}

describe('Task 8 independent authority API', () => {
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

  it('rejects a canonical detail response with a malformed staff number', () => {
    expect(() =>
      parseCanonicalAdminAccessDetail(
        detail({
          profile: {
            ...detail().profile,
            staffNumber: 42,
          },
        }),
      ),
    ).toThrow('관리자 접근 API 응답 형식이 올바르지 않습니다.');
  });

  it('rejects a canonical detail response that omits staff number', () => {
    const { staffNumber: _staffNumber, ...profile } = detail().profile;
    expect(() => parseCanonicalAdminAccessDetail(detail({ profile }))).toThrow(
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

  it('patches member kind with explicit canonical fields', async () => {
    vi.mocked(apiClient).mockResolvedValue({
      id: 'target',
      role: 'ADMIN',
      memberKind: 'STAFF',
      hasStaffAccess: true,
      hasAdminAccess: true,
    });
    const request = {
      memberKind: 'STAFF',
      expectedMemberKind: 'STUDENT',
      expectedHasStaffAccess: false,
      studentId: '202601',
      department: '인공지능학부',
      staffNumber: 'staff-42',
    } as const;
    await expect(
      patchMemberKind('target:user', request),
    ).resolves.toMatchObject({ hasStaffAccess: true, hasAdminAccess: true });
    expect(apiClient).toHaveBeenCalledWith('users/target%3Auser/member-kind', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
  });

  it.each([['GRANT_ADMIN_ACCESS', true] as const])(
    'grant %s does not imply the other authority',
    async (command, admin) => {
      vi.mocked(apiClient).mockResolvedValue({
        id: 'target',
        role: admin ? 'ADMIN' : 'STAFF',
        memberKind: 'STUDENT',
        hasStaffAccess: !admin,
        hasAdminAccess: admin,
      });
      const result = await patchAdminAuthority('target', command);
      expect(result).toMatchObject({
        hasStaffAccess: !admin,
        hasAdminAccess: admin,
      });
    },
  );

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

  it('admin authority 409 conflicts are not swallowed', async () => {
    const conflict = new ApiError({
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
      detail: '접근 상태가 변경되었습니다.',
      instance: '/users/target/admin-access',
      code: 'ROL_013',
    });
    vi.mocked(apiClient).mockRejectedValue(conflict);
    await expect(
      patchAdminAuthority('target', 'REVOKE_ADMIN_ACCESS'),
    ).rejects.toBe(conflict);
  });
});
