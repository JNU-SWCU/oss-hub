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
import { type StaffDashboardComposedProgramSummary } from '../../src/staff/staff-dashboard.service';
import {
  type StaffInsightsMetrics,
  type StaffInsightsSummary,
} from '../../src/staff/staff-insights.service';
import {
  type AdminAccessFacets,
  type AdminAccessUser,
  type AdminAccessUserDetail,
  type AdminAccessUserHistory,
} from '../../src/users/admin-access-read-ordering.repository';

const at = (iso: string): Date => new Date(iso);

const facets: AdminAccessFacets = {
  pendingRequests: { pending: 2 },
};

const user: AdminAccessUser = {
  id: 'user-1',
  githubLogin: 'octo',
  name: 'Octo Cat',
  role: 'STUDENT',
  memberKind: 'STUDENT',
  hasStaffAccess: false,
  hasAdminAccess: false,
  approvalStatus: 'PENDING',
  approvalRequestId: 'request-1',
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
  participations: [
    {
      programId: 'program-1',
      programName: 'Program A',
      teamName: 'Team A',
      isLeader: true,
    },
  ],
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
  milestones: [],
  id: 'program-1',
  name: 'Program A',
  coverId: 'cover-1',
  coverExternalImageUrl: null,
  coverImageUrl: '/programs/program-1/cover/cover-1',
  trackType: 'EXTRACURRICULAR',
  applicationPeriod: {
    startsAt: at('2026-01-01T00:00:00.000Z'),
    endsAt: at('2026-01-31T00:00:00.000Z'),
  },
  endAt: at('2026-06-30T00:00:00.000Z'),
  applications: {
    total: 10,
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
  total: 138,
  participantCount: 7,
};

const insights: StaffInsightsSummary = {
  scope: { kind: 'calendar', year: 2026 },
  dataAsOf: at('2026-05-01T00:00:00.000Z'),
  years: [2026, 2025],
  cohorts: [{ ...metrics, cohort: 'sw-major' }],
  departments: [
    {
      ...metrics,
      department: 'Computer Science',
      major: null,
      cohort: 'sw-major',
      activityPerStudent: 13.8,
      recentPerStudent: null,
      sampleTooSmall: false,
    },
  ],
  programs: [
    {
      programId: 'program-1',
      name: 'Program A',
      category: 'CAPSTONE',
      startAt: at('2026-03-02T00:00:00.000Z'),
      endAt: at('2026-06-30T00:00:00.000Z'),
      recruiting: false,
      swMajorCount: 3,
      nonSwCount: 2,
      unregisteredCount: 1,
      participantCount: 6,
      appliedCount: 5,
      approvedCount: 2,
      competitionRatio: 2.5,
      dueRequirementCount: 4,
      submittedRequirementCount: 3,
      completionRate: 75,
      activeTeamCount: 1,
      repoTeamCount: 2,
      contributionsPerParticipant: 6.7,
    },
  ],
  programSummary: {
    programCount: 1,
    recruitingCount: 0,
    approvedParticipantCount: 6,
    uniqueParticipantCount: 6,
    competitionRatio: 2.5,
    repeatParticipantCount: 0,
    repeatParticipantRate: 0,
  },
  leaders: {
    period: { all: [], swMajor: [], nonSw: [] },
    recent: { all: [], swMajor: [], nonSw: [] },
  },
  attentionStudents: [],
  firstContributionCount: null,
  recentWindow: {
    from: at('2026-04-01T00:00:00.000Z'),
    to: at('2026-05-01T00:00:00.000Z'),
  },
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
        approvalStatus: 'NOT_REQUIRED',
        approvalRequestId: null,
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
        page: 1,
        pageSize: 20,
        total: 1,
        catalogTotal: 1,
        statusSummary: { recruiting: 0, inProgress: 0, ended: 0 },
        programs: [
          program,
          {
            ...program,
            id: 'program-2',
            coverId: null,
            coverExternalImageUrl: 'https://images.example/cover.png',
            coverImageUrl: 'https://images.example/cover.png',
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
