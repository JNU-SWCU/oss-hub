import type { ProgramTeam } from '@/features/programs/api';
import type { StudentApplication } from '@/features/programs/student-application-api';
import type {
  ApplicationStatus,
  ProgramActivity,
  ProgramDetail,
  ProgramMilestone,
  SubmissionSummary,
  ViewerRole,
} from '@/features/programs/types';
import type {
  SubmissionChecklist,
  SubmissionFormData,
} from '@/features/submissions/types';

/**
 * 학생 동선이 읽는 프로그램 합성 데이터.
 *
 * 프로그램 id는 공개 목록(`fixture-response.ts`의 PUBLIC_PROGRAM_FIXTURES)·학생 동선
 * 픽스처와 **같은 값**이어야 한다. 다른 체계를 쓰면 목록에서 눌러 들어간 상세가
 * 어떤 픽스처와도 매칭되지 않는다.
 */
export const PUBLIC_PROGRAM_IDS = [
  'program-capstone',
  'program-oss-contest',
  'program-basic-study',
  'program-sw-value',
  'program-archived-internship',
] as const;

export type PublicProgramId = (typeof PUBLIC_PROGRAM_IDS)[number];

export function isPublicProgramId(value: string): value is PublicProgramId {
  return (PUBLIC_PROGRAM_IDS as readonly string[]).includes(value);
}

type ProgramBase = Omit<ProgramDetail, 'viewer' | 'milestones'>;

const CAPSTONE_BASE = {
  id: 'program-capstone',
  name: '합성 캡스톤 2026',
  organizer: '합성 SW중심대학사업단',
  trackType: 'CURRICULAR',

  applicationTemplateKey: 'capstone',
  lifecycle: 'PUBLISHED',
  description:
    '로컬 검토용 합성 프로그램입니다. 팀 저장소 운영과 마일스톤 제출 화면을 확인하기 위한 데이터이며 실제 모집·참여자와 무관합니다.',
  repositoryProvisioningEnabled: true,
  applicationPeriod: {
    startsAt: '2026-07-01T00:00:00.000+09:00',
    endsAt: '2026-07-15T23:59:59.000+09:00',
  },
} as const satisfies ProgramBase;

const CONTEST_BASE = {
  id: 'program-oss-contest',
  name: '합성 OSS 경진대회',
  organizer: '합성 SW중심대학사업단',
  trackType: 'EXTRACURRICULAR',

  applicationTemplateKey: 'oss-contest',
  lifecycle: 'PUBLISHED',
  description:
    '로컬 검토용 합성 경진대회입니다. 예선·본선 제출 화면 구성 확인 외의 의미는 없습니다.',
  repositoryProvisioningEnabled: true,
  applicationPeriod: {
    startsAt: '2026-07-01T00:00:00.000+09:00',
    endsAt: '2026-07-10T23:59:59.000+09:00',
  },
} as const satisfies ProgramBase;

/**
 * 신청 전 상태(`viewer.applicationStatus === null`)를 검토하기 위한 프로그램이다.
 * `/programs/[id]/apply`는 신청 기간이 열려 있어야 양식을 보여주므로 기간을 넓게 둔다
 * — 공개 목록의 기초 스터디는 모집 마감으로 보이지만, 상세·신청 화면을 열어 두는 쪽이
 * 검토 가치가 크다.
 */
const BASIC_BASE = {
  id: 'program-basic-study',
  name: '합성 기초 오픈소스 스터디',
  organizer: '합성 SW중심대학사업단',
  trackType: 'EXTRACURRICULAR',

  applicationTemplateKey: 'basic',
  lifecycle: 'PUBLISHED',
  description:
    '신청 전 상태를 검토하기 위한 합성 개인형 프로그램입니다. 팀 구성 없이 바로 신청할 수 있습니다.',
  repositoryProvisioningEnabled: false,
  applicationPeriod: {
    startsAt: '2026-01-01T00:00:00.000+09:00',
    endsAt: '2026-12-31T23:59:59.000+09:00',
  },
} as const satisfies ProgramBase;

/**
 * **반려된 신청** 상태(`viewer.applicationStatus === 'REJECTED'`)를 검토하기 위한
 * 프로그램이다. 이 상태가 없으면 `/programs/[id]/apply`의 반려 사유 상자에 아무도
 * 도달하지 못한다 — 나머지 셋은 승인 둘·신청 전 하나라 그 화면을 지나가지 않는다.
 *
 * 개인형(`SW_VALUE_SPREAD`)으로 둔다. 팀형이면 검토자가 팀부터 만들어야 하는데,
 * 반려 화면은 팀 구성과 아무 상관이 없어 도달 경로만 길어진다.
 *
 * 신청 기간은 이미 닫아 둔다 — 반려된 신청은 판정이 끝난 뒤의 상태라 모집이 열려
 * 있으면 목록과 상세가 서로 어긋나 보인다.
 */
const SW_VALUE_BASE = {
  id: 'program-sw-value',
  name: '합성 SW가치확산 프로그램',
  organizer: '합성 SW중심대학사업단',
  trackType: 'EXTRACURRICULAR',

  applicationTemplateKey: 'sw-value-spread',
  lifecycle: 'PUBLISHED',
  description:
    '반려된 신청 상태를 검토하기 위한 합성 개인형 프로그램입니다. 신청 상세에서 반려 사유가 어떻게 보이는지 확인할 수 있습니다.',
  repositoryProvisioningEnabled: false,
  applicationPeriod: {
    startsAt: '2026-01-01T00:00:00.000+09:00',
    endsAt: '2026-06-30T23:59:59.000+09:00',
  },
} as const satisfies ProgramBase;

/**
 * **내린 프로그램**(`lifecycle: 'ARCHIVED'`)을 검토하기 위한 프로그램이다(#1092).
 *
 * 이 페르소나가 없으면 「내린 프로그램의 상세」를 아무도 눈으로 볼 수 없다 — 나머지
 * 넷은 모두 `PUBLISHED`라 상세 화면의 종료 갈래(배지 「종료」·신청 버튼 비활성)를
 * 지나가지 않는다. 그 사각지대가 「목록은 종료인데 상세는 모집중 + 신청하기」라는
 * 결함이 살아남은 이유이기도 하다.
 *
 * **신청 기간은 일부러 열어 둔다.** 기간까지 닫아 두면 날짜만 봐도 종료로 보여서,
 * 화면이 게시 축(lifecycle)을 실제로 읽는지 아니면 예전처럼 기간만 보고 있는지
 * 구별할 수 없다. 「기간은 남았는데 내려서 종료」가 이 티켓의 상황 그 자체다.
 * 같은 이유로 운영 기간(`operatingPeriod`)도 싣지 않는다 — 종료일이 지나 있으면
 * 그쪽만으로도 종료가 되어 대조가 흐려진다.
 *
 * 학생은 **아직 신청하지 않은 상태**(`studentApplicationStatus: null`)로 둔다.
 * 신청 버튼이 그려지는 갈래를 봐야 그 버튼이 비활성으로 바뀌었는지 확인할 수 있다 —
 * 이미 신청한 상태면 화면이 신청 입구 자체를 그리지 않는다.
 *
 * 개인형(`CORPORATE_INTERNSHIP`)으로 둔다. 팀형이면 검토자가 팀부터 만들어야 하는데
 * 종료 화면은 팀 구성과 아무 상관이 없어 도달 경로만 길어진다(반려 프로그램과 같은 판단).
 */
const ARCHIVED_INTERNSHIP_BASE = {
  id: 'program-archived-internship',
  name: '합성 기업 인턴십 프로그램',
  organizer: '합성 SW중심대학사업단',
  trackType: 'EXTRACURRICULAR',
  applicationTemplateKey: 'basic',
  lifecycle: 'ARCHIVED',
  description:
    '내린 프로그램의 상세를 검토하기 위한 합성 개인형 프로그램입니다. 신청 기간은 아직 남아 있지만 운영이 취소되어 내려갔습니다.',
  repositoryProvisioningEnabled: false,
  applicationPeriod: {
    startsAt: '2026-01-01T00:00:00.000+09:00',
    endsAt: '2026-12-31T23:59:59.000+09:00',
  },
} as const satisfies ProgramBase;

/**
 * 학생이 보는 마일스톤. `viewerSubmissionStatus`는 학생 동선 픽스처
 * (`student-journey-fixtures.ts`)와 같은 값을 유지해 두 경로가 어긋나지 않게 한다.
 */
const CAPSTONE_MILESTONES = [
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
] as const satisfies readonly ProgramMilestone[];

const CONTEST_MILESTONES = [
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
] as const satisfies readonly ProgramMilestone[];

/** 신청 전이라 제출 상태가 없다 — 상세 화면은 "신청 승인 후 확인" 안내를 보여준다. */
const BASIC_MILESTONES = [
  {
    id: 'milestones-basic-intro',
    name: '학습 회고 제출',
    dueAt: '2026-08-20T23:59:59.000+09:00',
    dDay: 19,
    deadlineLabel: 'D-19',
    description: '첫 기여까지의 과정을 글로 정리해 제출합니다.',
    submissionType: 'TEXT',
    submissionItemCount: 0,
    viewerSubmissionStatus: null,
    applicationSubmissionSummary: null,
  },
  {
    id: 'milestones-basic-final',
    name: '최종 실습 결과',
    dueAt: '2026-09-10T23:59:59.000+09:00',
    dDay: 40,
    deadlineLabel: 'D-40',
    description: '개인 실습 저장소의 최종 결과물을 제출합니다.',
    submissionType: 'FILE',
    submissionItemCount: 0,
    viewerSubmissionStatus: null,
    applicationSubmissionSummary: null,
  },
] as const satisfies readonly ProgramMilestone[];

/**
 * 반려된 신청이라 제출 상태가 없다 — 승인되지 않았으므로 이 학생에게는 제출 대상이
 * 애초에 생기지 않는다(`viewerSubmissionStatus: null`).
 */
const SW_VALUE_MILESTONES = [
  {
    id: 'milestones-sw-value-plan',
    name: '확산 계획서 제출',
    dueAt: '2026-07-31T23:59:59.000+09:00',
    dDay: -1,
    deadlineLabel: '마감 지남',
    description: '오픈소스 가치 확산 활동 계획과 대상을 정리해 제출합니다.',
    submissionType: 'TEXT',
    submissionItemCount: 0,
    viewerSubmissionStatus: null,
    applicationSubmissionSummary: null,
  },
] as const satisfies readonly ProgramMilestone[];

/**
 * 내려간 프로그램의 마일스톤. 아무도 신청하지 못한 채 내려갔으므로 제출 상태가 없다
 * (`viewerSubmissionStatus: null`).
 *
 * 마감은 **지난 날짜로 둔다.** 서류 제출 여부는 이 마감으로 갈리는데(상세 화면이
 * `dueAt`으로 `closed`를 계산한다), 마감이 남아 있으면 신청은 막혔는데 제출 버튼만
 * 살아 있는 화면이 된다 — 이 PR이 보여 주려는 것과 어긋나는 모순을 픽스처가 스스로
 * 만들어 검토 노이즈가 된다. 신청 기간(열림)과는 다른 축이라 이 티켓의 대조
 * (「기간은 남았는데 내려서 종료」)는 그대로 남는다.
 */
const ARCHIVED_INTERNSHIP_MILESTONES = [
  {
    id: 'milestones-internship-report',
    name: '중간 활동 보고',
    dueAt: '2026-07-31T23:59:59.000+09:00',
    dDay: -1,
    deadlineLabel: '마감 지남',
    description: '인턴십 중간 활동 내용과 배운 점을 정리해 제출합니다.',
    submissionType: 'TEXT',
    submissionItemCount: 0,
    viewerSubmissionStatus: null,
    applicationSubmissionSummary: null,
  },
] as const satisfies readonly ProgramMilestone[];

/** 교직원·관리자 시야의 마일스톤 집계. 학생 제출 상태 대신 신청 단위 합계를 보여준다. */
const STAFF_MILESTONE_SUMMARIES: Readonly<Record<string, SubmissionSummary>> = {
  'milestones-approved': {
    notSubmitted: 1,
    submitted: 0,
    approved: 2,
    changesRequested: 0,
    rejected: 0,
    total: 3,
  },
  'milestones-upcoming': {
    notSubmitted: 2,
    submitted: 1,
    approved: 0,
    changesRequested: 0,
    rejected: 0,
    total: 3,
  },
  'milestones-revision': {
    notSubmitted: 1,
    submitted: 0,
    approved: 1,
    changesRequested: 1,
    rejected: 0,
    total: 3,
  },
  'milestones-overdue': {
    notSubmitted: 0,
    submitted: 1,
    approved: 0,
    changesRequested: 1,
    rejected: 1,
    total: 3,
  },
  'milestones-contest-final': {
    notSubmitted: 3,
    submitted: 0,
    approved: 0,
    changesRequested: 0,
    rejected: 0,
    total: 3,
  },
  'milestones-basic-intro': {
    notSubmitted: 4,
    submitted: 0,
    approved: 0,
    changesRequested: 0,
    rejected: 0,
    total: 4,
  },
  'milestones-basic-final': {
    notSubmitted: 4,
    submitted: 0,
    approved: 0,
    changesRequested: 0,
    rejected: 0,
    total: 4,
  },
  // 승인된 신청이 하나도 없는 프로그램이라 제출 대상도 0이다 — 반려만 있다.
  'milestones-sw-value-plan': {
    notSubmitted: 0,
    submitted: 0,
    approved: 0,
    changesRequested: 0,
    rejected: 0,
    total: 0,
  },
  // 아무도 신청하지 못한 채 내려간 프로그램이라 제출 대상 자체가 생기지 않았다.
  'milestones-internship-report': {
    notSubmitted: 0,
    submitted: 0,
    approved: 0,
    changesRequested: 0,
    rejected: 0,
    total: 0,
  },
};

type ProgramFixture = {
  readonly base: ProgramBase;
  readonly milestones: readonly ProgramMilestone[];
  /** 학생 페르소나의 신청 상태. `null`이면 신청 전(`/apply` 검토 대상). */
  readonly studentApplicationStatus: ApplicationStatus | null;
  readonly activity: readonly ProgramActivity[];
};

const PROGRAM_FIXTURES: Readonly<Record<PublicProgramId, ProgramFixture>> = {
  'program-capstone': {
    base: CAPSTONE_BASE,
    milestones: CAPSTONE_MILESTONES,
    studentApplicationStatus: 'APPROVED',
    activity: [
      {
        applicationId: 'application-personal',
        label: 'synthetic-student',
        commitCount: 18,
        pullRequestCount: 3,
        releaseCount: 1,
        dataAsOf: '2026-07-31T09:00:00.000+09:00',
        lastActivityAt: '2026-07-30T21:14:00.000+09:00',
      },
    ],
  },
  'program-oss-contest': {
    base: CONTEST_BASE,
    milestones: CONTEST_MILESTONES,
    studentApplicationStatus: 'APPROVED',
    activity: [
      {
        applicationId: 'application-team',
        label: '합성 오픈소스팀',
        commitCount: 27,
        pullRequestCount: 6,
        releaseCount: 2,
        dataAsOf: '2026-07-31T09:00:00.000+09:00',
        lastActivityAt: '2026-07-31T08:42:00.000+09:00',
      },
    ],
  },
  'program-basic-study': {
    base: BASIC_BASE,
    milestones: BASIC_MILESTONES,
    // 신청 전 상태 — `/programs/program-basic-study/apply`를 검토하려면 필요하다.
    studentApplicationStatus: null,
    // 아직 연결된 저장소가 없다 — 활동 패널의 빈 상태를 검토할 수 있다.
    activity: [],
  },
  'program-sw-value': {
    base: SW_VALUE_BASE,
    milestones: SW_VALUE_MILESTONES,
    // 반려 상태 — `/programs/program-sw-value/apply`의 반려 사유 상자를 검토하려면
    // 필요하다. 이 값이 `null`이면 화면이 신청 양식으로 갈려 사유에 닿지 못하고,
    // `APPROVED`면 사유 없는 `already-applied` 안내만 뜬다.
    studentApplicationStatus: 'REJECTED',
    // 반려라 저장소가 만들어지지 않았다.
    activity: [],
  },
  'program-archived-internship': {
    base: ARCHIVED_INTERNSHIP_BASE,
    milestones: ARCHIVED_INTERNSHIP_MILESTONES,
    // 신청 전 상태여야 신청 버튼이 그려지는 갈래를 지나간다 — 그 버튼이 비활성으로
    // 바뀌었는지가 이 프로그램에서 확인할 것이다. `APPROVED`·`REJECTED`면 화면이
    // 신청 입구 자체를 그리지 않아 확인할 대상이 사라진다.
    studentApplicationStatus: null,
    // 내려가기 전까지 아무도 신청하지 않아 저장소가 만들어지지 않았다.
    activity: [],
  },
};

/**
 * `GET programs/{id}/applications/me` 응답. 백엔드
 * `StudentApplicationResponse`(`student-applications.controller.ts`)와 같은 모양이며,
 * 화면 타입을 그대로 빌려 키가 어긋나면 컴파일에서 걸리게 한다.
 *
 * **반려 사유가 학생에게 닿는 경로는 이 응답 하나뿐이다** — 알림 payload에도, 감사
 * 로그에도, 메일에도 담기지 않는다. 그래서 이 픽스처가 없으면 로컬 검토에서
 * `/programs/{id}/apply`가 사유를 그릴 수 없고, 검토자는 화면이 비어 있는 것을
 * 제품 결함으로 읽는다.
 *
 * `rejectionReason`을 **여러 줄**로 둔다. 화면이 `whitespace-pre-wrap`으로 줄바꿈을
 * 살리는데, 한 줄짜리 사유만 있으면 그 규칙이 도는지 눈으로 확인할 수 없다. 빈 줄을
 * 하나 끼워 문단 구분까지 함께 보이게 한다.
 *
 * 줄 수를 **일부러 역할 요청 쪽 상한(6줄)보다 길게** 잡았다. 이 화면은 자르지 않으므로
 * (`sanitizeDisplayText`) 마지막 줄까지 그대로 보여야 하고, 그 사실을 검토자가
 * 눈으로 확인할 수 있어야 한다 — 재신청 마감일처럼 **끝에 오는 정보가 살아 있는지**가
 * 이 갈래에서 가장 중요한 확인이다.
 */
export const MY_APPLICATION_FIXTURES: Readonly<
  Record<string, StudentApplication>
> = {
  'program-sw-value': {
    id: 'synthetic-application-sw-value',
    programId: 'program-sw-value',
    status: 'REJECTED',
    teamId: null,
    answers: {
      applicantName: '합성 student 사용자',
      title: '학내 오픈소스 입문 워크숍 운영',
      summary:
        '오픈소스 기여 경험이 없는 학생을 대상으로 첫 PR까지 따라 할 수 있는 워크숍을 열고, 실습 자료를 저장소로 공개하려 합니다.',
    },
    submittedAt: '2026-06-20T00:00:00.000Z',
    updatedAt: '2026-06-28T00:00:00.000Z',
    isRepositoryPublicationPlanned: true,
    rejectionReason:
      '제출하신 요약이 프로그램 주제와 맞지 않습니다.\n\n보완할 점\n1. 해결하려는 문제를 한 문장으로 정리해 주세요.\n2. 기여할 오픈소스 저장소와 예상 작업 범위를 적어 주세요.\n3. 팀원 역할 분담을 적어 주세요.\n4. 일정 계획을 적어 주세요.\n\n재신청 마감은 8월 20일입니다.',
    // 신청자 본인이라 권한 자체는 있다 — 막는 것은 권한이 아니라 이미 끝난 판정이다.
    // 검토자가 볼 문구가 「수정할 권한이 없습니다」로 새지 않게 참으로 둔다.
    isManager: true,
    // 판정이 끝난 신청은 수정도 취소도 할 수 없다 — 세 값이 함께 false여야 화면이
    // 수정 버튼을 그리지 않는다.
    canManage: false,
    canEdit: false,
    canCancel: false,
  },
};

function staffMilestones(
  milestones: readonly ProgramMilestone[],
): readonly ProgramMilestone[] {
  return milestones.map((milestone) => ({
    ...milestone,
    viewerSubmissionStatus: null,
    applicationSubmissionSummary:
      STAFF_MILESTONE_SUMMARIES[milestone.id] ?? null,
  }));
}

/**
 * 페르소나별 프로그램 상세. `viewer.role`이 `null`이면 화면이 가입 안내로
 * 갈리므로, 역할이 배정되지 않은 로그인 사용자도 `null`로 둔다 — `PENDING`을 주면
 * 상세 화면이 `/onboarding/pending`으로 튕겨 나가 상세를 볼 수 없다.
 */
export function programDetailFor(
  programId: PublicProgramId,
  viewerRole: ViewerRole,
): ProgramDetail {
  const fixture = PROGRAM_FIXTURES[programId];
  if (viewerRole === 'STAFF' || viewerRole === 'ADMIN') {
    return {
      ...fixture.base,
      viewer: { role: viewerRole, applicationStatus: null },
      milestones: staffMilestones(fixture.milestones),
    };
  }
  if (viewerRole === 'STUDENT') {
    return {
      ...fixture.base,
      viewer: {
        role: 'STUDENT',
        applicationStatus: fixture.studentApplicationStatus,
      },
      milestones: fixture.milestones,
    };
  }
  return {
    ...fixture.base,
    viewer: { role: viewerRole, applicationStatus: null },
    milestones: fixture.milestones.map((milestone) => ({
      ...milestone,
      viewerSubmissionStatus: null,
      applicationSubmissionSummary: null,
    })),
  };
}

export function programActivityFor(
  programId: PublicProgramId,
): readonly ProgramActivity[] {
  return PROGRAM_FIXTURES[programId].activity;
}

/**
 * 학생 제출 체크리스트. 학생 동선 픽스처가 캡스톤·경진대회를 이미 덮으므로
 * 여기서는 `student` 외의 학생 역할 페르소나가 같은 화면을 볼 때만 쓰인다.
 */
export const PROGRAM_CHECKLISTS: Readonly<Record<string, SubmissionChecklist>> =
  {
    'program-capstone': {
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
            decision: 'APPROVED' as const,
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
            decision: 'CHANGES_REQUESTED' as const,
            currentRevision: 1,
            lastReviewedAt: '2026-07-30T16:20:00.000+09:00',
            reviewComment: '실행 환경과 변경 내역을 추가해 주세요.',
            canResubmit: true,
            // 본문만 낸 제출이라 첨부는 없다.
            file: null,
          },
        },
      ],
    },
    'program-oss-contest': {
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
            decision: 'CHANGES_REQUESTED' as const,
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
    },
  };

const LOCAL_REVIEW_TEXT_INSTRUCTIONS =
  '[로컬 검토용] 제출 화면 구성만 확인합니다. 입력한 내용은 저장되지 않습니다.';

/**
 * 마일스톤별 제출 양식. 학생 동선 픽스처가 덮지 않는 조합을 채운다.
 *
 * 기초 스터디의 `milestones-basic-intro`만 `canSubmit: true`다 — 서비스 어디에서도
 * "막히지 않은 제출 폼"에 도달할 수 없어 그 상태 자체를 검토할 수 없기 때문이다.
 * (`/programs/program-basic-study/milestones/milestones-basic-intro/submit`)
 */
export const SUBMISSION_FORMS: Readonly<Record<string, SubmissionFormData>> = {
  'program-capstone/milestones-approved': {
    applicationId: 'application-personal',
    applicationMode: 'PERSONAL',
    milestone: {
      id: 'milestones-approved',
      name: '기획서 제출',
      dueAt: '2026-07-15T23:59:59.000+09:00',
      dDay: -16,
      deadlineLabel: '마감 지남',
      submissionType: 'FILE',
      instructions: LOCAL_REVIEW_TEXT_INSTRUCTIONS,
    },
    existingSubmission: {
      id: 'submission-approved',
      status: 'APPROVED',
      checklistUrl: '/programs/program-capstone/submissions',
    },
    canSubmit: false,
    blockedReason: 'SUBMISSION_ALREADY_EXISTS',
  },
  'program-capstone/milestones-revision': {
    applicationId: 'application-personal',
    applicationMode: 'PERSONAL',
    milestone: {
      id: 'milestones-revision',
      name: '최종 결과 요약',
      dueAt: '2026-08-10T23:59:59.000+09:00',
      dDay: 10,
      deadlineLabel: 'D-10',
      submissionType: 'TEXT',
      instructions: LOCAL_REVIEW_TEXT_INSTRUCTIONS,
    },
    existingSubmission: {
      id: 'submission-revision',
      status: 'CHANGES_REQUESTED',
      checklistUrl:
        '/programs/program-capstone/submissions?milestoneId=milestones-revision',
    },
    canSubmit: false,
    blockedReason: 'SUBMISSION_ALREADY_EXISTS',
  },
  'program-oss-contest/milestones-overdue': {
    applicationId: 'application-team',
    applicationMode: 'TEAM',
    milestone: {
      id: 'milestones-overdue',
      name: '예선 결과물',
      dueAt: '2026-07-20T23:59:59.000+09:00',
      dDay: -11,
      deadlineLabel: '마감 지남',
      submissionType: 'TEXT',
      instructions: LOCAL_REVIEW_TEXT_INSTRUCTIONS,
    },
    existingSubmission: {
      id: 'submission-contest-revision',
      status: 'CHANGES_REQUESTED',
      checklistUrl:
        '/programs/program-oss-contest/submissions?milestoneId=milestones-overdue',
    },
    canSubmit: false,
    blockedReason: 'SUBMISSION_ALREADY_EXISTS',
  },
  'program-basic-study/milestones-basic-intro': {
    applicationId: 'synthetic-application-basic',
    applicationMode: 'PERSONAL',
    milestone: {
      id: 'milestones-basic-intro',
      name: '학습 회고 제출',
      dueAt: '2026-08-20T23:59:59.000+09:00',
      dDay: 19,
      deadlineLabel: 'D-19',
      submissionType: 'TEXT',
      instructions: LOCAL_REVIEW_TEXT_INSTRUCTIONS,
    },
    existingSubmission: null,
    canSubmit: true,
    blockedReason: null,
  },
  'program-basic-study/milestones-basic-final': {
    applicationId: 'synthetic-application-basic',
    applicationMode: 'PERSONAL',
    milestone: {
      id: 'milestones-basic-final',
      name: '최종 실습 결과',
      dueAt: '2026-09-10T23:59:59.000+09:00',
      dDay: 40,
      deadlineLabel: 'D-40',
      submissionType: 'FILE',
      instructions:
        '[로컬 검토용] 파일 제출 안내만 확인합니다. 로컬 검토 환경에서는 실제 업로드와 저장을 실행하지 않습니다.',
    },
    existingSubmission: null,
    canSubmit: false,
    blockedReason: 'FILE_UPLOAD_UNAVAILABLE',
  },
};

/**
 * 내 팀. 캡스톤은 팀이 있는 상태(명단 화면), 경진대회는 팀이 없는 상태(팀 만들기·
 * 참여코드 합류 화면)를 검토할 수 있도록 갈라 둔다.
 */
export const MY_TEAM_FIXTURES: Readonly<Record<string, ProgramTeam>> = {
  'program-capstone': {
    id: 'synthetic-team-capstone',
    name: '합성 캡스톤팀',
    memberCount: 3,
    minMembers: 2,
    maxMembers: 4,
    locked: true,
    isLeader: true,
    members: [
      {
        userId: 'synthetic-user-01',
        nickname: 'synthetic-contributor-01',
        name: '합성 팀장',
        isLeader: true,
      },
      {
        userId: 'synthetic-user-02',
        nickname: 'synthetic-contributor-02',
        name: '합성 팀원 A',
        isLeader: false,
      },
      {
        userId: 'synthetic-user-03',
        nickname: 'synthetic-contributor-03',
        name: null,
        isLeader: false,
      },
    ],
  },
};

/** 참여코드 합류 성공 응답. 화면이 이 값을 그대로 팀 명단으로 그린다. */
export const JOINED_TEAM_FIXTURE: ProgramTeam = {
  id: 'synthetic-team-joined',
  name: '합성 오픈소스팀',
  memberCount: 2,
  minMembers: 2,
  maxMembers: 4,
  locked: false,
  isLeader: false,
  members: [
    {
      userId: 'synthetic-user-03',
      nickname: 'synthetic-contributor-03',
      name: '합성 팀장',
      isLeader: true,
    },
    {
      userId: 'synthetic-user-05',
      nickname: 'synthetic-contributor-05',
      name: '합성 참여자',
      isLeader: false,
    },
  ],
};
