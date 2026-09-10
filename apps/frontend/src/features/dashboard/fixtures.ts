import type { StudentDashboard } from './types';

/**
 * 모든 값은 합성이다. 특히 `teamName`은 실제 운영 팀 이름을 옮겨 오지 않는다 —
 * 픽스처는 공개 저장소와 PR 본문에 그대로 실린다.
 */
export const dashboardFixture: StudentDashboard = {
  items: [
    {
      applicationId: 'application-solo-team',
      programId: 'program-capstone',
      programName: '캡스톤 2026',
      // 혼자 참여해도 팀이다. 화면이 이 항목만 "개인"으로 갈라 그리면 같은 자리에
      // 두 가지 정체성이 생긴다(#1269).
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
      // 판정 전이라 목적지는 신청서 화면이다. 예전 값(`/programs/program-oss-contest`)은
      // 계약상 불가능한 조합이었다 — 서버가 만들 수 없고 검증기가 버리는 항목이라,
      // 이 픽스처로 그린 화면은 실제로는 존재할 수 없는 화면이었다.
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
      // 반려 사유를 그리는 화면은 신청서 화면 하나뿐이다(#733).
      detailUrl: '/programs/program-rejected/apply',
      checklistUrl: '/programs/program-rejected/submissions',
      repository: null,
    },
  ],
};
