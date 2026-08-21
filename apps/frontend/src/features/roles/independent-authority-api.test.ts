import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api-client';
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
  beforeEach(() => vi.mocked(apiClient).mockReset());

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

  it('preserves a same-state grant response idempotently', async () => {
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
});
