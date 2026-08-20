import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiClient } from '@/lib/api-client';
import {
  AdminAccessResponseError,
  fetchAdminAccessDetail,
  fetchAdminAccessFacets,
  fetchAdminAccessHistory,
  fetchAdminAccessList,
  fetchAdminAccessRequests,
  parseAdminAccessConflictProjection,
  parseAdminAccessDetail,
  parseAdminAccessHistory,
  parseAdminAccessListPage,
  parseAdminAccessMutationResponse,
  patchAdminAccess,
  serializeAdminAccessListQuery,
} from './admin-access-api';

vi.mock('@/lib/api-client', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/api-client')>(
      '@/lib/api-client',
    );
  return { ...actual, apiClient: vi.fn() };
});

const facets = () => ({
  roles: { unassigned: 0, student: 1, staff: 0, admin: 1 },
  accountStatuses: { active: 2, deactivated: 0 },
  pendingRequests: { none: 2, pending: 0 },
});

const listItem = () => ({
  id: 'target',
  githubLogin: 'synthetic-target',
  name: '합성 사용자',
  role: 'STUDENT',
  accountStatus: 'ACTIVE',
  isSelf: false,
  isProfileComplete: true,
  pendingRequest: null,
  lastLoginAt: null,
});

describe('관리자 접근 통합 API 클라이언트', () => {
  beforeEach(() => {
    vi.mocked(apiClient).mockReset();
  });

  describe('쿼리 직렬화', () => {
    it('정렬 방향이 asc일 때 정확한 query string을 만든다', () => {
      expect(
        serializeAdminAccessListQuery({
          query: '한글 사용자',
          role: 'STAFF',
          accountStatus: 'ACTIVE',
          pendingRequest: 'PENDING',
          sort: 'lastLoginAt',
          direction: 'asc',
          page: 2,
          limit: 10,
        }),
      ).toBe(
        'query=%ED%95%9C%EA%B8%80+%EC%82%AC%EC%9A%A9%EC%9E%90&role=STAFF&accountStatus=ACTIVE&pendingRequest=PENDING&sort=lastLoginAt&direction=asc&page=2&limit=10',
      );
    });

    it('정렬 방향이 desc일 때 정확한 query string을 만든다', () => {
      expect(
        serializeAdminAccessListQuery({ sort: 'createdAt', direction: 'desc' }),
      ).toBe('sort=createdAt&direction=desc');
    });

    it('지정하지 않은 sort/direction/page/limit/필터는 기본값을 프론트가 강제하지 않고 생략한다', () => {
      expect(serializeAdminAccessListQuery({})).toBe('');
    });
  });

  describe('list/facets/detail/history GET 어댑터', () => {
    it('목록 조회는 users/access에 직렬화된 query를 붙인다', async () => {
      vi.mocked(apiClient).mockResolvedValue({
        items: [listItem()],
        page: 1,
        limit: 20,
        total: 1,
        facets: facets(),
      });

      await fetchAdminAccessList({ sort: 'name', direction: 'asc', page: 1 });

      expect(apiClient).toHaveBeenCalledWith(
        'users/access?sort=name&direction=asc&page=1',
        undefined,
      );
    });

    it('가입 신청 목록은 users/access/requests를 호출하고 pendingRequest를 빼낸다', async () => {
      vi.mocked(apiClient).mockResolvedValue({
        items: [listItem()],
        page: 1,
        limit: 20,
        total: 1,
        facets: facets(),
      });

      await fetchAdminAccessRequests({
        sort: 'createdAt',
        direction: 'desc',
        page: 1,
        pendingRequest: 'PENDING',
      });

      expect(apiClient).toHaveBeenCalledWith(
        'users/access/requests?sort=createdAt&direction=desc&page=1',
        undefined,
      );
    });

    it('쿼리가 없으면 users/access를 그대로 호출한다', async () => {
      vi.mocked(apiClient).mockResolvedValue({
        items: [],
        page: 1,
        limit: 20,
        total: 0,
        facets: facets(),
      });

      await fetchAdminAccessList({});

      expect(apiClient).toHaveBeenCalledWith('users/access', undefined);
    });

    it('facets 조회는 users/access/facets에 같은 필터 query를 붙인다', async () => {
      vi.mocked(apiClient).mockResolvedValue(facets());

      await fetchAdminAccessFacets({ role: 'ADMIN' });

      expect(apiClient).toHaveBeenCalledWith(
        'users/access/facets?role=ADMIN',
        undefined,
      );
    });

    it('상세 조회는 대상 ID를 인코딩해 users/:id/access를 호출한다', async () => {
      vi.mocked(apiClient).mockResolvedValue({
        ...listItem(),
        profile: {
          name: '합성 사용자',
          studentId: '123456',
          department: '소프트웨어공학과',
          isComplete: true,
        },
      });

      await fetchAdminAccessDetail('synthetic:user');

      expect(apiClient).toHaveBeenCalledWith(
        'users/synthetic%3Auser/access',
        undefined,
      );
    });

    it('이력 조회는 인코딩된 ID와 4개 페이지네이션 파라미터를 붙인다', async () => {
      vi.mocked(apiClient).mockResolvedValue({
        roleRequests: { items: [], page: 1, limit: 20, total: 0 },
        loginHistory: { items: [], page: 1, limit: 20, total: 0 },
      });

      await fetchAdminAccessHistory('synthetic:user', {
        roleRequestPage: 2,
        roleRequestLimit: 5,
        loginPage: 3,
        loginLimit: 7,
      });

      expect(apiClient).toHaveBeenCalledWith(
        'users/synthetic%3Auser/access/history?roleRequestPage=2&roleRequestLimit=5&loginPage=3&loginLimit=7',
        undefined,
      );
    });
  });

  describe('PATCH CAS 요청', () => {
    it('기대 상태와 요청 결정을 포함한 CAS body를 그대로 전송한다', async () => {
      vi.mocked(apiClient).mockResolvedValue({
        id: 'target',
        role: 'STAFF',
        accountStatus: 'ACTIVE',
        pendingRequest: null,
        decidedRequest: { id: 'request-1', status: 'APPROVED' },
      });

      await patchAdminAccess('synthetic:user', {
        expectedRole: null,
        desiredRole: 'STAFF',
        expectedAccountStatus: 'ACTIVE',
        desiredAccountStatus: 'ACTIVE',
        expectedPendingRequest: { id: 'request-1', status: 'PENDING' },
        requestDecision: { decision: 'APPROVE' },
      });

      expect(apiClient).toHaveBeenCalledWith('users/synthetic%3Auser/access', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedRole: null,
          desiredRole: 'STAFF',
          expectedAccountStatus: 'ACTIVE',
          desiredAccountStatus: 'ACTIVE',
          expectedPendingRequest: { id: 'request-1', status: 'PENDING' },
          requestDecision: { decision: 'APPROVE' },
        }),
      });
    });

    it('null CAS 필드는 생략되지 않고 명시적으로 전송된다', async () => {
      vi.mocked(apiClient).mockResolvedValue({
        id: 'target',
        role: null,
        accountStatus: 'DEACTIVATED',
        pendingRequest: null,
        decidedRequest: null,
      });

      await patchAdminAccess('target', {
        expectedRole: 'STUDENT',
        desiredRole: null,
        expectedAccountStatus: 'ACTIVE',
        desiredAccountStatus: 'DEACTIVATED',
        expectedPendingRequest: null,
      });

      const body = JSON.parse(
        vi.mocked(apiClient).mock.calls[0][1]?.body as string,
      );
      expect(body).toEqual({
        expectedRole: 'STUDENT',
        desiredRole: null,
        expectedAccountStatus: 'ACTIVE',
        desiredAccountStatus: 'DEACTIVATED',
        expectedPendingRequest: null,
      });
      expect('requestDecision' in body).toBe(false);
    });
  });

  describe('응답 가드 — 정상 형태를 수용한다', () => {
    it('목록 페이지', () => {
      const page = parseAdminAccessListPage({
        items: [listItem()],
        page: 1,
        limit: 20,
        total: 1,
        facets: facets(),
      });
      expect(page.items).toHaveLength(1);
      expect(page.total).toBe(1);
    });

    it('상세', () => {
      const detail = parseAdminAccessDetail({
        ...listItem(),
        profile: {
          name: '합성 사용자',
          studentId: null,
          department: null,
          isComplete: false,
        },
      });
      expect(detail.profile.isComplete).toBe(false);
    });

    it('이력', () => {
      const history = parseAdminAccessHistory({
        roleRequests: {
          items: [
            {
              id: 'req-1',
              status: 'APPROVED',
              rejectionReason: null,
              decidedAt: '2026-07-31T00:00:00.000Z',
              decidedBy: 'synthetic-admin',
              createdAt: '2026-07-30T00:00:00.000Z',
            },
          ],
          page: 1,
          limit: 20,
          total: 1,
        },
        loginHistory: {
          items: [
            {
              id: 'login-1',
              event: 'LOGIN',
              provider: 'github',
              success: true,
              loginAt: '2026-07-31T00:00:00.000Z',
            },
          ],
          page: 1,
          limit: 20,
          total: 1,
        },
      });
      expect(history.roleRequests.items[0].status).toBe('APPROVED');
      expect(history.loginHistory.items[0].event).toBe('LOGIN');
    });

    it('mutation 응답', () => {
      const result = parseAdminAccessMutationResponse({
        id: 'target',
        role: 'ADMIN',
        accountStatus: 'ACTIVE',
        pendingRequest: null,
        decidedRequest: null,
      });
      expect(result.role).toBe('ADMIN');
    });
  });

  describe('응답 가드 — 잘못된 형태를 거부한다', () => {
    it('목록 페이지에 facets가 없으면 던진다', () => {
      expect(() =>
        parseAdminAccessListPage({
          items: [listItem()],
          page: 1,
          limit: 20,
          total: 1,
        }),
      ).toThrow(AdminAccessResponseError);
    });

    it('목록 항목의 accountStatus가 허용값이 아니면 던진다', () => {
      expect(() =>
        parseAdminAccessListPage({
          items: [{ ...listItem(), accountStatus: 'SUSPENDED' }],
          page: 1,
          limit: 20,
          total: 1,
          facets: facets(),
        }),
      ).toThrow(AdminAccessResponseError);
    });

    it('상세 응답에 profile이 없으면 던진다', () => {
      expect(() => parseAdminAccessDetail(listItem())).toThrow(
        AdminAccessResponseError,
      );
    });

    it('이력 응답의 로그인 이벤트가 허용값이 아니면 던진다', () => {
      expect(() =>
        parseAdminAccessHistory({
          roleRequests: { items: [], page: 1, limit: 20, total: 0 },
          loginHistory: {
            items: [
              {
                id: 'login-1',
                event: 'PASSWORD_RESET',
                provider: 'github',
                success: true,
                loginAt: '2026-07-31T00:00:00.000Z',
              },
            ],
            page: 1,
            limit: 20,
            total: 1,
          },
        }),
      ).toThrow(AdminAccessResponseError);
    });

    it('mutation 응답에 id가 없으면 던진다', () => {
      expect(() =>
        parseAdminAccessMutationResponse({
          role: 'ADMIN',
          accountStatus: 'ACTIVE',
          pendingRequest: null,
          decidedRequest: null,
        }),
      ).toThrow(AdminAccessResponseError);
    });
  });

  describe('409 CAS 충돌의 authoritative projection 파싱', () => {
    const conflictProblem = {
      type: 'about:blank',
      title: 'CONFLICT',
      status: 409,
      detail: '사용자 접근 상태가 조회 당시와 달라졌습니다.',
      instance: '/users/target/access',
      code: 'ROL_013',
      currentAccess: {
        id: 'target',
        role: 'STAFF',
        accountStatus: 'ACTIVE',
        pendingRequest: null,
      },
    };

    it('정상 currentAccess를 타입이 부여된 projection으로 반환한다', () => {
      const projection = parseAdminAccessConflictProjection(
        new ApiError(conflictProblem),
      );
      expect(projection).toEqual({
        id: 'target',
        role: 'STAFF',
        accountStatus: 'ACTIVE',
        pendingRequest: null,
      });
    });

    it('409가 아니거나 ApiError가 아니면 null을 반환해 재던지기를 허용한다', () => {
      const notConflict = { ...conflictProblem, status: 400, code: 'SYS_003' };
      expect(
        parseAdminAccessConflictProjection(new ApiError(notConflict)),
      ).toBeNull();
      expect(parseAdminAccessConflictProjection(new Error('other'))).toBeNull();
    });

    it('currentAccess가 손상되어 있으면 던진다', () => {
      const malformed = {
        ...conflictProblem,
        currentAccess: { id: 'target' },
      };
      expect(() =>
        parseAdminAccessConflictProjection(new ApiError(malformed)),
      ).toThrow(AdminAccessResponseError);
    });

    it('currentAccess가 아예 없으면 던진다', () => {
      const { currentAccess: _drop, ...withoutCurrentAccess } = conflictProblem;
      expect(() =>
        parseAdminAccessConflictProjection(new ApiError(withoutCurrentAccess)),
      ).toThrow(AdminAccessResponseError);
    });
  });
});
