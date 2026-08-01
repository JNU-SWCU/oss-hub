import type {
  StaffDashboardProgramSummary,
  StaffDashboardSummary,
} from './types';

export const staffDashboardNow = new Date('2026-07-20T00:00:00.000Z');

function program(
  overrides: Partial<StaffDashboardProgramSummary>,
): StaffDashboardProgramSummary {
  const id = overrides.id ?? 'program:basic';
  return {
    id,
    name: '기본 프로그램',
    category: 'BASIC',
    applicationPeriod: {
      startsAt: '2026-07-01T00:00:00.000Z',
      endsAt: '2026-07-31T23:59:59.000Z',
    },
    applications: {
      total: 3,
      submitted: 1,
      pendingApproval: 1,
      approved: 1,
      rejected: 1,
    },
    applicantsPath: `/staff/programs/${encodeURIComponent(id)}/applicants`,
    activity: {
      repositories: 1,
      commits: 2,
      pullRequests: 3,
      releases: 4,
      lastActivityAt: '2026-07-19T09:00:00.000Z',
      dataAsOf: '2026-07-19T10:00:00.000Z',
    },
    submissions: {
      approvedApplications: 1,
      milestones: 2,
      total: 2,
      notSubmitted: 0,
      submitted: 1,
      approved: 1,
      changesRequested: 0,
      rejected: 0,
    },
    ...overrides,
  };
}

export const staffDashboardSummary: StaffDashboardSummary = {
  programs: [
    program({ id: 'program:basic', name: '기본 프로그램' }),
    program({
      id: 'program:empty-activity',
      name: '활동 없음 프로그램',
      activity: {
        repositories: 0,
        commits: 0,
        pullRequests: 0,
        releases: 0,
        lastActivityAt: null,
        dataAsOf: null,
      },
      applications: {
        total: 0,
        submitted: 0,
        pendingApproval: 0,
        approved: 0,
        rejected: 0,
      },
      submissions: {
        approvedApplications: 0,
        milestones: 2,
        total: 0,
        notSubmitted: 0,
        submitted: 0,
        approved: 0,
        changesRequested: 0,
        rejected: 0,
      },
    }),
    program({
      id: 'program:stale',
      name: '수집 대기 프로그램',
      activity: {
        repositories: 1,
        commits: 0,
        pullRequests: 0,
        releases: 0,
        lastActivityAt: null,
        dataAsOf: null,
      },
      submissions: {
        approvedApplications: 1,
        milestones: 2,
        total: 2,
        notSubmitted: 2,
        submitted: 0,
        approved: 0,
        changesRequested: 0,
        rejected: 0,
      },
    }),
    program({
      id: 'program:no-milestone',
      name: '마일스톤 없음 프로그램',
      submissions: {
        approvedApplications: 1,
        milestones: 0,
        total: 0,
        notSubmitted: 0,
        submitted: 0,
        approved: 0,
        changesRequested: 0,
        rejected: 0,
      },
    }),
  ],
};
