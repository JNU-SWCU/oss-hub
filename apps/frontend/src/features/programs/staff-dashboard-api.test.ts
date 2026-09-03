import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getStaffDashboardSummary } from './api';
import { StaffDashboardResponseError } from './staff-dashboard-parser';

const apiClient = vi.fn();

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
  programs: [
    {
      id: 'program:basic',
      name: '기본 프로그램',
      trackType: 'EXTRACURRICULAR',
      applicationPeriod: {
        startsAt: '2026-07-01T00:00:00.000Z',
        endsAt: '2026-07-31T23:59:59.000Z',
      },
      applications: {
        total: 1,
        submitted: 1,
        pendingApproval: 1,
        approved: 0,
        rejected: 0,
      },
      applicantsPath: '/programs/program%3Abasic/applicants',
      activity: {
        repositories: 0,
        commits: 0,
        pullRequests: 0,
        releases: 0,
        lastActivityAt: null,
        dataAsOf: null,
      },
      submissions: {
        approvedApplications: 0,
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
    await expect(getStaffDashboardSummary()).resolves.toEqual(validResponse);
    expect(apiClient).toHaveBeenCalledWith('dashboard/staff/summary');
  });

  it('잘못된 운영 대시보드 응답을 거부한다', async () => {
    apiClient.mockResolvedValue({
      programs: [
        {
          ...validResponse.programs[0],
          applicantsPath: '/programs/program:basic/applicants',
        },
      ],
    });
    await expect(getStaffDashboardSummary()).rejects.toBeInstanceOf(
      StaffDashboardResponseError,
    );
  });
});
