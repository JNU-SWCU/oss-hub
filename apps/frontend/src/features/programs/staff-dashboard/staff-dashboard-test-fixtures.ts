import { PROGRAM_END_AT_UNDECIDED } from '../authoring/program-end-at';
import type {
  StaffDashboardProgramSummary,
  StaffDashboardSummary,
} from './dto';

export const staffDashboardNow = new Date('2026-07-20T00:00:00.000Z');

const midtermReport = {
  name: '중간 보고',
  startAt: '2026-08-01T00:00:00.000Z',
  dueAt: '2026-08-20T00:00:00.000Z',
};

const finalReport = {
  name: '최종 보고',
  startAt: '2026-08-21T00:00:00.000Z',
  dueAt: '2026-09-04T00:00:00.000Z',
};

export function staffDashboardProgram(
  overrides: Partial<StaffDashboardProgramSummary>,
): StaffDashboardProgramSummary {
  const id = overrides.id ?? 'program:basic';
  return {
    id,
    name: '기본 프로그램',
    trackType: 'EXTRACURRICULAR',
    applicationPeriod: {
      startsAt: '2026-07-01T00:00:00.000Z',
      endsAt: '2026-07-31T23:59:59.000Z',
    },
    endAt: PROGRAM_END_AT_UNDECIDED,
    applications: {
      total: 3,
      pendingApproval: 1,
      approved: 1,
      rejected: 1,
    },
    activity: {
      repositories: 1,
      commits: 2,
      pullRequests: 3,
      releases: 4,
      lastActivityAt: '2026-07-19T09:00:00.000Z',
      dataAsOf: '2026-07-19T10:00:00.000Z',
    },
    submissions: {
      milestones: 2,
      total: 2,
      notSubmitted: 0,
      submitted: 1,
      approved: 1,
      changesRequested: 0,
      rejected: 0,
    },
    milestones: [
      {
        ...midtermReport,
        id: `${id}:midterm`,
        submittedTeams: 1,
        totalTeams: 1,
      },
      {
        ...finalReport,
        id: `${id}:final`,
        submittedTeams: 1,
        totalTeams: 1,
      },
    ],
    ...overrides,
  };
}

export function staffDashboardSummaryOf(
  programs: readonly StaffDashboardProgramSummary[],
  overrides: Partial<StaffDashboardSummary> = {},
): StaffDashboardSummary {
  return {
    programs,
    page: 1,
    pageSize: 20,
    total: programs.length,
    catalogTotal: programs.length,
    statusSummary: { recruiting: 0, inProgress: 0, ended: 0 },
    ...overrides,
  };
}

export const staffDashboardSummary: StaffDashboardSummary =
  staffDashboardSummaryOf([
    staffDashboardProgram({ id: 'program:basic', name: '기본 프로그램' }),
    staffDashboardProgram({
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
        pendingApproval: 0,
        approved: 0,
        rejected: 0,
      },
      submissions: {
        milestones: 1,
        total: 0,
        notSubmitted: 0,
        submitted: 0,
        approved: 0,
        changesRequested: 0,
        rejected: 0,
      },
      milestones: [
        {
          ...midtermReport,
          id: 'program:empty-activity:midterm',
          submittedTeams: 0,
          totalTeams: 0,
        },
        {
          ...finalReport,
          id: 'program:empty-activity:final',
          submittedTeams: null,
          totalTeams: null,
        },
      ],
    }),
    staffDashboardProgram({
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
        milestones: 2,
        total: 2,
        notSubmitted: 2,
        submitted: 0,
        approved: 0,
        changesRequested: 0,
        rejected: 0,
      },
      milestones: [
        {
          ...midtermReport,
          id: 'program:stale:midterm',
          submittedTeams: 0,
          totalTeams: 1,
        },
        {
          ...finalReport,
          id: 'program:stale:final',
          submittedTeams: 0,
          totalTeams: 1,
        },
      ],
    }),
    staffDashboardProgram({
      id: 'program:no-milestone',
      name: '마일스톤 없음 프로그램',
      submissions: {
        milestones: 0,
        total: 0,
        notSubmitted: 0,
        submitted: 0,
        approved: 0,
        changesRequested: 0,
        rejected: 0,
      },
      milestones: [],
    }),
  ]);
