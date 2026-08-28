import type {
  MilestoneDocument,
  MilestoneDocumentSubmission,
  MilestoneDocumentTeamSubmissionCount,
  MilestoneDocumentViewerSubmission,
  UploadedMilestoneDocumentFile,
  UploadedMilestoneDocumentTemplate,
} from '@/features/programs/milestone-document-api';
import {
  MILESTONE_DOCUMENT_COLLECTION_PAGE_SIZE,
  type MilestoneDocumentCollection,
  type MilestoneDocumentCollectionCell,
  type MilestoneDocumentCollectionContent,
  type MilestoneDocumentCollectionDocument,
  type MilestoneDocumentCollectionFilter,
  type MilestoneDocumentCollectionHistory,
  type MilestoneDocumentHistoryPage,
  type MilestoneDocumentCollectionReview,
  type MilestoneDocumentCollectionRow,
} from '@/features/programs/milestone-document-collection-api';
import type {
  CreatedMilestoneDocumentReview,
  MilestoneDocumentReviewDecision,
} from '@/features/programs/milestone-document-review-api';
import type { SubmissionType } from '@/features/programs/types';
import { findStaffMilestoneContext } from './staff-program-fixtures';
import {
  PUBLIC_PROGRAM_IDS,
  programDetailFor,
} from './student-program-fixtures';

/**
 * `milestones/:milestoneId/documents` 픽스처. 마일스톤 id는 student-program-fixtures.ts의
 * 캡스톤·경진대회·기초 스터디 마일스톤과 같은 값을 쓴다 — 프로그램 상세 화면의
 * `viewerSubmissionStatus`(APPROVED·NOT_SUBMITTED·CHANGES_REQUESTED·null)와
 * 여기 `viewerSubmission.submitted`가 어긋나지 않아야 한다.
 *
 * 서류 개수는 program-overview-fixtures.ts의 `studentDocumentsCompleted/Total`과도
 * 맞춰 둔다(캡스톤 2/3, 경진대회 1/2, 기초 스터디 0/2).
 */
interface MilestoneDocumentSeed {
  readonly id: string;
  readonly milestoneId: string;
  readonly name: string;
  readonly required: boolean;
  readonly sortOrder: number;
  readonly submissionType: SubmissionType;
  readonly viewerSubmission: MilestoneDocumentViewerSubmission;
  readonly teamSubmissionCount: MilestoneDocumentTeamSubmissionCount;
}

/** 미제출 — 판정은 제출에 붙으므로 상태도 판정도 없다. */
const NOT_SUBMITTED_VIEWER: MilestoneDocumentViewerSubmission = {
  submitted: false,
  submittedAt: null,
  status: null,
  review: null,
};

/**
 * 제출한 학생이 보는 값. `status`는 student-program-fixtures.ts의
 * `viewerSubmissionStatus`와 **같은 값이어야 한다** — 프로그램 상세의 마일스톤 배지와
 * 그 아래 「제출 서류」 줄이 서로 다른 말을 하면 검토자가 화면 결함으로 읽는다.
 */
function submittedViewer(
  submittedAt: string,
  status: NonNullable<MilestoneDocumentViewerSubmission['status']>,
  review: MilestoneDocumentViewerSubmission['review'] = null,
): MilestoneDocumentViewerSubmission {
  return { submitted: true, submittedAt, status, review };
}

const MILESTONE_DOCUMENT_FIXTURES: Readonly<
  Record<string, readonly MilestoneDocumentSeed[]>
> = {
  'milestones-approved': [
    {
      id: 'synthetic-document-approved',
      milestoneId: 'milestones-approved',
      name: '기획서 제출',
      required: true,
      sortOrder: 1,
      submissionType: 'FILE',
      /*
       * student-program-fixtures.ts의 `viewerSubmissionStatus: 'APPROVED'`와 같은 값.
       *
       * **사유를 적은 승인**이다. 학생 화면은 승인 사유를 중립 톤 상자로 보여 주는데,
       * 여기가 학생 동선에서 유일한 승인 자리라 사유를 비워 두면 그 상자를 로컬 검토에서
       * 아무도 볼 수 없다(사유 없는 승인은 상자를 아예 세우지 않는 것이 규칙이다).
       * 승인에 붙은 사유가 반려처럼 빨갛게 보이지 않는지가 눈으로 확인할 자리다.
       *
       * 「사유 없이 저장되었습니다」 문구는 교직원 패널 쪽에 남아 있다 —
       * 아래 `COLLECTION_REVIEW_COMMENTS.APPROVED`가 `null`이다.
       */
      viewerSubmission: submittedViewer(
        '2026-07-14T09:00:00.000Z',
        'APPROVED',
        {
          comment:
            '잘 받았습니다. 기획 범위가 명확해서 그대로 진행하셔도 됩니다. 다음 단계는 팀별로 안내드릴게요.',
          reviewedAt: '2026-07-15T01:10:00.000Z',
        },
      ),
      // program-overview-fixtures.ts의 teamCount(47)를 기준으로 삼는다.
      teamSubmissionCount: { submitted: 44, total: 47 },
    },
  ],
  'milestones-upcoming': [
    {
      id: 'synthetic-document-upcoming',
      milestoneId: 'milestones-upcoming',
      name: '중간 보고',
      required: true,
      sortOrder: 1,
      submissionType: 'TEXT',
      viewerSubmission: NOT_SUBMITTED_VIEWER,
      teamSubmissionCount: { submitted: 18, total: 47 },
    },
  ],
  'milestones-revision': [
    {
      id: 'synthetic-document-revision',
      milestoneId: 'milestones-revision',
      name: '최종 결과 요약',
      required: true,
      sortOrder: 1,
      submissionType: 'FILE',
      // `viewerSubmissionStatus: 'CHANGES_REQUESTED'`와 같은 값 — 학생 화면의 경고 톤
      // 사유 상자와 「다시 낼 수 있다」가 함께 보이는 자리다.
      viewerSubmission: {
        ...submittedViewer('2026-07-30T16:20:00.000Z', 'CHANGES_REQUESTED', {
          comment: '실행 환경과 변경 내역을 보완해 다시 올려 주세요.',
          reviewedAt: '2026-07-31T02:40:00.000Z',
        }),
        revision: 2,
        history: [
          {
            event: 'SUBMITTED',
            revision: 1,
            actorNickname: '합성학생',
            comment: null,
            createdAt: '2026-07-28T08:10:00.000Z',
            fileName: 'final-summary-v1.pdf',
          },
          {
            event: 'CHANGES_REQUESTED',
            revision: 1,
            actorNickname: '합성담당자',
            comment: '실행 순서가 빠져 있습니다. 재현 단계를 추가해 주세요.',
            createdAt: '2026-07-29T01:30:00.000Z',
            fileName: null,
          },
          {
            event: 'RESUBMITTED',
            revision: 2,
            actorNickname: '합성학생',
            comment: null,
            createdAt: '2026-07-30T16:20:00.000Z',
            fileName: 'final-summary-v2.pdf',
          },
          {
            event: 'CHANGES_REQUESTED',
            revision: 2,
            actorNickname: '합성담당자',
            comment: '실행 환경과 변경 내역을 보완해 다시 올려 주세요.',
            createdAt: '2026-07-31T02:40:00.000Z',
            fileName: null,
          },
        ],
      },
      teamSubmissionCount: { submitted: 30, total: 47 },
    },
  ],
  'milestones-overdue': [
    {
      id: 'synthetic-document-overdue',
      milestoneId: 'milestones-overdue',
      name: '예선 결과물',
      required: true,
      sortOrder: 1,
      submissionType: 'TEXT',
      viewerSubmission: submittedViewer(
        '2026-07-29T14:10:00.000Z',
        'CHANGES_REQUESTED',
        {
          comment: '재현 순서와 테스트 결과를 보완해 다시 올려 주세요.',
          reviewedAt: '2026-07-30T05:05:00.000Z',
        },
      ),
      teamSubmissionCount: { submitted: 6, total: 8 },
    },
  ],
  'milestones-contest-final': [
    {
      id: 'synthetic-document-contest-final',
      milestoneId: 'milestones-contest-final',
      name: '본선 발표 자료',
      required: true,
      sortOrder: 1,
      submissionType: 'FILE',
      viewerSubmission: NOT_SUBMITTED_VIEWER,
      teamSubmissionCount: { submitted: 2, total: 8 },
    },
  ],
  'milestones-basic-intro': [
    {
      id: 'synthetic-document-basic-intro',
      milestoneId: 'milestones-basic-intro',
      name: '학습 회고 제출',
      required: true,
      sortOrder: 1,
      submissionType: 'TEXT',
      viewerSubmission: NOT_SUBMITTED_VIEWER,
      teamSubmissionCount: { submitted: 1, total: 3 },
    },
  ],
  'milestones-basic-final': [
    {
      id: 'synthetic-document-basic-final',
      milestoneId: 'milestones-basic-final',
      name: '최종 실습 결과',
      required: true,
      sortOrder: 1,
      submissionType: 'FILE',
      viewerSubmission: NOT_SUBMITTED_VIEWER,
      teamSubmissionCount: { submitted: 0, total: 3 },
    },
  ],
  // ── 교직원 편집·수합 화면용 ──
  // 위 항목들은 학생 화면(student-program-fixtures.ts)의 마일스톤 id를 쓴다. 교직원
  // 편집 화면은 staff-program-fixtures.ts의 다른 마일스톤을 보므로 시드가 없어
  // 「제출 항목」과 수합 표가 로컬 검토에서 조회 실패로만 보였다. 여기부터가 그 공백이다.
  // 한 마일스톤에 여러 장을 둬야 순서 바꾸기와 「미제출 있는 팀 / 한 장도 안 낸 팀」 필터가
  // 실제로 갈린다 — 한 장짜리 마일스톤에서는 두 필터가 늘 같은 수를 낸다.
  'milestone-basic-orientation': [
    {
      id: 'synthetic-document-orientation-plan',
      milestoneId: 'milestone-basic-orientation',
      name: '합성 학습 계획서',
      required: true,
      sortOrder: 1,
      submissionType: 'FILE',
      /*
       * 반려 갈래. 이 마일스톤은 staff-program-fixtures.ts 소유라 학생 동선의
       * `viewerSubmissionStatus`와 대조할 짝이 없다 — 그래서 학생 화면의 「반려 →
       * 제출 입력을 열지 않는다」를 여기서 세운다.
       *
       * 한계: 로컬 검토의 학생 페르소나는 이 프로그램에 들어갈 길이 없어 화면으로는
       * 잘 보이지 않는다. 학생 화면에서 눈으로 볼 수 있는 것은 승인(캡스톤 기획서)과
       * 보완 요청(최종 결과 요약·예선 결과물)이고, 검토 대기는 보완 요청 항목을 다시
       * 제출해 보면 그 자리에서 바뀐다.
       */
      viewerSubmission: submittedViewer(
        '2026-05-10T02:20:00.000Z',
        'REJECTED',
        {
          comment:
            '학습 계획서 양식이 지난 학기 것입니다. 이번 학기 양식으로는 다시 받지 않습니다.',
          reviewedAt: '2026-05-12T00:30:00.000Z',
        },
      ),
      teamSubmissionCount: { submitted: 2, total: 3 },
    },
    {
      id: 'synthetic-document-orientation-pledge',
      milestoneId: 'milestone-basic-orientation',
      name: '합성 참여 서약서',
      required: true,
      sortOrder: 2,
      submissionType: 'FILE',
      viewerSubmission: NOT_SUBMITTED_VIEWER,
      teamSubmissionCount: { submitted: 1, total: 3 },
    },
    {
      id: 'synthetic-document-orientation-note',
      milestoneId: 'milestone-basic-orientation',
      name: '합성 회고 메모',
      required: false,
      sortOrder: 3,
      submissionType: 'TEXT',
      viewerSubmission: NOT_SUBMITTED_VIEWER,
      /*
       * 두 팀이 낸 것으로 둔다. 이 표의 제출된 칸이 다섯이 되어야 아래
       * `COLLECTION_CELL_STATE_CYCLE`의 다섯 갈래가 한 표에 다 나온다 — 넷이면
       * 「다시 낸 뒤 검토 대기」가 어디에도 보이지 않는다.
       *
       * 선택 서류라 이 수를 올려도 「필수 서류 미제출」은 그대로 2팀이다(둘째 팀은
       * 여전히 필수인 참여 서약서가 빈다) — 두 필터가 갈리는 성질을 지키려고 필수가
       * 아닌 쪽을 골랐다.
       */
      teamSubmissionCount: { submitted: 2, total: 3 },
    },
    {
      id: 'synthetic-document-orientation-summary',
      milestoneId: 'milestone-basic-orientation',
      name: '합성 사전 요약',
      required: false,
      sortOrder: 4,
      submissionType: 'TEXT',
      viewerSubmission: NOT_SUBMITTED_VIEWER,
      /*
       * 글 제출 칸을 하나 더 둬 파일과 글 본문을 각각 로컬 검토로 확인한다.
       *
       * 선택 서류에 위 회고 메모와 같은 제출 팀 수를 둔 것은 필터 두 개의 수를
       * 건드리지 않기 위해서다: 「필수 서류 미제출」은 여전히 2팀(필수는 계획서·서약서
       * 둘뿐), 「한 장도 안 낸 팀」도 여전히 3팀만 비어 1팀이다.
       */
      teamSubmissionCount: { submitted: 2, total: 3 },
    },
  ],
  'milestone-basic-final': [
    {
      id: 'synthetic-document-final-report',
      milestoneId: 'milestone-basic-final',
      name: '합성 결과 보고서',
      required: true,
      sortOrder: 1,
      submissionType: 'FILE',
      viewerSubmission: NOT_SUBMITTED_VIEWER,
      teamSubmissionCount: { submitted: 1, total: 3 },
    },
    {
      id: 'synthetic-document-final-summary',
      milestoneId: 'milestone-basic-final',
      name: '합성 결과 요약',
      required: false,
      sortOrder: 2,
      submissionType: 'TEXT',
      viewerSubmission: NOT_SUBMITTED_VIEWER,
      teamSubmissionCount: { submitted: 0, total: 3 },
    },
  ],
};

/** `milestoneId`가 픽스처에 없으면 `null` — 호출부가 404(MSD_003)로 갈리게 한다. */
export function milestoneDocumentsFor(
  milestoneId: string,
  role: 'STUDENT' | 'STAFF' | 'ADMIN',
): readonly MilestoneDocument[] | null {
  const seeds = MILESTONE_DOCUMENT_FIXTURES[milestoneId];
  if (seeds === undefined) return null;
  const isStudent = role === 'STUDENT';
  return seeds.map((seed) => ({
    id: seed.id,
    milestoneId: seed.milestoneId,
    name: seed.name,
    required: seed.required,
    sortOrder: seed.sortOrder,
    submissionType: seed.submissionType,
    templateFileName: null,
    // 로컬 검토 응답 계약은 바이너리를 표현할 수 없어 양식 다운로드를 흉내 낼 수
    // 없다 — 항상 false로 둬 다운로드 버튼이 뜨지 않게 한다(handlers 파일 주석 참고).
    hasTemplateFile: false,
    viewerSubmission: isStudent ? seed.viewerSubmission : undefined,
    teamSubmissionCount: isStudent ? undefined : seed.teamSubmissionCount,
  }));
}

export function isKnownMilestoneId(milestoneId: string): boolean {
  return milestoneId in MILESTONE_DOCUMENT_FIXTURES;
}

/** `student-handlers.ts`의 `submission-files` 응답과 같은 패턴 — 본문은 무시하고 고정 값을 준다. */
export const UPLOADED_MILESTONE_DOCUMENT_FILE_FIXTURE: UploadedMilestoneDocumentFile =
  {
    fileId: 'synthetic-milestone-document-file-01',
    fileName: 'synthetic-submission.pdf',
    contentType: 'application/pdf',
    size: 20_480,
    expiresAt: '2026-08-01T01:00:00.000Z',
  };

export function uploadedMilestoneDocumentTemplateFor(
  documentId: string,
): UploadedMilestoneDocumentTemplate {
  return {
    documentId,
    hasTemplateFile: true,
    fileName: 'synthetic-template.pdf',
    uploadedAt: '2026-07-25T00:00:00.000Z',
  };
}

export function milestoneDocumentSubmissionFor(
  documentId: string,
): MilestoneDocumentSubmission {
  return {
    id: `synthetic-submission-${documentId}`,
    status: 'SUBMITTED',
    submittedAt: '2026-08-01T00:00:00.000Z',
  };
}

/**
 * `POST .../applications/:applicationId/reviews` 201 응답 — 방금 저장한 판정 한 건.
 *
 * 한계: 저장되지 않는다. 화면은 저장 뒤 표를 다시 부르는데 그 표는 위 시드 그대로라
 * **방금 누른 판정이 칸에 반영되지 않는다**. 로컬 검토에서 확인할 수 있는 것은 「보냈다,
 * 패널이 닫혔다, 표를 다시 불렀다」까지이고, 칸의 배지가 바뀌는지는 실제 백엔드에서 본다.
 * 다른 조작 핸들러(서류 생성·순서 바꾸기)와 같은 한계다.
 */
export function createdMilestoneDocumentReviewFor(
  documentId: string,
  applicationId: string,
  decision: MilestoneDocumentReviewDecision,
  comment: string | null,
): CreatedMilestoneDocumentReview {
  return {
    id: `synthetic-review-${documentId}-${applicationId}`,
    decision,
    comment,
    reviewedAt: '2026-08-01T02:00:00.000Z',
    reviewerNickname: '합성 교직원',
  };
}

/**
 * `milestones/:milestoneId/documents/collection` 픽스처 — 교직원 서류 수합 표.
 *
 * **새 수치를 만들지 않는다.** 열(서류)은 위 `MILESTONE_DOCUMENT_FIXTURES`를 그대로
 * 쓰고, 행(팀)은 그 시드의 `teamSubmissionCount`에서 파생한다 — 팀 수는 `total`,
 * 제출한 팀 수는 `submitted`다. 그래서 이 표의 합계는 프로그램 상세의
 * 「N/M팀 제출」과 언제나 같은 수가 되고, program-overview-fixtures.ts와 맞춰 둔
 * 서류 개수(캡스톤 2/3 · 경진대회 1/2 · 기초 스터디 0/2)도 건드리지 않는다.
 *
 * 한계: 지금 시드는 마일스톤마다 서류가 한 항목뿐이라, 이 화면에서 「미제출 있는
 * 팀」과 「한 장도 안 낸 팀」의 수가 늘 같게 나온다. 항목을 늘리면 위의 서류 개수
 * 정합이 깨지므로 여기서 늘리지 않는다 — 두 필터가 갈리는 경우는 화면 쪽 단위
 * 테스트(`milestone-document-collection.test.ts`)가 덮는다.
 */
const COLLECTION_MEMBER_SIZE_CYCLE = [1, 2, 3] as const;

/** 제출 시각을 팀마다 한 시간씩 벌려 표에서 서로 다른 값이 보이게 한다. */
const COLLECTION_SUBMITTED_AT_BASE = Date.parse(
  '2026-07-28T09:00:00.000+09:00',
);

/**
 * 제출된 칸 하나의 시드 — 지금 상태와 거기 남은 지난 판정.
 *
 * 둘을 따로 두는 것이 이 시드의 요점이다. 칸의 배지는 `status`가 정하고 `review`는 지난
 * 지적일 뿐이라, **둘이 갈리는 칸**이 없으면 배지를 다시 `review.decision` 기준으로
 * 되돌려도 로컬 검토에서는 아무 차이가 보이지 않는다.
 */
interface CollectionCellStateSeed {
  readonly status: NonNullable<MilestoneDocumentCollectionCell['status']>;
  /** 이 칸에 남은 최신 판정. 아직 아무도 안 봤으면 `null`. */
  readonly decision: MilestoneDocumentReviewDecision | null;
}

/**
 * 제출된 칸이 도는 다섯 갈래. **검토 대기가 먼저이고, 다시 낸 칸이 마지막이다.**
 *
 * - 앞의 넷은 화면의 네 배지다(검토 대기 · 승인 · 보완 요청 · 반려). 검토 대기가 없으면
 *   검토자가 「아직 아무도 안 본 칸」의 배지를 한 번도 보지 못한다.
 * - 마지막은 **보완 요청을 받고 다시 낸 칸**이다. 서버가 제출 상태만 `SUBMITTED`로
 *   되돌리고 판정 기록은 그대로 두므로, 배지는 「검토 대기」이고 패널을 열면 지난
 *   「보완 요청」 사유가 남아 있다 — 교직원이 다시 볼 건이 어떻게 보이는지가 이 자리다.
 */
const COLLECTION_CELL_STATE_CYCLE: readonly CollectionCellStateSeed[] = [
  { status: 'SUBMITTED', decision: null },
  { status: 'APPROVED', decision: 'APPROVED' },
  { status: 'CHANGES_REQUESTED', decision: 'CHANGES_REQUESTED' },
  { status: 'REJECTED', decision: 'REJECTED' },
  { status: 'SUBMITTED', decision: 'CHANGES_REQUESTED' },
];

const COLLECTION_REVIEW_COMMENTS: Readonly<
  Record<MilestoneDocumentReviewDecision, string | null>
> = {
  // 승인은 사유가 선택이다 — 비운 결과도 화면에 나와야 「사유 없이 저장되었습니다」가
  // 눈으로 확인된다.
  APPROVED: null,
  CHANGES_REQUESTED:
    '표지의 제출자 이름과 신청서의 팀원 명단이 다릅니다. 맞춰서 다시 올려 주세요.',
  REJECTED: '제출 기한을 두 주 넘겼고 연장 신청도 없었습니다.',
};

/**
 * 이 칸이 표 전체에서 **몇 번째 제출인가**. 미제출 칸은 세지 않는다.
 *
 * 갈래를 이 번호로 돌리는 이유: `행 × 열` 통번호로 돌리면 중간에 미제출 칸이 끼는 만큼
 * 번호가 건너뛰어, 표 모양에 따라 같은 갈래가 두 번 나오고 어떤 갈래는 한 번도 안 나온다
 * (`milestone-basic-orientation`이 정확히 그 모양이다). 제출된 칸만 세면 **표에 제출이
 * 다섯 칸만 있어도 다섯 갈래가 다 나온다** — 검토자가 한 표에서 다 볼 수 있어야 한다는
 * 것이 이 시드의 목적이다.
 */
function submittedCellOrdinal(
  seeds: readonly MilestoneDocumentSeed[],
  rowIndex: number,
  documentIndex: number,
): number {
  // 앞선 행들에서 제출된 칸 수 — 열마다 「이 행보다 앞에서 낸 팀 수」를 더한다.
  const beforeRows = seeds.reduce(
    (sum, seed) => sum + Math.min(rowIndex, seed.teamSubmissionCount.submitted),
    0,
  );
  const beforeCells = seeds
    .slice(0, documentIndex)
    .filter((seed) => rowIndex < seed.teamSubmissionCount.submitted).length;
  return beforeRows + beforeCells;
}

/**
 * 칸에 붙는 최신 판정. 판정 시각은 제출 시각보다 뒤여야 한다 — 앞서면 「내기 전에
 * 판정했다」로 읽혀 검토자가 화면 결함으로 오해한다.
 *
 * ⚠ **다시 낸 칸만 반대다.** 상태가 `SUBMITTED`로 돌아왔는데 판정이 남아 있다는 것은
 * 학생이 그 지적을 받고 **그 뒤에** 다시 냈다는 뜻이라, 지난 판정은 지금 제출보다
 * 앞선다. 여기서도 뒤로 적으면 「낸 뒤에 판정했는데 아직 검토 대기」라는, 있을 수 없는
 * 칸이 된다.
 */
function collectionReviewFor(
  state: CollectionCellStateSeed,
  submittedAt: string,
  /**
   * 판정 요청의 `expectedLatestReviewId`로 되돌아오는 값이다. 칸마다 달라야 뜻이 있다 —
   * 모든 칸에 같은 id를 주면 남의 칸 판정을 들고 와도 대조를 통과한다.
   */
  id: string,
): MilestoneDocumentCollectionReview | null {
  if (state.decision === null) return null;
  const resubmitted = state.status === 'SUBMITTED';
  return {
    id,
    decision: state.decision,
    comment: COLLECTION_REVIEW_COMMENTS[state.decision],
    reviewedAt: new Date(
      Date.parse(submittedAt) + (resubmitted ? -26 : 26) * 3_600_000,
    ).toISOString(),
  };
}

/**
 * 이 칸이 몇 번째 제출본인가. 판정 요청의 `expectedRevision`으로 되돌아오는 값이다.
 *
 * 지난 판정이 남아 있는데 상태가 `SUBMITTED`로 돌아온 칸은 **다시 낸 칸**이라 제출이
 * 두 번 있었다(`collectionReviewFor`가 판정 시각을 제출보다 앞으로 적는 것과 같은 근거).
 * 나머지는 첫 제출 그대로다.
 */
function collectionRevisionFor(state: CollectionCellStateSeed): number {
  return state.status === 'SUBMITTED' && state.decision !== null ? 2 : 1;
}

function collectionHistoryFor(
  state: CollectionCellStateSeed,
  submittedAt: string,
  teamNumber: number,
  fileName: string | null,
): readonly MilestoneDocumentCollectionHistory[] {
  if (state.decision === null) {
    return [
      {
        event: 'SUBMITTED',
        revision: 1,
        actorNickname: `synthetic-${teamNumber}-1`,
        comment: null,
        createdAt: submittedAt,
        fileName,
      },
    ];
  }

  const isResubmitted = state.status === 'SUBMITTED';
  const review = collectionReviewFor(
    state,
    submittedAt,
    `synthetic-history-review-${teamNumber}`,
  );
  if (review === null) return [];

  const firstSubmittedAt = isResubmitted
    ? new Date(Date.parse(review.reviewedAt) - 26 * 3_600_000).toISOString()
    : submittedAt;
  const history: MilestoneDocumentCollectionHistory[] = [
    {
      event: 'SUBMITTED',
      revision: 1,
      actorNickname: `synthetic-${teamNumber}-1`,
      comment: null,
      createdAt: firstSubmittedAt,
      fileName,
    },
    {
      event: review.decision,
      revision: 1,
      actorNickname: 'synthetic-staff',
      comment: review.comment,
      createdAt: review.reviewedAt,
      fileName: null,
    },
  ];
  if (isResubmitted) {
    history.push({
      event: 'RESUBMITTED',
      revision: 2,
      actorNickname: `synthetic-${teamNumber}-1`,
      comment: null,
      createdAt: submittedAt,
      fileName,
    });
  }
  return history;
}

/**
 * 학생이 낸 **본문**. 파일 제출에는 없다(`null`) — 파일은 칸의 `file`이 담당한다.
 *
 * 이 값이 없으면 로컬 검토에서 판정 패널이 언제나 파일만 보여 주고 글 내용을
 * 못 보고 판정하는 결함이 화면에 재현되지 않는다.
 *
 * 글은 **여러 줄로** 적는다. 줄바꿈을 보존하는지, 길어졌을 때 패널 안에서 스크롤되는지가
 * 눈으로 확인할 자리이고, 한 줄짜리 시드로는 둘 다 확인되지 않는다.
 */
function collectionContentFor(
  seed: MilestoneDocumentSeed,
  teamNumber: number,
): MilestoneDocumentCollectionContent | null {
  switch (seed.submissionType) {
    case 'FILE':
      return null;
    case 'TEXT':
      return {
        type: 'TEXT',
        text: [
          `[합성 ${teamNumber}팀 회고 메모]`,
          '',
          '1. 이번 주에 한 일',
          '- 오리엔테이션 자료를 읽고 개발 환경을 맞췄습니다.',
          '- 저장소를 만들고 첫 이슈 세 건을 등록했습니다.',
          '',
          '2. 막힌 곳',
          '- 빌드가 로컬에서만 실패해 원인을 아직 찾지 못했습니다.',
          '  같은 설정을 쓰는 팀원 화면에서는 그대로 통과합니다.',
          '',
          '3. 다음 주 계획',
          '- 실패하는 빌드부터 재현 순서를 정리해 공유하겠습니다.',
          '- 남은 이슈를 팀원과 나눠 맡겠습니다.',
          '',
          '(이 아래는 긴 글이 패널 안에서 스크롤되는지 확인하려고 늘려 둔 부분입니다.)',
          ...Array.from(
            { length: 12 },
            (_, line) =>
              `${line + 1}. 합성 회고 문장입니다. 판정 화면이 원문을 자르지 않고 그대로 보여 주는지 확인합니다.`,
          ),
        ].join('\n'),
      };
  }
}

/**
 * 마일스톤 이름·마감은 student-program-fixtures.ts와 staff-program-fixtures.ts가 원본이다
 * — 여기서 베끼지 않는다. 두 곳을 다 보는 이유는 교직원이 수합 표에 들어오는 길이 둘이기
 * 때문이다: 학생도 보는 프로그램 상세의 마일스톤 행, 그리고 교직원 전용 편집 화면의
 * 마일스톤. 뒤쪽만 빠뜨리면 편집 화면에서 방금 서류를 등록한 마일스톤의 수합 표가
 * 조회 실패로만 보인다.
 */
function collectionMilestoneContext(milestoneId: string): {
  readonly programId: string;
  readonly name: string;
  readonly dueAt: string;
} | null {
  for (const programId of PUBLIC_PROGRAM_IDS) {
    const found = programDetailFor(programId, 'STAFF').milestones.find(
      (milestone) => milestone.id === milestoneId,
    );
    if (found !== undefined) {
      return { programId, name: found.name, dueAt: found.dueAt };
    }
  }
  const staffMilestone = findStaffMilestoneContext(milestoneId);
  return staffMilestone === null
    ? null
    : {
        programId: staffMilestone.programId,
        name: staffMilestone.milestone.name,
        dueAt: staffMilestone.milestone.dueAt,
      };
}

function collectionRowFor(
  seeds: readonly MilestoneDocumentSeed[],
  index: number,
): MilestoneDocumentCollectionRow {
  const teamNumber = index + 1;
  // 두 번째 팀은 프로필 미작성(신청자 이름 없음 → GitHub 계정으로 대체), 세 번째
  // 팀은 계정 표기도 없는 경우다(팀 이름만 남는다). 화면의 세 갈래를 검토자가
  // 한 표에서 다 볼 수 있게 일부러 섞어 둔다.
  const profileless = index === 1;
  const nameless = index === 2;
  const memberNicknames = nameless
    ? []
    : Array.from(
        {
          length: COLLECTION_MEMBER_SIZE_CYCLE[
            index % COLLECTION_MEMBER_SIZE_CYCLE.length
          ] as number,
        },
        (_, member) => `synthetic-${teamNumber}-${member + 1}`,
      );
  const submittedAt = new Date(
    COLLECTION_SUBMITTED_AT_BASE + index * 3_600_000,
  ).toISOString();

  return {
    applicationId: `synthetic-application-${seeds[0]?.milestoneId ?? 'unknown'}-${teamNumber}`,
    teamName: `합성 ${teamNumber}팀`,
    applicantName: profileless || nameless ? null : `합성 참여자 ${teamNumber}`,
    memberNicknames,
    cells: seeds.map((seed, documentIndex) => {
      const isSubmitted = index < seed.teamSubmissionCount.submitted;
      if (!isSubmitted) {
        return {
          documentId: seed.id,
          isSubmitted: false,
          // 상태도 판정도 제출에 붙는다 — 미제출 칸에는 둘 다 실리지 않는다(백엔드 계약).
          status: null,
          // 제출본 번호도 제출에 붙는다. 여기에 숫자를 넣으면 미제출 칸에서도 판정
          // 요청이 만들어져, 실제 백엔드에서만 실패하는 화면이 로컬에서 멀쩡해 보인다.
          revision: null,
          submittedAt: null,
          file: null,
          // 본문도 제출에 붙는다 — 미제출 칸에는 보여 줄 내용이 없다(백엔드 계약).
          content: null,
          review: null,
        };
      }
      const state = COLLECTION_CELL_STATE_CYCLE[
        submittedCellOrdinal(seeds, index, documentIndex) %
          COLLECTION_CELL_STATE_CYCLE.length
      ] as CollectionCellStateSeed;
      // FILE 유형이어도 보존 기한이 지난 첨부는 `file`이 비어 온다(백엔드 계약).
      // 첫 팀을 그 갈래로 둬 "제출됨(링크 없음)" 표시가 검토 화면에 실제로 뜨게 한다.
      const expired = index === 0;
      const fileName =
        seed.submissionType === 'FILE'
          ? profileless
            ? `합성-${seed.name}-아주-긴-파일-이름-확인용-${teamNumber}팀-최종본.pdf`
            : `합성-${seed.name}-${teamNumber}팀.pdf`
          : null;
      return {
        documentId: seed.id,
        isSubmitted: true,
        status: state.status,
        /*
         * 제출본 번호. **다시 낸 칸만 2**다 — 지난 판정이 남아 있는데 상태가
         * `SUBMITTED`로 돌아온 칸이 곧 「보완 요청을 받고 다시 냈다」이고, 그 칸만
         * 제출이 두 번 있었다. 전부 1로 두면 판정 요청에 실리는 값이 칸마다 같아져,
         * 남의 칸 값을 들고 와도 대조를 통과한다(칸마다 다른 `review.id`를 준 것과 같은 이유).
         */
        revision: collectionRevisionFor(state),
        submittedAt,
        file:
          fileName !== null && !expired
            ? {
                // 두 번째 팀은 파일명이 길다 — 열 폭을 밀지 않고 잘리는지, 잘린
                // 이름의 전체가 title로 남는지 눈으로 확인할 자리다.
                name: fileName,
                sizeBytes: 245_760 + index * 1024,
              }
            : null,
        content: collectionContentFor(seed, teamNumber),
        review: collectionReviewFor(
          state,
          submittedAt,
          `synthetic-review-${seed.id}-${teamNumber}`,
        ),
        history: collectionHistoryFor(state, submittedAt, teamNumber, fileName),
      };
    }),
  };
}

/**
 * 필터 판정 — 백엔드 `milestone-document-collection-response.dto.ts`의
 * `hasMissingRequired`·`hasZeroSubmission`과 같은 규칙이다.
 *
 * ⚠ `HAS_MISSING`은 **필수 서류만** 센다. 선택 서류를 안 낸 팀은 걸리지 않는다 —
 * 여기서 규칙을 느슨하게 두면 화면이 서버와 다른 수를 보여 주고, 그 차이는 실제
 * 백엔드에 붙였을 때에야 드러난다.
 *
 * ⚠ 필수 여부를 보는 필드는 수합 표 계약의 `isRequired`다. 시드의 `required`(목록 조회
 * 계약)를 그대로 보면 `undefined`가 되어 **아무 팀도 안 걸리는데 오류는 나지 않는다**.
 */
function collectionRowMatchesFilter(
  row: MilestoneDocumentCollectionRow,
  documents: readonly MilestoneDocumentCollectionDocument[],
  filter: MilestoneDocumentCollectionFilter,
): boolean {
  switch (filter) {
    case 'HAS_MISSING':
      return documents.some(
        (document, index) =>
          document.isRequired && row.cells[index]?.isSubmitted !== true,
      );
    case 'ZERO_SUBMISSION':
      return (
        documents.length > 0 && row.cells.every((cell) => !cell.isSubmitted)
      );
    case 'ALL':
      return true;
  }
}

export interface MilestoneDocumentCollectionFixtureQuery {
  readonly page: number;
  readonly pageSize: number;
  readonly filter: MilestoneDocumentCollectionFilter;
}

export const MILESTONE_DOCUMENT_COLLECTION_FIXTURE_DEFAULT_QUERY: MilestoneDocumentCollectionFixtureQuery =
  {
    page: 1,
    pageSize: MILESTONE_DOCUMENT_COLLECTION_PAGE_SIZE,
    filter: 'ALL',
  };

/**
 * `milestoneId`가 픽스처에 없으면 `null` — 호출부가 404(MSD_003)로 갈리게 한다.
 *
 * 집계 두 필드(`filterCounts`·`documentTotals`)는 **필터·페이지 이전의 전체 행**으로
 * 낸다. `total`만 필터 적용 후 행 수다. 백엔드 DTO가 그렇게 갈라 두었고, 여기서 다르게
 * 세면 로컬 검토에서만 맞는 화면이 만들어진다.
 */
export function milestoneDocumentCollectionFor(
  milestoneId: string,
  query: MilestoneDocumentCollectionFixtureQuery = MILESTONE_DOCUMENT_COLLECTION_FIXTURE_DEFAULT_QUERY,
): MilestoneDocumentCollection | null {
  const seeds = MILESTONE_DOCUMENT_FIXTURES[milestoneId];
  const context = collectionMilestoneContext(milestoneId);
  if (seeds === undefined || context === null) return null;
  const teamCount = seeds[0]?.teamSubmissionCount.total ?? 0;
  const documents: readonly MilestoneDocumentCollectionDocument[] = seeds.map(
    (seed) => ({
      id: seed.id,
      name: seed.name,
      // 시드의 `required`는 목록 조회 계약(`MilestoneDocument`)의 이름이고, 수합 표
      // 응답은 `isRequired`다 — 한 시드에서 두 계약으로 갈라져 나가는 자리다.
      isRequired: seed.required,
      sortOrder: seed.sortOrder,
      submissionType: seed.submissionType,
    }),
  );
  const allRows = Array.from({ length: teamCount }, (_, index) =>
    collectionRowFor(seeds, index),
  );
  const filtered = allRows.filter((row) =>
    collectionRowMatchesFilter(row, documents, query.filter),
  );
  const offset = (query.page - 1) * query.pageSize;

  return {
    milestone: {
      id: milestoneId,
      // 소유 프로그램을 그대로 싣는다 — 화면이 경로의 programId와 대조하므로 여기서
      // 지어내면 로컬 검토에서 어긋난 주소가 걸리지 않는다.
      programId: context.programId,
      name: context.name,
      dueAt: new Date(context.dueAt).toISOString(),
    },
    documents,
    rows: filtered.slice(offset, offset + query.pageSize),
    page: query.page,
    pageSize: query.pageSize,
    total: filtered.length,
    filterCounts: {
      all: allRows.length,
      hasMissing: allRows.filter((row) =>
        collectionRowMatchesFilter(row, documents, 'HAS_MISSING'),
      ).length,
      zeroSubmission: allRows.filter((row) =>
        collectionRowMatchesFilter(row, documents, 'ZERO_SUBMISSION'),
      ).length,
    },
    documentTotals: documents.map((document, index) => ({
      documentId: document.id,
      submitted: allRows.filter((row) => row.cells[index]?.isSubmitted === true)
        .length,
      total: allRows.length,
    })),
  };
}

/**
 * 교직원 판정 패널의 분리된 이력 조회 응답.
 *
 * 수합 표 픽스처는 전환기 화면도 검토할 수 있도록 칸 안에 이력을 함께 보관하지만,
 * 실제 API는 표와 이력을 분리한다. 이 함수가 그 시드에서 선택한 한 칸만 꺼내 새
 * `.../history` 계약으로 돌려줘 로컬 검토도 운영과 같은 요청 순서를 타게 한다.
 */
export function milestoneDocumentHistoryFor(
  milestoneId: string,
  documentId: string,
  applicationId: string,
): MilestoneDocumentHistoryPage | null {
  const collection = milestoneDocumentCollectionFor(milestoneId, {
    page: 1,
    pageSize: 1_000,
    filter: 'ALL',
  });
  if (collection === null) return null;
  const row = collection.rows.find(
    (candidate) => candidate.applicationId === applicationId,
  );
  const cell = row?.cells.find(
    (candidate) => candidate.documentId === documentId,
  );
  if (cell === undefined || !cell.isSubmitted) return null;
  return {
    items: cell.history ?? [],
    nextCursor: null,
  };
}

/**
 * `PATCH .../documents/order` 응답 — 받은 순서 그대로 sortOrder를 1부터 다시 매긴다.
 * 한계: 저장되지 않아 화면을 다시 열면 원래 순서로 돌아온다(다른 조작 핸들러와 같다).
 * 픽스처에 없는 id가 섞여 오면 `null`을 돌려 호출부가 400(MSD_019)으로 갈리게 한다.
 */
export function reorderedMilestoneDocumentsFor(
  milestoneId: string,
  documentIds: readonly string[],
): readonly MilestoneDocument[] | null {
  const documents = milestoneDocumentsFor(milestoneId, 'STAFF');
  if (documents === null) return null;
  const byId = new Map(documents.map((document) => [document.id, document]));
  if (
    documentIds.length !== documents.length ||
    new Set(documentIds).size !== documentIds.length ||
    documentIds.some((id) => !byId.has(id))
  ) {
    return null;
  }
  return documentIds.map((id, index) => ({
    ...(byId.get(id) as MilestoneDocument),
    sortOrder: index + 1,
  }));
}
