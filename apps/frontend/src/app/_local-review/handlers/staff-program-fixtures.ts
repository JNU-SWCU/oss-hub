import type {
  EditableMilestone,
  EditableProgram,
} from '@/features/programs/api';
import type {
  ApplicationListItem,
  RepositoryProvisioning,
} from '@/features/programs/types';
import type { ReviewContext } from '@/features/reviews/types';
import type { MatrixRow } from '@/features/submissions/types';

/**
 * 교직원 운영 동선의 합성 데이터.
 *
 * id 체계는 화면을 타고 이동하는 순서(대시보드 → 신청자 목록 → 신청 상세 →
 * 제출 현황 → 검토)를 그대로 이을 수 있게 한 곳에서 정의한다. 프로그램 id는
 * 공개 목록(`PUBLIC_PROGRAM_FIXTURES`)·교직원 대시보드(`STAFF_DASHBOARD_FIXTURE`)와
 * 같은 값을 쓰고, 신청 id는 매트릭스 행 id로, 제출 id는 검토 화면 경로로 그대로
 * 이어진다.
 *
 * 신청 건수는 `STAFF_DASHBOARD_FIXTURE`의 카드 집계와 맞춘다 — 카드에서 바로
 * 넘어오는 화면이라 숫자가 어긋나면 그 자체가 검토 노이즈가 된다.
 * (`program-oss-contest`는 대시보드 카드가 없어 집계 제약이 없다.)
 */

/** `submissionMatrixReviewUrl`(backend)와 같은 규칙으로 검토 화면 경로를 만든다. */
function reviewUrl(programId: string, submissionId: string): string {
  return `/programs/${programId}/submissions/${submissionId}/review`;
}

const PROVISIONING_SUCCEEDED = {
  enabled: true,
  jobStatus: 'SUCCEEDED',
  updatedAt: '2026-05-02T01:00:00.000Z',
  safeErrorClass: null,
} as const satisfies RepositoryProvisioning;

/**
 * 신청자 목록은 PENDING·PROCESSING·RETRYABLE_FAILED 행이 있으면 폴링을 건다.
 * 로컬 검토에서는 상태가 절대 바뀌지 않아 헛돌기만 하므로 종료 상태만 쓴다.
 */
const PROVISIONING_NOT_REQUESTED = {
  enabled: true,
  jobStatus: 'NOT_REQUESTED',
  updatedAt: '2026-04-25T01:00:00.000Z',
  safeErrorClass: null,
} as const satisfies RepositoryProvisioning;

const PROVISIONING_DISABLED = {
  enabled: false,
  jobStatus: 'DISABLED',
  updatedAt: '2026-04-25T01:00:00.000Z',
  safeErrorClass: null,
} as const satisfies RepositoryProvisioning;

// ── program-basic-study — 대시보드 카드: 전체 4 / 제출 1 / 승인 2 / 반려 1 ──

const BASIC_MILESTONES = [
  {
    id: 'milestone-basic-orientation',
    name: '합성 오리엔테이션 회고',
    dueAt: '2026-05-15T14:59:59.000Z',
    submissionType: 'TEXT',
    instructions:
      '[로컬 검토용] 합성 안내 문구입니다. 실제 제출물은 저장되지 않습니다.',
  },
  {
    id: 'milestone-basic-final',
    name: '합성 최종 실습 결과',
    dueAt: '2026-06-30T14:59:59.000Z',
    submissionType: 'TEXT',
    instructions: null,
  },
] as const satisfies readonly EditableMilestone[];

const BASIC_PROGRAM = {
  id: 'program-basic-study',
  name: '합성 기초 오픈소스 스터디',
  organizer: '합성 SW중심대학사업단',
  category: 'BASIC',
  applicationTemplateKey: 'basic',
  applicationTemplateVersion: 1,
  applicationCount: 4,
  // 신청 기간은 공개 목록 픽스처와 같은 값을 쓴다 — 같은 프로그램 레코드다.
  applicationStartAt: '2026-01-31T15:00:00.000Z',
  applicationEndAt: '2026-04-30T14:59:59.000Z',
  // 종료일은 신청 종료일과 모든 마일스톤 마감 이후여야 저장이 통과한다.
  endAt: '2026-07-31T14:59:59.000Z',
  repositoryProvisioningEnabled: true,
  description:
    '로컬 검토용 합성 프로그램입니다. 실제 모집이나 실제 참여자와 무관합니다.',
  teamMinSize: null,
  teamMaxSize: null,
  lifecycle: 'PUBLISHED',
  categoryLocked: {
    locked: true,
    byApplications: true,
    byTeams: false,
    applicationCount: 4,
    teamCount: 0,
  },
  milestones: BASIC_MILESTONES,
} as const satisfies EditableProgram;

const BASIC_APPLICATIONS = [
  {
    id: 'application-basic-approved',
    programId: 'program-basic-study',
    repositoryConnectionMode: 'NEW',
    repositoryUrl: null,
    status: 'APPROVED',
    rejectionReason: null,
    // 승인 후 저장소를 공개로 돌릴 예정인지. 신청자 목록의 상태 칸이 읽는다.
    isRepositoryPublicationPlanned: false,
    repositoryProvisioning: PROVISIONING_SUCCEEDED,
    // 저장소는 프로비저닝이 성공한 신청에만 있다. 공개 전환은 네 게이트를 전부 지나야
    // 하므로(저장소 준비·공개 예정·프로그램 종료·필수 마일스톤 승인) 진행 중에는 대부분 PRIVATE이다.
    repository: {
      url: 'https://github.com/JNU-SWCU/synthetic-repo-1',
      visibility: 'PUBLIC',
    },
    submittedAt: '2026-04-20T02:15:00.000Z',
    participation: 'INDIVIDUAL',
    applicant: {
      id: 'synthetic-user-11',
      name: '합성 학생 11',
      nickname: 'synthetic-student-11',
    },
    team: null,
    answers: {
      applicantName: '합성 학생 11',
      title: '합성 기초 스터디 참여 신청',
      summary:
        '로컬 검토용 합성 신청 내용입니다. 실제 제출물이나 계획이 아닙니다.',
    },
  },
  {
    // 네 게이트(저장소 준비·공개 예정·프로그램 종료·필수 마일스톤 승인)를 **전부**
    // 지나는 유일한 신청이다(#753). 이 자리가 없으면 하네스에서 저장소 공개 전환
    // 버튼을 누를 수 있는 화면이 하나도 없다 — 나머지는 저마다 한 게이트 이상 막혀
    // 있고, 그것이 각자의 확인 목적이라 그쪽을 열면 그 목적이 사라진다.
    id: 'application-basic-publishable',
    programId: 'program-basic-study',
    repositoryConnectionMode: 'NEW',
    repositoryUrl: null,
    status: 'APPROVED',
    rejectionReason: null,
    // 승인 후 저장소를 공개로 돌릴 예정인지. 신청자 목록의 상태 칸이 읽는다.
    isRepositoryPublicationPlanned: true,
    repositoryProvisioning: PROVISIONING_SUCCEEDED,
    // 아직 비공개다 — 공개 전환을 눌러 보는 것이 이 신청의 목적이라 PUBLIC이면 안 된다.
    // 주소·공개 범위는 이 신청의 검토 컨텍스트(`synthetic-repo-basic-02`)와 같은 값이다.
    repository: {
      url: 'https://github.com/JNU-SWCU/synthetic-basic-study-02',
      visibility: 'PRIVATE',
    },
    submittedAt: '2026-04-22T06:30:00.000Z',
    participation: 'INDIVIDUAL',
    applicant: {
      id: 'synthetic-user-14',
      name: '합성 학생 14',
      nickname: 'synthetic-student-14',
    },
    team: null,
    answers: {
      applicantName: '합성 학생 14',
      title: '합성 기초 스터디 참여 신청(공개 전환 확인용)',
      summary:
        '저장소 공개 전환을 실제로 눌러 보기 위한 합성 신청입니다. 실제 계획이 아닙니다.',
    },
  },
  {
    id: 'application-basic-submitted',
    programId: 'program-basic-study',
    repositoryConnectionMode: 'NEW',
    repositoryUrl: null,
    status: 'SUBMITTED',
    rejectionReason: null,
    // 승인 후 저장소를 공개로 돌릴 예정인지. 신청자 목록의 상태 칸이 읽는다.
    isRepositoryPublicationPlanned: false,
    repositoryProvisioning: PROVISIONING_NOT_REQUESTED,
    repository: null,
    submittedAt: '2026-04-27T05:40:00.000Z',
    participation: 'INDIVIDUAL',
    applicant: {
      id: 'synthetic-user-12',
      name: '합성 학생 12',
      nickname: 'synthetic-student-12',
    },
    team: null,
    answers: {
      applicantName: '합성 학생 12',
      title: '합성 기초 스터디 참여 신청(판정 대기)',
      summary: '승인·반려 판정 다이얼로그를 확인하기 위한 합성 신청입니다.',
    },
  },
  {
    id: 'application-basic-rejected',
    programId: 'program-basic-study',
    repositoryConnectionMode: 'NEW',
    repositoryUrl: null,
    status: 'REJECTED',
    rejectionReason: '합성 반려 사유입니다. 실제 판정이 아닙니다.',
    // 승인 후 저장소를 공개로 돌릴 예정인지. 신청자 목록의 상태 칸이 읽는다.
    isRepositoryPublicationPlanned: false,
    repositoryProvisioning: PROVISIONING_DISABLED,
    repository: null,
    submittedAt: '2026-04-18T23:05:00.000Z',
    participation: 'INDIVIDUAL',
    applicant: {
      id: 'synthetic-user-13',
      name: null,
      nickname: 'synthetic-student-13',
    },
    team: null,
    answers: {
      applicantName: '합성 학생 13',
      title: '합성 기초 스터디 참여 신청(반려됨)',
      summary: '반려 사유 표기를 확인하기 위한 합성 신청입니다.',
    },
  },
] as const satisfies readonly ApplicationListItem[];

/** 매트릭스 행은 승인된 Application만이다(#124 계약). */
const BASIC_MATRIX_ROWS = [
  {
    applicationId: 'application-basic-approved',
    applicationMode: 'PERSONAL',
    displayName: '합성 학생 11',
    githubLogins: ['synthetic-student-11'],
    cells: [
      {
        milestoneId: 'milestone-basic-orientation',
        submissionId: 'submission-basic-orientation',
        revision: 2,
        status: 'APPROVED',
        submittedAt: '2026-05-14T05:00:00.000Z',
        reviewUrl: reviewUrl(
          'program-basic-study',
          'submission-basic-orientation',
        ),
      },
      {
        milestoneId: 'milestone-basic-final',
        submissionId: 'submission-basic-final',
        revision: 1,
        status: 'SUBMITTED',
        submittedAt: '2026-06-29T09:30:00.000Z',
        reviewUrl: reviewUrl('program-basic-study', 'submission-basic-final'),
      },
    ],
  },
  {
    // 필수 마일스톤 게이트를 지나려면 이 프로그램의 마일스톤이 **전부** 승인이어야 한다
    // (백엔드 `requiredMilestonesApproved`는 전칭이다). 한 칸이라도 승인이 아니면
    // 검토 화면의 공개 전환 버튼이 다시 닫힌다.
    applicationId: 'application-basic-publishable',
    applicationMode: 'PERSONAL',
    displayName: '합성 학생 14',
    githubLogins: ['synthetic-student-14'],
    cells: [
      {
        milestoneId: 'milestone-basic-orientation',
        submissionId: 'submission-basic-publishable-orientation',
        revision: 1,
        status: 'APPROVED',
        submittedAt: '2026-05-12T04:00:00.000Z',
        reviewUrl: reviewUrl(
          'program-basic-study',
          'submission-basic-publishable-orientation',
        ),
      },
      {
        milestoneId: 'milestone-basic-final',
        submissionId: 'submission-basic-publishable-final',
        revision: 1,
        status: 'APPROVED',
        submittedAt: '2026-06-28T07:15:00.000Z',
        reviewUrl: reviewUrl(
          'program-basic-study',
          'submission-basic-publishable-final',
        ),
      },
    ],
  },
] as const satisfies readonly MatrixRow[];

// ── program-capstone — 대시보드 카드: 전체 0 (빈 목록 상태 확인용) ──

/** 마일스톤 id는 학생 동선 픽스처(`STUDENT_JOURNEY_RESPONSES`)와 같은 값이다. */
const CAPSTONE_MILESTONES = [
  {
    id: 'milestones-approved',
    name: '기획서 제출',
    dueAt: '2026-07-15T14:59:59.000Z',
    submissionType: 'FILE',
    instructions: '[로컬 검토용] 합성 안내 문구입니다.',
  },
  {
    id: 'milestones-upcoming',
    name: '중간 보고',
    dueAt: '2026-07-26T14:59:59.000Z',
    submissionType: 'TEXT',
    instructions: null,
  },
  {
    id: 'milestones-revision',
    name: '최종 결과 요약',
    dueAt: '2026-08-10T14:59:59.000Z',
    submissionType: 'TEXT',
    instructions: null,
  },
] as const satisfies readonly EditableMilestone[];

const CAPSTONE_PROGRAM = {
  id: 'program-capstone',
  name: '합성 캡스톤 2026',
  organizer: '합성 SW중심대학사업단',
  category: 'CAPSTONE',
  applicationTemplateKey: 'capstone',
  applicationTemplateVersion: 1,
  applicationCount: 0,
  applicationStartAt: '2026-06-30T15:00:00.000Z',
  applicationEndAt: '2026-12-31T14:59:59.000Z',
  endAt: '2027-01-31T14:59:59.000Z',
  repositoryProvisioningEnabled: true,
  description:
    '로컬 검토용 합성 프로그램입니다. 승인된 신청이 없는 상태를 확인합니다.',
  teamMinSize: 2,
  teamMaxSize: 5,
  lifecycle: 'PUBLISHED',
  categoryLocked: {
    locked: false,
    byApplications: false,
    byTeams: false,
    applicationCount: 0,
    teamCount: 0,
  },
  milestones: CAPSTONE_MILESTONES,
} as const satisfies EditableProgram;

// ── program-oss-contest — 팀형 동선(대시보드 카드 없음) ──

const CONTEST_MILESTONES = [
  {
    id: 'milestones-overdue',
    name: '예선 결과물',
    dueAt: '2026-07-20T14:59:59.000Z',
    submissionType: 'TEXT',
    instructions: '[로컬 검토용] 합성 안내 문구입니다.',
  },
  {
    id: 'milestones-contest-final',
    name: '본선 발표 자료',
    dueAt: '2026-08-08T14:59:59.000Z',
    submissionType: 'FILE',
    instructions: null,
  },
] as const satisfies readonly EditableMilestone[];

const CONTEST_PROGRAM = {
  id: 'program-oss-contest',
  name: '합성 OSS 경진대회',
  organizer: '합성 SW중심대학사업단',
  category: 'OSS_CONTEST',
  applicationTemplateKey: 'oss-contest',
  applicationTemplateVersion: 1,
  applicationCount: 2,
  applicationStartAt: '2026-07-14T15:00:00.000Z',
  applicationEndAt: '2026-11-30T14:59:59.000Z',
  endAt: '2026-12-31T14:59:59.000Z',
  repositoryProvisioningEnabled: true,
  description:
    '로컬 검토용 합성 경진대회입니다. 팀형 신청·제출 화면을 확인합니다.',
  teamMinSize: 2,
  teamMaxSize: 4,
  lifecycle: 'PUBLISHED',
  categoryLocked: {
    locked: true,
    byApplications: true,
    byTeams: true,
    applicationCount: 2,
    teamCount: 2,
  },
  milestones: CONTEST_MILESTONES,
} as const satisfies EditableProgram;

const CONTEST_APPLICATIONS = [
  {
    id: 'application-team',
    programId: 'program-oss-contest',
    repositoryConnectionMode: 'NEW',
    repositoryUrl: null,
    status: 'APPROVED',
    rejectionReason: null,
    // 승인 후 저장소를 공개로 돌릴 예정인지. 신청자 목록의 상태 칸이 읽는다.
    isRepositoryPublicationPlanned: false,
    repositoryProvisioning: PROVISIONING_SUCCEEDED,
    // 저장소는 프로비저닝이 성공한 신청에만 있다. 공개 전환은 네 게이트를 전부 지나야
    // 하므로(저장소 준비·공개 예정·프로그램 종료·필수 마일스톤 승인) 진행 중에는 대부분 PRIVATE이다.
    repository: {
      url: 'https://github.com/JNU-SWCU/synthetic-repo-2',
      visibility: 'PRIVATE',
    },
    submittedAt: '2026-07-16T04:00:00.000Z',
    participation: 'TEAM',
    applicant: {
      id: 'synthetic-user-21',
      name: '합성 학생 21',
      nickname: 'synthetic-student-21',
    },
    team: {
      // 팀 명단(`program-overview-fixtures`의 경진대회 1팀)과 같은 id 여야 한다 —
      // 교직원 참여 팀 목록이 이 id 로 신청을 붙인다. 어긋나면 그 화면에서 모든 팀이
      // "신청서 안 냄"으로 보인다.
      id: 'synthetic-team-contest-1',
      name: '합성 경진대회 1팀',
      memberCount: 2,
    },
    answers: {
      applicantName: '합성 학생 21',
      title: '합성 오픈소스팀 출품 계획',
      summary: '보완 요청 상태의 팀 제출을 확인하기 위한 합성 신청입니다.',
    },
  },
  {
    id: 'application-contest-champion',
    programId: 'program-oss-contest',
    repositoryConnectionMode: 'NEW',
    repositoryUrl: null,
    status: 'APPROVED',
    rejectionReason: null,
    // 승인 후 저장소를 공개로 돌릴 예정인지. 신청자 목록의 상태 칸이 읽는다.
    isRepositoryPublicationPlanned: false,
    repositoryProvisioning: PROVISIONING_SUCCEEDED,
    // 저장소는 프로비저닝이 성공한 신청에만 있다. 공개 전환은 네 게이트를 전부 지나야
    // 하므로(저장소 준비·공개 예정·프로그램 종료·필수 마일스톤 승인) 진행 중에는 대부분 PRIVATE이다.
    repository: {
      url: 'https://github.com/JNU-SWCU/synthetic-repo-3',
      visibility: 'PRIVATE',
    },
    submittedAt: '2026-07-17T07:20:00.000Z',
    participation: 'TEAM',
    applicant: {
      id: 'synthetic-user-31',
      name: '합성 학생 31',
      nickname: 'synthetic-student-31',
    },
    team: {
      // 팀 명단의 경진대회 2팀과 같은 id 여야 한다 — 교직원 참여 팀 목록이 이 id 로
      // 신청을 붙인다.
      id: 'synthetic-team-contest-2',
      name: '합성 경진대회 2팀',
      memberCount: 3,
    },
    answers: {
      applicantName: '합성 학생 31',
      title: '합성 챔피언팀 출품 계획',
      summary:
        '저장소 공개 전환이 가능한 상태를 확인하기 위한 합성 신청입니다.',
    },
  },
] as const satisfies readonly ApplicationListItem[];

const CONTEST_MATRIX_ROWS = [
  {
    applicationId: 'application-team',
    applicationMode: 'TEAM',
    displayName: '합성 오픈소스팀',
    githubLogins: [
      'synthetic-student-21',
      'synthetic-student-22',
      'synthetic-student-23',
    ],
    cells: [
      {
        milestoneId: 'milestones-overdue',
        submissionId: 'submission-contest-revision',
        revision: 2,
        status: 'CHANGES_REQUESTED',
        submittedAt: '2026-07-19T12:00:00.000Z',
        reviewUrl: reviewUrl(
          'program-oss-contest',
          'submission-contest-revision',
        ),
      },
      {
        milestoneId: 'milestones-contest-final',
        submissionId: null,
        revision: null,
        status: 'NOT_SUBMITTED',
        submittedAt: null,
        reviewUrl: null,
      },
    ],
  },
  {
    applicationId: 'application-contest-champion',
    applicationMode: 'TEAM',
    displayName: '합성 챔피언팀',
    githubLogins: ['synthetic-student-31', 'synthetic-student-32'],
    cells: [
      {
        milestoneId: 'milestones-overdue',
        submissionId: 'submission-contest-champion-preliminary',
        revision: 1,
        status: 'APPROVED',
        submittedAt: '2026-07-18T02:30:00.000Z',
        reviewUrl: reviewUrl(
          'program-oss-contest',
          'submission-contest-champion-preliminary',
        ),
      },
      {
        milestoneId: 'milestones-contest-final',
        submissionId: 'submission-contest-champion-final',
        revision: 1,
        status: 'APPROVED',
        submittedAt: '2026-08-07T06:10:00.000Z',
        reviewUrl: reviewUrl(
          'program-oss-contest',
          'submission-contest-champion-final',
        ),
      },
    ],
  },
] as const satisfies readonly MatrixRow[];

// ── program-synthetic-new — `POST programs` 직후 이동하는 프로그램 ──

/**
 * 프로그램 등록 성공 시 화면은 응답의 `detailUrl`로 이동한다. 핸들러 계약에는
 * 요청 body가 없어 입력을 되돌려 줄 수 없으므로, 이동한 화면이 빈손이 되지
 * 않도록 "방금 만든 프로그램" 자리를 미리 만들어 둔다. 마일스톤이 없어
 * 제출 현황 화면의 "마일스톤 없음" 상태도 여기서 확인된다.
 */
const CREATED_PROGRAM = {
  id: 'program-synthetic-new',
  name: '합성 신규 프로그램',
  organizer: '합성 SW중심대학사업단',
  category: 'BASIC',
  applicationTemplateKey: 'basic',
  applicationTemplateVersion: 1,
  applicationCount: 0,
  applicationStartAt: '2026-08-01T00:00:00.000Z',
  applicationEndAt: '2026-08-31T14:59:59.000Z',
  endAt: '2026-12-31T14:59:59.000Z',
  repositoryProvisioningEnabled: false,
  description:
    '방금 등록한 프로그램 자리입니다. 로컬 검토용 합성 데이터이며 입력값은 저장되지 않습니다.',
  teamMinSize: null,
  teamMaxSize: null,
  lifecycle: 'PUBLISHED',
  categoryLocked: {
    locked: false,
    byApplications: false,
    byTeams: false,
    applicationCount: 0,
    teamCount: 0,
  },
  milestones: [],
} as const satisfies EditableProgram;

export const CREATED_PROGRAM_ID = CREATED_PROGRAM.id;

// ── 묶음 ────────────────────────────────────────────────────────────────

export interface StaffProgramFixture {
  readonly program: EditableProgram;
  readonly applications: readonly ApplicationListItem[];
  readonly matrixRows: readonly MatrixRow[];
}

export const STAFF_PROGRAM_FIXTURES: readonly StaffProgramFixture[] = [
  {
    program: BASIC_PROGRAM,
    applications: BASIC_APPLICATIONS,
    matrixRows: BASIC_MATRIX_ROWS,
  },
  {
    program: CAPSTONE_PROGRAM,
    applications: [],
    matrixRows: [],
  },
  {
    program: CONTEST_PROGRAM,
    applications: CONTEST_APPLICATIONS,
    matrixRows: CONTEST_MATRIX_ROWS,
  },
  {
    program: CREATED_PROGRAM,
    applications: [],
    matrixRows: [],
  },
];

export function findStaffProgram(
  programId: string,
): StaffProgramFixture | null {
  return (
    STAFF_PROGRAM_FIXTURES.find(
      (fixture) => fixture.program.id === programId,
    ) ?? null
  );
}

/**
 * #722 신청 상세는 프로그램을 모른 채 신청 id 하나로 온다(백엔드 `GET applications/:id`
 * 계약과 같다). 그래서 프로그램을 가로질러 찾는다.
 */
export function findStaffApplication(
  applicationId: string,
): ApplicationListItem | null {
  for (const fixture of STAFF_PROGRAM_FIXTURES) {
    const application = fixture.applications.find(
      (item) => item.id === applicationId,
    );
    if (application !== undefined) return application;
  }
  return null;
}

export function findStaffMilestone(
  milestoneId: string,
): EditableMilestone | null {
  return findStaffMilestoneContext(milestoneId)?.milestone ?? null;
}

/**
 * 마일스톤과 **그것을 소유한 프로그램**을 함께 돌려준다. 서류 수합 응답이
 * `milestone.programId`를 싣게 되면서 필요해졌다 — 마일스톤만 찾아 오면 픽스처가
 * 소유 프로그램을 지어내야 하고, 그러면 화면의 「경로 프로그램과 대조」가 로컬 검토에서
 * 언제나 통과해 버린다.
 */
export function findStaffMilestoneContext(milestoneId: string): {
  readonly programId: string;
  readonly milestone: EditableMilestone;
} | null {
  for (const fixture of STAFF_PROGRAM_FIXTURES) {
    const milestone = fixture.program.milestones.find(
      (candidate) => candidate.id === milestoneId,
    );
    if (milestone !== undefined) {
      return { programId: fixture.program.id, milestone };
    }
  }
  return null;
}

/**
 * 검토 화면(#125) 컨텍스트. 키는 매트릭스 셀의 `submissionId`와 같은 값이라
 * 셀 링크를 그대로 따라오면 반드시 여기에 걸린다.
 */
export const STAFF_REVIEW_CONTEXTS: Readonly<Record<string, ReviewContext>> = {
  'submission-basic-orientation': {
    submissionId: 'submission-basic-orientation',
    application: {
      id: 'application-basic-approved',
      applicationMode: 'PERSONAL',
      displayName: '합성 학생 11',
    },
    milestone: {
      id: 'milestone-basic-orientation',
      name: '합성 오리엔테이션 회고',
    },
    currentRevision: {
      number: 2,
      content: {
        type: 'TEXT',
        text: '합성 회고 본문입니다. 로컬 검토용으로만 존재하는 내용입니다.',
      },
      comment: '보완 요청 사항을 반영해 다시 제출했습니다.',
      submittedAt: '2026-05-14T05:00:00.000Z',
      // 본문만 낸 제출이라 첨부는 없다.
      files: [],
      review: {
        id: 'synthetic-review-basic-orientation-2',
        decision: 'APPROVED',
        comment: '합성 승인 코멘트입니다.',
        reviewedAt: '2026-05-15T01:00:00.000Z',
      },
    },
    history: [
      {
        number: 1,
        content: { type: 'TEXT', text: '합성 회고 초안입니다.' },
        comment: null,
        submittedAt: '2026-05-10T05:00:00.000Z',
        // 본문만 낸 제출이라 첨부는 없다.
        files: [],
        review: {
          id: 'synthetic-review-basic-orientation-1',
          decision: 'CHANGES_REQUESTED',
          comment: '합성 보완 요청 코멘트입니다.',
          reviewedAt: '2026-05-11T02:00:00.000Z',
        },
      },
    ],
    // 같은 신청의 `submission-basic-final`이 아직 SUBMITTED라 공개가 막힌다.
    repository: {
      id: 'synthetic-repo-basic-01',
      url: 'https://github.com/JNU-SWCU/synthetic-basic-study-01',
      visibility: 'PRIVATE',
      publishEligible: false,
      blockedReasons: [
        'REPOSITORY_PUBLICATION_NOT_PLANNED',
        'REQUIRED_MILESTONES_NOT_APPROVED',
      ],
    },
  },
  'submission-basic-final': {
    submissionId: 'submission-basic-final',
    application: {
      id: 'application-basic-approved',
      applicationMode: 'PERSONAL',
      displayName: '합성 학생 11',
    },
    milestone: {
      id: 'milestone-basic-final',
      name: '합성 최종 실습 결과',
    },
    // 아직 판정이 없는 제출 — 검토 폼을 실제로 눌러 볼 수 있는 자리다.
    currentRevision: {
      number: 1,
      content: {
        type: 'TEXT',
        text: '최종 실습 결과와 실행 환경을 정리한 합성 제출입니다.',
      },
      comment: '합성 결과 요약을 첨부했습니다.',
      submittedAt: '2026-06-29T09:30:00.000Z',
      // 본문만 낸 제출이라 첨부는 없다.
      files: [],
      review: null,
    },
    history: [],
    // `application-basic-approved` 는 저장소 공개 예정이 "아니요"라 그 사유도 함께 막는다.
    repository: {
      id: 'synthetic-repo-basic-01',
      url: 'https://github.com/JNU-SWCU/synthetic-basic-study-01',
      visibility: 'PRIVATE',
      publishEligible: false,
      blockedReasons: [
        'REPOSITORY_PUBLICATION_NOT_PLANNED',
        'REQUIRED_MILESTONES_NOT_APPROVED',
      ],
    },
  },
  /**
   * 네 게이트를 전부 지난 자리(#753). 두 제출이 같은 저장소를 가리키므로 공개 판정도
   * 같아야 한다 — 판정은 제출이 아니라 신청의 저장소에 달려 있다.
   */
  'submission-basic-publishable-orientation': {
    submissionId: 'submission-basic-publishable-orientation',
    application: {
      id: 'application-basic-publishable',
      applicationMode: 'PERSONAL',
      displayName: '합성 학생 14',
    },
    milestone: {
      id: 'milestone-basic-orientation',
      name: '합성 오리엔테이션 회고',
    },
    currentRevision: {
      number: 1,
      content: {
        type: 'TEXT',
        text: '오리엔테이션 회고를 정리한 합성 제출입니다.',
      },
      comment: null,
      submittedAt: '2026-05-12T04:00:00.000Z',
      // 본문만 낸 제출이라 첨부는 없다.
      files: [],
      review: {
        id: 'synthetic-review-basic-publishable-orientation',
        decision: 'APPROVED',
        comment: '합성 승인 코멘트입니다.',
        reviewedAt: '2026-05-13T01:00:00.000Z',
      },
    },
    history: [],
    // 프로비저닝 성공 + 공개 예정 + 지난 종료일(2026-07-31) + 필수 마일스톤 전원 승인.
    repository: {
      id: 'synthetic-repo-basic-02',
      url: 'https://github.com/JNU-SWCU/synthetic-basic-study-02',
      visibility: 'PRIVATE',
      publishEligible: true,
      blockedReasons: [],
    },
  },
  'submission-basic-publishable-final': {
    submissionId: 'submission-basic-publishable-final',
    application: {
      id: 'application-basic-publishable',
      applicationMode: 'PERSONAL',
      displayName: '합성 학생 14',
    },
    milestone: {
      id: 'milestone-basic-final',
      name: '합성 최종 실습 결과',
    },
    currentRevision: {
      number: 1,
      content: {
        type: 'TEXT',
        text: '최종 실습 결과를 정리한 합성 제출입니다.',
      },
      comment: '결과 요약을 본문에 담았습니다.',
      submittedAt: '2026-06-28T07:15:00.000Z',
      // 본문만 낸 제출이라 첨부는 없다.
      files: [],
      review: {
        id: 'synthetic-review-basic-publishable-final',
        decision: 'APPROVED',
        comment: '합성 승인 코멘트입니다.',
        reviewedAt: '2026-06-29T01:00:00.000Z',
      },
    },
    history: [],
    // 같은 저장소이므로 오리엔테이션 제출과 같은 판정이어야 한다.
    repository: {
      id: 'synthetic-repo-basic-02',
      url: 'https://github.com/JNU-SWCU/synthetic-basic-study-02',
      visibility: 'PRIVATE',
      publishEligible: true,
      blockedReasons: [],
    },
  },
  'submission-contest-revision': {
    submissionId: 'submission-contest-revision',
    application: {
      id: 'application-team',
      applicationMode: 'TEAM',
      displayName: '합성 오픈소스팀',
    },
    milestone: { id: 'milestones-overdue', name: '예선 결과물' },
    currentRevision: {
      number: 2,
      content: {
        type: 'TEXT',
        text: '예선 결과물의 재현 순서와 테스트 결과를 정리한 합성 제출입니다.',
      },
      comment: '재현 순서를 결과 요약에 추가했습니다.',
      submittedAt: '2026-07-19T12:00:00.000Z',
      // 본문만 낸 제출이라 첨부는 없다.
      files: [],
      review: {
        id: 'synthetic-review-contest-revision-2',
        decision: 'CHANGES_REQUESTED',
        comment: '합성 보완 요청 코멘트입니다. 테스트 결과를 덧붙여 주세요.',
        reviewedAt: '2026-07-20T01:30:00.000Z',
      },
    },
    history: [
      {
        number: 1,
        content: {
          type: 'TEXT',
          text: '예선 결과물의 최초 합성 제출입니다.',
        },
        comment: null,
        submittedAt: '2026-07-18T11:00:00.000Z',
        // 본문만 낸 제출이라 첨부는 없다.
        files: [],
        review: {
          id: 'synthetic-review-contest-revision-1',
          decision: 'CHANGES_REQUESTED',
          comment: '합성 보완 요청 코멘트입니다.',
          reviewedAt: '2026-07-18T23:00:00.000Z',
        },
      },
    ],
    // `application-team` 은 저장소 공개 예정이 "아니요"이고 `program-oss-contest` 는
    // endAt(2026-12-31)이 아직 안 지났다 — 서버는 세 사유를 모두 낸다.
    repository: {
      id: 'synthetic-repo-contest-01',
      url: 'https://github.com/JNU-SWCU/synthetic-contest-01',
      visibility: 'PRIVATE',
      publishEligible: false,
      blockedReasons: [
        'REPOSITORY_PUBLICATION_NOT_PLANNED',
        'PROGRAM_NOT_ENDED',
        'REQUIRED_MILESTONES_NOT_APPROVED',
      ],
    },
  },
  'submission-contest-champion-preliminary': {
    submissionId: 'submission-contest-champion-preliminary',
    application: {
      id: 'application-contest-champion',
      applicationMode: 'TEAM',
      displayName: '합성 챔피언팀',
    },
    milestone: { id: 'milestones-overdue', name: '예선 결과물' },
    currentRevision: {
      number: 1,
      content: {
        type: 'TEXT',
        text: '예선 결과물의 승인된 합성 제출입니다.',
      },
      comment: null,
      submittedAt: '2026-07-18T02:30:00.000Z',
      // 본문만 낸 제출이라 첨부는 없다.
      files: [],
      review: {
        id: 'synthetic-review-champion-preliminary',
        decision: 'APPROVED',
        comment: '합성 승인 코멘트입니다.',
        reviewedAt: '2026-07-18T08:00:00.000Z',
      },
    },
    history: [],
    // 마일스톤은 전원 승인이지만 `application-contest-champion`이 저장소 공개 예정 "아니요"이고
    // `program-oss-contest`의 endAt(2026-12-31)이 아직 안 지나 서버가 거절한다.
    repository: {
      id: 'synthetic-repo-contest-02',
      url: 'https://github.com/JNU-SWCU/synthetic-contest-02',
      visibility: 'PRIVATE',
      publishEligible: false,
      blockedReasons: [
        'REPOSITORY_PUBLICATION_NOT_PLANNED',
        'PROGRAM_NOT_ENDED',
      ],
    },
  },
  'submission-contest-champion-final': {
    submissionId: 'submission-contest-champion-final',
    application: {
      id: 'application-contest-champion',
      applicationMode: 'TEAM',
      displayName: '합성 챔피언팀',
    },
    milestone: { id: 'milestones-contest-final', name: '본선 발표 자료' },
    currentRevision: {
      number: 1,
      content: { type: 'FILE', fileId: 'synthetic-file-champion-final' },
      comment: '합성 발표 자료를 제출했습니다.',
      submittedAt: '2026-08-07T06:10:00.000Z',
      // 본문만 낸 제출이라 첨부는 없다.
      files: [],
      review: {
        id: 'synthetic-review-champion-final',
        decision: 'APPROVED',
        comment: '합성 승인 코멘트입니다.',
        reviewedAt: '2026-08-07T09:00:00.000Z',
      },
    },
    history: [],
    // 같은 저장소이므로 예선 제출과 같은 판정이어야 한다.
    repository: {
      id: 'synthetic-repo-contest-02',
      url: 'https://github.com/JNU-SWCU/synthetic-contest-02',
      visibility: 'PRIVATE',
      publishEligible: false,
      blockedReasons: [
        'REPOSITORY_PUBLICATION_NOT_PLANNED',
        'PROGRAM_NOT_ENDED',
      ],
    },
  },
};
