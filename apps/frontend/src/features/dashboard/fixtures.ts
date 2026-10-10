import type {
  DashboardApplicationStatus,
  DashboardFeedbackItem,
  DashboardItem,
  DashboardMilestone,
  DashboardSubmissionStatus,
  StudentDashboard,
} from './types';

export function dashboardMilestone(
  dueAt: string,
  submissionStatus: DashboardSubmissionStatus = 'NOT_SUBMITTED',
): DashboardMilestone {
  return {
    id: `milestone-${dueAt}`,
    name: `합성 마일스톤 ${dueAt}`,
    dueAt,
    submissionStatus,
  };
}

export function dashboardItem(
  key: string,
  applicationStatus: DashboardApplicationStatus,
  nextMilestone: DashboardMilestone | null = null,
): DashboardItem {
  const programPath = `/programs/program-${key}`;
  const approved = applicationStatus === 'APPROVED';
  return {
    applicationId: `application-${key}`,
    programId: `program-${key}`,
    programName: `합성 프로그램 ${key}`,
    teamName: `합성 팀 ${key}`,
    teamUrl: `${programPath}/my-team`,
    applicationStatus,
    nextMilestone,
    detailUrl: approved ? programPath : `${programPath}/apply`,
    checklistUrl: `${programPath}/submissions`,
    repository: approved
      ? {
          repositoryName: null,
          provisionStatus: 'NOT_STARTED',
          invitationStatus: null,
          githubUrl: null,
        }
      : null,
  };
}

export function dashboardFeedback(
  item: DashboardItem,
  key: string,
  overrides: Partial<DashboardFeedbackItem> = {},
): DashboardFeedbackItem {
  return {
    ...feedbackItemFixture,
    id: `review-${item.applicationId}-${key}`,
    applicationId: item.applicationId,
    programId: item.programId,
    itemName: `합성 서류 ${key}`,
    href: `/programs/${item.programId}/documents?milestoneId=${feedbackItemFixture.milestoneId}`,
    ...overrides,
  };
}

export const dashboardFixture: StudentDashboard = {
  items: [
    {
      applicationId: 'application-solo-team',
      programId: 'program-capstone',
      programName: '캡스톤 2026',

      teamName: '합성 1인 팀',
      teamUrl: '/programs/program-capstone/my-team',
      applicationStatus: 'APPROVED',
      nextMilestone: {
        id: 'milestones-upcoming',
        name: '중간 보고',
        dueAt: '2026-07-26T23:59:59+09:00',
        submissionStatus: 'NOT_SUBMITTED',
      },
      detailUrl: '/programs/program-capstone',
      checklistUrl: '/programs/program-capstone/submissions',
      repository: {
        repositoryName: 'synthetic-capstone-repo',
        provisionStatus: 'SUCCEEDED',
        invitationStatus: 'SUCCEEDED',
        githubUrl: 'https://github.com/JNU-SWCU/synthetic-capstone-repo',
      },
    },
    {
      applicationId: 'application-team',
      programId: 'program-oss-contest',
      programName: 'OSS 경진대회',
      teamName: '합성 오픈소스 팀',
      teamUrl: '/programs/program-oss-contest/my-team',
      applicationStatus: 'APPROVED',
      nextMilestone: {
        id: 'milestones-overdue',
        name: '예선 결과물',
        dueAt: '2026-07-20T23:59:59+09:00',
        submissionStatus: 'CHANGES_REQUESTED',
      },
      detailUrl: '/programs/program-oss-contest',
      checklistUrl: '/programs/program-oss-contest/submissions',
      repository: {
        repositoryName: null,
        provisionStatus: 'PROCESSING',
        invitationStatus: null,
        githubUrl: null,
      },
    },
  ],
};

export const pendingDashboardFixture: StudentDashboard = {
  items: [
    {
      applicationId: 'application-pending',
      programId: 'program-oss-contest',
      programName: 'OSS 경진대회',
      teamName: '합성 대기 팀',
      teamUrl: '/programs/program-oss-contest/my-team',
      applicationStatus: 'SUBMITTED',
      nextMilestone: null,

      detailUrl: '/programs/program-oss-contest/apply',
      checklistUrl: '/programs/program-oss-contest/submissions',
      repository: null,
    },
  ],
};

export const completedDashboardFixture: StudentDashboard = {
  items: [
    {
      applicationId: 'application-approved',
      programId: 'program-study',
      programName: '오픈소스 스터디',
      teamName: '합성 스터디 팀',
      teamUrl: '/programs/program-study/my-team',
      applicationStatus: 'APPROVED',
      nextMilestone: null,
      detailUrl: '/programs/program-study',
      checklistUrl: '/programs/program-study/submissions',
      repository: {
        repositoryName: null,
        provisionStatus: 'NOT_STARTED',
        invitationStatus: null,
        githubUrl: null,
      },
    },
  ],
};

export const rejectedDashboardFixture: StudentDashboard = {
  items: [
    {
      applicationId: 'application-rejected',
      programId: 'program-rejected',
      programName: '기여 캠프',
      teamName: '합성 반려 팀',
      teamUrl: '/programs/program-rejected/my-team',
      applicationStatus: 'REJECTED',
      nextMilestone: null,

      detailUrl: '/programs/program-rejected/apply',
      checklistUrl: '/programs/program-rejected/submissions',
      repository: null,
    },
  ],
};

export const feedbackItemFixture: DashboardFeedbackItem = {
  id: 'review-changes-requested',
  decision: 'CHANGES_REQUESTED',
  comment: '표지와 목차를 보완해 주세요.',
  reviewedAt: '2026-07-22T06:00:00.000Z',
  resubmissionDueAt: '2026-07-26T14:59:59.000Z',
  applicationId: 'application-solo-team',
  programId: 'program-capstone',
  milestoneId: 'milestones-upcoming',
  milestoneName: '중간 보고',
  itemName: '프로젝트 계획서',
  href: '/programs/program-capstone/documents?milestoneId=milestones-upcoming',
};
