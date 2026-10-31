import {
  AccessRequestsFacetsResponseDto,
  AccessRequestsUserDetailResponseDto,
  AccessRequestsUserHistoryResponseDto,
  AccessRequestsUserPageResponseDto,
  AccessRequestsUserResponseDto,
} from '../../src/staff/dto/access-requests-user-page-response.dto';
import {
  StaffDashboardActivitySummaryResponseDto,
  StaffDashboardApplicationCountsResponseDto,
  StaffDashboardProgramSummaryResponseDto,
  StaffDashboardSubmissionSummaryResponseDto,
  StaffDashboardSummaryResponseDto,
} from '../../src/staff/dto/staff-dashboard-summary-response.dto';
import {
  StaffInsightsCohortResponseDto,
  StaffInsightsDepartmentResponseDto,
  StaffInsightsProgramResponseDto,
  StaffInsightsResponseDto,
  StaffInsightsScopeResponseDto,
} from '../../src/staff/dto/staff-insights-response.dto';
import type {
  StaffDashboardComposedProgramSummary,
  StaffInsightsMetrics,
  StaffInsightsSummary,
} from '../../src/staff/staff.types';
import type {
  AdminAccessFacets,
  AdminAccessUser,
  AdminAccessUserDetail,
  AdminAccessUserHistory,
} from '../../src/users/admin-access.types';

const at = (iso: string): Date => new Date(iso);

const facets: AdminAccessFacets = {
  roles: { unassigned: 1, student: 2, staff: 3, admin: 4 },
  accountStatuses: { active: 9, deactivated: 1 },
  pendingRequests: { none: 8, pending: 2 },
};

const user: AdminAccessUser = {
  id: 'user-1',
  githubLogin: 'octo',
  name: 'Octo Cat',
  role: 'STUDENT',
  accountStatus: 'ACTIVE',
  isSelf: false,
  isProfileComplete: true,
  createdAt: at('2026-01-02T03:04:05.000Z'),
  pendingRequest: {
    id: 'request-1',
    status: 'PENDING',
    createdAt: at('2026-02-03T04:05:06.000Z'),
  },
  lastLoginAt: at('2026-03-04T05:06:07.000Z'),
};

const detail: AdminAccessUserDetail = {
  ...user,
  memberKind: 'STUDENT',
  hasStaffAccess: false,
  hasAdminAccess: false,
  profile: {
    name: 'Octo Cat',
    studentId: '2026000001',
    staffNumber: null,
    department: 'Computer Science',
    isComplete: true,
  },
};

const history: AdminAccessUserHistory = {
  staffAccessRequests: {
    items: [
      {
        id: 'request-1',
        status: 'REJECTED',
        rejectionReason: 'No',
        decidedAt: at('2026-02-04T00:00:00.000Z'),
        decidedBy: 'admin',
        createdAt: at('2026-02-03T00:00:00.000Z'),
      },
      {
        id: 'request-2',
        status: 'PENDING',
        rejectionReason: null,
        decidedAt: null,
        decidedBy: null,
        createdAt: at('2026-02-05T00:00:00.000Z'),
      },
    ],
    page: 1,
    limit: 10,
    total: 2,
  },
  loginHistory: {
    items: [
      {
        id: 'login-1',
        event: 'LOGIN',
        provider: 'github',
        success: true,
        loginAt: at('2026-03-01T00:00:00.000Z'),
      },
    ],
    page: 1,
    limit: 10,
    total: 1,
  },
};

const program: StaffDashboardComposedProgramSummary = {
  id: 'program-1',
  name: 'Program A',
  coverId: 'cover-1',
  coverExternalImageUrl: null,
  trackType: 'EXTRACURRICULAR',
  applicationPeriod: {
    startsAt: at('2026-01-01T00:00:00.000Z'),
    endsAt: at('2026-01-31T00:00:00.000Z'),
  },
  endAt: at('2026-06-30T00:00:00.000Z'),
  lifecycle: 'PUBLISHED',
  teamManagementPath: '/programs/program-1/teams',
  applications: {
    total: 10,
    submitted: 4,
    pendingApproval: 4,
    approved: 5,
    rejected: 1,
  },
  activity: {
    repositories: 3,
    commits: 40,
    pullRequests: 12,
    releases: 2,
    lastActivityAt: '2026-05-01T00:00:00.000Z',
    dataAsOf: null,
  },
  submissions: {
    approvedApplications: 5,
    milestones: 2,
    total: 10,
    notSubmitted: 3,
    submitted: 2,
    approved: 3,
    changesRequested: 1,
    rejected: 1,
  },
};

const metrics: StaffInsightsMetrics = {
  studentCount: 10,
  activeStudentCount: 8,
  commitCount: 100,
  pullRequestCount: 20,
  issueCount: 5,
  repositoryCount: 4,
  starCount: 9,
  total: 138,
  participantCount: 7,
};

const insights: StaffInsightsSummary = {
  scope: { kind: 'calendar', year: 2026 },
  dataAsOf: at('2026-05-01T00:00:00.000Z'),
  years: [2026, 2025],
  cohorts: [{ ...metrics, cohort: 'sw-major' }],
  departments: [
    { ...metrics, department: 'Computer Science', cohort: 'sw-major' },
  ],
  programs: [
    {
      programId: 'program-1',
      name: 'Program A',
      swMajorCount: 3,
      nonSwCount: 2,
      unregisteredCount: 1,
      participantCount: 6,
    },
  ],
};

const cases: ReadonlyArray<readonly [string, () => unknown]> = [
  [
    'AccessRequestsUserHistoryResponseDto',
    () => AccessRequestsUserHistoryResponseDto.from(history),
  ],
  [
    'AccessRequestsUserResponseDto',
    () => AccessRequestsUserResponseDto.from(user),
  ],
  [
    'AccessRequestsUserResponseDto nulls',
    () =>
      AccessRequestsUserResponseDto.from({
        ...user,
        name: null,
        role: null,
        pendingRequest: null,
        lastLoginAt: null,
      }),
  ],
  [
    'AccessRequestsFacetsResponseDto',
    () => AccessRequestsFacetsResponseDto.from(facets),
  ],
  [
    'AccessRequestsUserPageResponseDto',
    () =>
      AccessRequestsUserPageResponseDto.from({
        items: [user],
        page: 1,
        limit: 20,
        total: 1,
        facets,
      }),
  ],
  [
    'AccessRequestsUserDetailResponseDto',
    () => AccessRequestsUserDetailResponseDto.from(detail),
  ],
  [
    'StaffDashboardApplicationCountsResponseDto',
    () => StaffDashboardApplicationCountsResponseDto.from(program.applications),
  ],
  [
    'StaffDashboardActivitySummaryResponseDto',
    () => StaffDashboardActivitySummaryResponseDto.from(program.activity),
  ],
  [
    'StaffDashboardSubmissionSummaryResponseDto',
    () => StaffDashboardSubmissionSummaryResponseDto.from(program.submissions),
  ],
  [
    'StaffDashboardProgramSummaryResponseDto',
    () => StaffDashboardProgramSummaryResponseDto.from(program),
  ],
  [
    'StaffDashboardSummaryResponseDto',
    () =>
      StaffDashboardSummaryResponseDto.from({
        programs: [
          program,
          {
            ...program,
            id: 'program-2',
            coverId: null,
            coverExternalImageUrl: 'https://images.example/cover.png',
            trackType: null,
          },
        ],
      }),
  ],
  [
    'StaffInsightsScopeResponseDto all',
    () => StaffInsightsScopeResponseDto.from({ kind: 'all' }),
  ],
  [
    'StaffInsightsScopeResponseDto calendar',
    () => StaffInsightsScopeResponseDto.from({ kind: 'calendar', year: 2026 }),
  ],
  [
    'StaffInsightsCohortResponseDto',
    () => StaffInsightsCohortResponseDto.from(insights.cohorts[0]!),
  ],
  [
    'StaffInsightsDepartmentResponseDto',
    () => StaffInsightsDepartmentResponseDto.from(insights.departments[0]!),
  ],
  [
    'StaffInsightsProgramResponseDto',
    () => StaffInsightsProgramResponseDto.from(insights.programs[0]!),
  ],
  ['StaffInsightsResponseDto', () => StaffInsightsResponseDto.from(insights)],
  [
    'StaffInsightsResponseDto all scope',
    () =>
      StaffInsightsResponseDto.from({
        ...insights,
        scope: { kind: 'all' },
        dataAsOf: null,
      }),
  ],
];

describe('staff response DTO JSON', () => {
  it.each(cases)('%s', (_name, build) => {
    expect(JSON.stringify(build())).toMatchSnapshot();
  });
});
