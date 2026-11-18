import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getStaffDashboardSummary } from './api';
import { StaffDashboardResponseError } from './staff-dashboard-parser';

const apiClient = vi.fn<(...args: unknown[]) => Promise<unknown>>();

vi.mock('@/lib/api-client', () => ({
  ApiError: class ApiError extends Error {
    problem: { readonly status: number };

    constructor(status = 500) {
      super('api error');
      this.problem = { status };
    }
  },
  apiClient: (...args: unknown[]) => apiClient(...args),
}));

const validResponse = {
  page: 1,
  pageSize: 20,
  total: 1,
  catalogTotal: 1,
  statusSummary: { recruiting: 1, inProgress: 0, ended: 0 },
  programs: [
    {
      id: 'program:basic',
      name: '기본 프로그램',
      trackType: 'EXTRACURRICULAR',
      applicationPeriod: {
        startsAt: '2026-07-01T00:00:00.000Z',
        endsAt: '2026-07-31T23:59:59.000Z',
      },
      endAt: '9999-12-31T23:59:59.999Z',
      applications: {
        total: 1,
        pendingApproval: 1,
        approved: 0,
        rejected: 0,
      },
      activity: {
        repositories: 0,
        commits: 0,
        pullRequests: 0,
        releases: 0,
        lastActivityAt: null,
        dataAsOf: null,
      },
      submissions: {
        milestones: 0,
        total: 0,
        notSubmitted: 0,
        submitted: 0,
        approved: 0,
        changesRequested: 0,
        rejected: 0,
      },
    },
  ],
};

describe('getStaffDashboardSummary', () => {
  beforeEach(() => {
    apiClient.mockReset();
  });

  it('운영 대시보드 엔드포인트 응답을 런타임 검증한다', async () => {
    apiClient.mockResolvedValue(validResponse);
    await expect(
      getStaffDashboardSummary({ search: '', status: 'all' as const, page: 1 }),
    ).resolves.toEqual(validResponse);
    expect(apiClient).toHaveBeenCalledWith('dashboard/staff/summary?page=1');
  });

  it('검색어·상태·페이지를 쿼리로 보낸다', async () => {
    apiClient.mockResolvedValue(validResponse);
    await getStaffDashboardSummary({
      search: '캡스톤',
      status: 'ended',
      page: 3,
    });
    expect(apiClient).toHaveBeenCalledWith(
      'dashboard/staff/summary?page=3&search=%EC%BA%A1%EC%8A%A4%ED%86%A4&status=ended',
    );
  });

  it('이전 서버가 게시 상태 PUBLISHED를 실어 보내도 응답을 그대로 읽는다', async () => {
    const response = {
      ...validResponse,
      programs: [{ ...validResponse.programs[0], lifecycle: 'PUBLISHED' }],
    };
    apiClient.mockResolvedValue(response);

    await expect(
      getStaffDashboardSummary({ search: '', status: 'all' as const, page: 1 }),
    ).resolves.toEqual(response);
  });

  it.each([
    { endAt: null },
    { endAt: 'invalid-date' },
    { name: '' },
    { applications: { total: -1 } },
  ])('잘못된 필드는 거부한다: %s', async (invalid) => {
    const program = { ...validResponse.programs[0], ...invalid };
    apiClient.mockResolvedValue({ ...validResponse, programs: [program] });

    await expect(
      getStaffDashboardSummary({ search: '', status: 'all' as const, page: 1 }),
    ).rejects.toBeInstanceOf(StaffDashboardResponseError);
  });

  it('페이지 정보가 없는 응답을 거부한다', async () => {
    apiClient.mockResolvedValue({ programs: validResponse.programs });
    await expect(
      getStaffDashboardSummary({ search: '', status: 'all' as const, page: 1 }),
    ).rejects.toBeInstanceOf(StaffDashboardResponseError);
  });
});
