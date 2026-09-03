import type { ProgramActivity, ProgramDetail } from '@/features/programs/types';
import type {
  SubmissionChecklist,
  SubmissionFormData,
} from '@/features/submissions/types';

type StudentJourneyResponseBody =
  | ProgramDetail
  | readonly ProgramActivity[]
  | SubmissionChecklist
  | SubmissionFormData;

const CAPSTONE_DETAIL = {
  id: 'program-capstone',
  name: '합성 캡스톤 2026',
  organizer: '합성 SW중심대학사업단',
  trackType: 'CURRICULAR',

  applicationTemplateKey: 'capstone',
  lifecycle: 'PUBLISHED',
  description:
    '학생이 팀 프로젝트를 오픈소스 저장소로 운영하고, 마일스톤별 산출물과 활동 기록을 제출하는 합성 검토용 프로그램입니다.',
  repositoryProvisioningEnabled: true,
  applicationPeriod: {
    startsAt: '2026-07-01T00:00:00.000+09:00',
    endsAt: '2026-07-15T23:59:59.000+09:00',
  },
  viewer: { role: 'STUDENT', applicationStatus: 'APPROVED' },
  milestones: [
    {
      id: 'milestones-approved',
      name: '기획서 제출',
      dueAt: '2026-07-15T23:59:59.000+09:00',
      dDay: -16,
      deadlineLabel: '마감 지남',
      description: '프로젝트 문제 정의와 초기 실행 계획을 제출합니다.',
      submissionType: 'FILE',
      submissionItemCount: 0,
      viewerSubmissionStatus: 'APPROVED',
      applicationSubmissionSummary: null,
    },
    {
      id: 'milestones-upcoming',
      name: '중간 보고',
      dueAt: '2026-07-26T23:59:59.000+09:00',
      dDay: -5,
      deadlineLabel: '마감 지남',
      description: '현재 구현 상태와 다음 스프린트 계획을 정리합니다.',
      submissionType: 'TEXT',
      submissionItemCount: 0,
      viewerSubmissionStatus: 'NOT_SUBMITTED',
      applicationSubmissionSummary: null,
    },
    {
      id: 'milestones-revision',
      name: '최종 결과 요약',
      dueAt: '2026-08-10T23:59:59.000+09:00',
      dDay: 10,
      deadlineLabel: 'D-10',
      description: '최종 결과와 변경 내역을 글로 정리합니다.',
      submissionType: 'TEXT',
      submissionItemCount: 0,
      viewerSubmissionStatus: 'CHANGES_REQUESTED',
      applicationSubmissionSummary: null,
    },
  ],
} as const satisfies ProgramDetail;

const CONTEST_DETAIL = {
  id: 'program-oss-contest',
  name: '합성 OSS 경진대회',
  organizer: '합성 SW중심대학사업단',
  trackType: 'EXTRACURRICULAR',

  applicationTemplateKey: 'oss-contest',
  lifecycle: 'PUBLISHED',
  description:
    '팀별 저장소에서 개발 과정을 기록하고 예선·본선 결과물을 제출하는 합성 검토용 경진대회입니다.',
  repositoryProvisioningEnabled: true,
  applicationPeriod: {
    startsAt: '2026-07-01T00:00:00.000+09:00',
    endsAt: '2026-07-10T23:59:59.000+09:00',
  },
  viewer: { role: 'STUDENT', applicationStatus: 'APPROVED' },
  milestones: [
    {
      id: 'milestones-overdue',
      name: '예선 결과물',
      dueAt: '2026-07-20T23:59:59.000+09:00',
      dDay: -11,
      deadlineLabel: '마감 지남',
      description: '예선 심사용 구현 결과와 실행 방법을 제출합니다.',
      submissionType: 'TEXT',
      submissionItemCount: 0,
      viewerSubmissionStatus: 'CHANGES_REQUESTED',
      applicationSubmissionSummary: null,
    },
    {
      id: 'milestones-contest-final',
      name: '본선 발표 자료',
      dueAt: '2026-08-08T23:59:59.000+09:00',
      dDay: 8,
      deadlineLabel: 'D-8',
      description: '시연 시나리오와 최종 발표 자료를 제출합니다.',
      submissionType: 'FILE',
      submissionItemCount: 0,
      viewerSubmissionStatus: 'NOT_SUBMITTED',
      applicationSubmissionSummary: null,
    },
  ],
} as const satisfies ProgramDetail;

const CAPSTONE_ACTIVITY = [
  {
    applicationId: 'application-personal',
    label: 'synthetic-student',
    commitCount: 18,
    pullRequestCount: 3,
    releaseCount: 1,
    dataAsOf: '2026-07-31T09:00:00.000+09:00',
    lastActivityAt: '2026-07-30T21:14:00.000+09:00',
  },
] as const satisfies readonly ProgramActivity[];

const CONTEST_ACTIVITY = [
  {
    applicationId: 'application-team',
    label: '오픈소스팀',
    commitCount: 27,
    pullRequestCount: 6,
    releaseCount: 2,
    dataAsOf: '2026-07-31T09:00:00.000+09:00',
    lastActivityAt: '2026-07-31T08:42:00.000+09:00',
  },
] as const satisfies readonly ProgramActivity[];

const CAPSTONE_CHECKLIST = {
  applicationId: 'application-personal',
  applicationMode: 'PERSONAL',
  items: [
    {
      milestoneId: 'milestones-approved',
      name: '기획서 제출',
      dueAt: '2026-07-15T23:59:59.000+09:00',
      submissionType: 'FILE',
      submission: {
        id: 'submission-approved',
        status: 'APPROVED',
        decision: 'APPROVED',
        currentRevision: 1,
        lastReviewedAt: '2026-07-16T10:30:00.000+09:00',
        reviewComment: '기획 범위가 명확합니다.',
        canResubmit: false,
        // 본문만 낸 제출이라 첨부는 없다.
        file: null,
      },
    },
    {
      milestoneId: 'milestones-upcoming',
      name: '중간 보고',
      dueAt: '2026-07-26T23:59:59.000+09:00',
      submissionType: 'TEXT',
      submission: null,
    },
    {
      milestoneId: 'milestones-revision',
      name: '최종 결과 요약',
      dueAt: '2026-08-10T23:59:59.000+09:00',
      submissionType: 'TEXT',
      submission: {
        id: 'submission-revision',
        status: 'CHANGES_REQUESTED',
        decision: 'CHANGES_REQUESTED',
        currentRevision: 1,
        lastReviewedAt: '2026-07-30T16:20:00.000+09:00',
        reviewComment: '실행 환경과 변경 내역을 추가해 주세요.',
        canResubmit: true,
        // 본문만 낸 제출이라 첨부는 없다.
        file: null,
      },
    },
  ],
} as const satisfies SubmissionChecklist;

const CONTEST_CHECKLIST = {
  applicationId: 'application-team',
  applicationMode: 'TEAM',
  items: [
    {
      milestoneId: 'milestones-overdue',
      name: '예선 결과물',
      dueAt: '2026-07-20T23:59:59.000+09:00',
      submissionType: 'TEXT',
      submission: {
        id: 'submission-contest-revision',
        status: 'CHANGES_REQUESTED',
        decision: 'CHANGES_REQUESTED',
        currentRevision: 2,
        lastReviewedAt: '2026-07-29T14:10:00.000+09:00',
        reviewComment: '재현 순서와 테스트 결과를 보완해 주세요.',
        canResubmit: true,
        // 본문만 낸 제출이라 첨부는 없다.
        file: null,
      },
    },
    {
      milestoneId: 'milestones-contest-final',
      name: '본선 발표 자료',
      dueAt: '2026-08-08T23:59:59.000+09:00',
      submissionType: 'FILE',
      submission: null,
    },
  ],
} as const satisfies SubmissionChecklist;

const CAPSTONE_SUBMISSION_FORM = {
  applicationId: 'application-personal',
  applicationMode: 'PERSONAL',
  milestone: {
    id: 'milestones-upcoming',
    name: '중간 보고',
    dueAt: '2026-07-26T23:59:59.000+09:00',
    dDay: -5,
    deadlineLabel: '마감 지남',
    submissionType: 'TEXT',
    instructions:
      '[로컬 검토용] 제출 화면의 안내와 차단 상태만 확인합니다. 실제 제출 데이터는 저장되지 않습니다.',
  },
  existingSubmission: null,
  canSubmit: false,
  blockedReason: 'MILESTONE_CLOSED',
} as const satisfies SubmissionFormData;

const CONTEST_SUBMISSION_FORM = {
  applicationId: 'application-team',
  applicationMode: 'TEAM',
  milestone: {
    id: 'milestones-contest-final',
    name: '본선 발표 자료',
    dueAt: '2026-08-08T23:59:59.000+09:00',
    dDay: 8,
    deadlineLabel: 'D-8',
    submissionType: 'FILE',
    instructions:
      '[로컬 검토용] 파일 제출 안내만 확인합니다. 로컬 검토 환경에서는 실제 업로드와 저장을 실행하지 않습니다.',
  },
  existingSubmission: null,
  canSubmit: true,
  blockedReason: null,
} as const satisfies SubmissionFormData;

export const STUDENT_JOURNEY_RESPONSES: Readonly<
  Record<string, StudentJourneyResponseBody>
> = {
  'programs/program-capstone/viewer': CAPSTONE_DETAIL,
  'programs/program-capstone/activity': CAPSTONE_ACTIVITY,
  'programs/program-capstone/submissions/me': CAPSTONE_CHECKLIST,
  'programs/program-capstone/milestones/milestones-upcoming/submission-form':
    CAPSTONE_SUBMISSION_FORM,
  'programs/program-oss-contest/viewer': CONTEST_DETAIL,
  'programs/program-oss-contest/activity': CONTEST_ACTIVITY,
  'programs/program-oss-contest/submissions/me': CONTEST_CHECKLIST,
  'programs/program-oss-contest/milestones/milestones-contest-final/submission-form':
    CONTEST_SUBMISSION_FORM,
};
