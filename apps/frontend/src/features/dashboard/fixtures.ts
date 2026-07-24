import type { StudentDashboard } from './types';

export const dashboardFixture: StudentDashboard = {
  items: [
    {
      applicationId: 'application-personal',
      programId: 'program-capstone',
      programName: '캡스톤 2026',
      applicationMode: 'PERSONAL',
      displayName: '홍길동',
      applicationStatus: 'APPROVED',
      nextMilestone: {
        id: 'milestones-upcoming',
        name: '중간 보고',
        dueAt: '2026-07-26T23:59:59+09:00',
        submissionStatus: 'NOT_SUBMITTED',
      },
      detailUrl: '/programs/program-capstone',
      checklistUrl: '/programs/program-capstone/submissions',
    },
    {
      applicationId: 'application-team',
      programId: 'program-oss-contest',
      programName: 'OSS 경진대회',
      applicationMode: 'TEAM',
      displayName: '오픈소스팀',
      applicationStatus: 'APPROVED',
      nextMilestone: {
        id: 'milestones-overdue',
        name: '예선 결과물',
        dueAt: '2026-07-20T23:59:59+09:00',
        submissionStatus: 'CHANGES_REQUESTED',
      },
      detailUrl: '/programs/program-oss-contest',
      checklistUrl: '/programs/program-oss-contest/submissions',
    },
  ],
};

export const pendingDashboardFixture: StudentDashboard = {
  items: [
    {
      applicationId: 'application-pending',
      programId: 'program-oss-contest',
      programName: 'OSS 경진대회',
      applicationMode: 'TEAM',
      displayName: '오픈소스팀',
      applicationStatus: 'SUBMITTED',
      nextMilestone: null,
      detailUrl: '/programs/program-oss-contest',
      checklistUrl: '/programs/program-oss-contest/submissions',
    },
  ],
};

export const completedDashboardFixture: StudentDashboard = {
  items: [
    {
      applicationId: 'application-approved',
      programId: 'program-study',
      programName: '오픈소스 스터디',
      applicationMode: 'PERSONAL',
      displayName: '홍길동',
      applicationStatus: 'APPROVED',
      nextMilestone: null,
      detailUrl: '/programs/program-study',
      checklistUrl: '/programs/program-study/submissions',
    },
  ],
};

export const rejectedDashboardFixture: StudentDashboard = {
  items: [
    {
      applicationId: 'application-rejected',
      programId: 'program-rejected',
      programName: '기여 캠프',
      applicationMode: 'PERSONAL',
      displayName: '홍길동',
      applicationStatus: 'REJECTED',
      nextMilestone: null,
      detailUrl: '/programs/program-rejected',
      checklistUrl: '/programs/program-rejected/submissions',
    },
  ],
};
