import type { StudentDashboard } from './types';

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
