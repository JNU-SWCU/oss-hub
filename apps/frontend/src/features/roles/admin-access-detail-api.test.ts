import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiClient } from '@/lib/api-client';

import type { AdminAccessDetail } from './admin-access-api';
import {
  ADMIN_ACCESS_DETAIL_HISTORY_LIMIT,
  AdminAccessDetailLoadError,
  AdminAccessDetailNotFoundError,
  deriveAdminAccessEligibility,
  isAdminAccessHistoryTruncated,
  loadAdminAccessDetail,
} from './admin-access-detail-api';

vi.mock('@/lib/api-client', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/api-client')>(
      '@/lib/api-client',
    );
  return { ...actual, apiClient: vi.fn() };
});

function detail(overrides: Partial<AdminAccessDetail> = {}): AdminAccessDetail {
  return {
    id: 'target',
    githubLogin: 'synthetic-target',
    name: '합성 사용자',
    role: 'STUDENT',
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

function historyPage() {
  return { items: [], page: 1, limit: 20, total: 0 };
}

describe('deriveAdminAccessEligibility — 계정 상태·프로필 완료 여부에서 자격/차단 사유를 계산한다', () => {
  it('활성 계정이고 프로필이 완료되면 자격이 있다', () => {
    expect(deriveAdminAccessEligibility(detail())).toEqual({
      eligible: true,
      blockedReason: null,
    });
  });

  it('계정이 비활성화되면 프로필 완료 여부와 무관하게 차단하고 사유를 우선한다', () => {
    expect(
      deriveAdminAccessEligibility(
        detail({ accountStatus: 'DEACTIVATED', isProfileComplete: false }),
      ),
    ).toEqual({
      eligible: false,
      blockedReason: '계정이 비활성화되어 있습니다.',
    });
  });

  it('활성 계정이지만 프로필이 미완료면 프로필 사유로 차단한다', () => {
    expect(
      deriveAdminAccessEligibility(
        detail({
          profile: {
            name: null,
            studentId: null,
            department: null,
            isComplete: false,
          },
        }),
      ),
    ).toEqual({
      eligible: false,
      blockedReason: '프로필이 완료되지 않았습니다.',
    });
  });
});

describe('isAdminAccessHistoryTruncated — total이 표시된 items보다 많으면 잘린 것으로 본다', () => {
  it('total과 items 길이가 같으면 잘리지 않았다', () => {
    expect(isAdminAccessHistoryTruncated({ items: [1, 2], total: 2 })).toBe(
      false,
    );
  });

  it('total이 items 길이보다 크면 잘렸다', () => {
    expect(isAdminAccessHistoryTruncated({ items: [1, 2], total: 5 })).toBe(
      true,
    );
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
        `users/target/access/history?roleRequestPage=1&roleRequestLimit=${ADMIN_ACCESS_DETAIL_HISTORY_LIMIT}&loginPage=1&loginLimit=${ADMIN_ACCESS_DETAIL_HISTORY_LIMIT}`
      ) {
        return { roleRequests: historyPage(), loginHistory: historyPage() };
      }
      throw new Error(`unexpected path: ${path}`);
    });

    const result = await loadAdminAccessDetail('target');

    expect(result.detail.id).toBe('target');
    expect(result.history.roleRequests).toEqual(historyPage());
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
