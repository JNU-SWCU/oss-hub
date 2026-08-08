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
  type MilestoneDocumentCollectionDocument,
  type MilestoneDocumentCollectionFilter,
  type MilestoneDocumentCollectionRow,
} from '@/features/programs/milestone-document-collection-api';
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
      viewerSubmission: {
        submitted: true,
        submittedAt: '2026-07-14T09:00:00.000Z',
      },
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
      viewerSubmission: { submitted: false, submittedAt: null },
      teamSubmissionCount: { submitted: 18, total: 47 },
    },
  ],
  'milestones-revision': [
    {
      id: 'synthetic-document-revision',
      milestoneId: 'milestones-revision',
      name: '최종 릴리스',
      required: true,
      sortOrder: 1,
      submissionType: 'REPOSITORY_RELEASE',
      viewerSubmission: {
        submitted: true,
        submittedAt: '2026-07-30T16:20:00.000Z',
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
      submissionType: 'REPOSITORY_RELEASE',
      viewerSubmission: {
        submitted: true,
        submittedAt: '2026-07-29T14:10:00.000Z',
      },
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
      viewerSubmission: { submitted: false, submittedAt: null },
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
      viewerSubmission: { submitted: false, submittedAt: null },
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
      viewerSubmission: { submitted: false, submittedAt: null },
      teamSubmissionCount: { submitted: 0, total: 3 },
    },
  ],
  // ── 교직원 편집·수합 화면용 ──
  // 위 항목들은 학생 화면(student-program-fixtures.ts)의 마일스톤 id를 쓴다. 교직원
  // 편집 화면은 staff-program-fixtures.ts의 다른 마일스톤을 보므로 시드가 없어
  // 「받을 서류」와 수합 표가 로컬 검토에서 조회 실패로만 보였다. 여기부터가 그 공백이다.
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
      viewerSubmission: {
        submitted: true,
        submittedAt: '2026-05-10T02:20:00.000Z',
      },
      teamSubmissionCount: { submitted: 2, total: 3 },
    },
    {
      id: 'synthetic-document-orientation-pledge',
      milestoneId: 'milestone-basic-orientation',
      name: '합성 참여 서약서',
      required: true,
      sortOrder: 2,
      submissionType: 'FILE',
      viewerSubmission: { submitted: false, submittedAt: null },
      teamSubmissionCount: { submitted: 1, total: 3 },
    },
    {
      id: 'synthetic-document-orientation-note',
      milestoneId: 'milestone-basic-orientation',
      name: '합성 회고 메모',
      required: false,
      sortOrder: 3,
      submissionType: 'TEXT',
      viewerSubmission: { submitted: false, submittedAt: null },
      teamSubmissionCount: { submitted: 1, total: 3 },
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
      viewerSubmission: { submitted: false, submittedAt: null },
      teamSubmissionCount: { submitted: 1, total: 3 },
    },
    {
      id: 'synthetic-document-final-release',
      milestoneId: 'milestone-basic-final',
      name: '합성 릴리스 주소',
      required: false,
      sortOrder: 2,
      submissionType: 'REPOSITORY_RELEASE',
      viewerSubmission: { submitted: false, submittedAt: null },
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
    cells: seeds.map((seed) => {
      const isSubmitted = index < seed.teamSubmissionCount.submitted;
      if (!isSubmitted) {
        return {
          documentId: seed.id,
          isSubmitted: false,
          submittedAt: null,
          file: null,
        };
      }
      // FILE 유형이어도 보존 기한이 지난 첨부는 `file`이 비어 온다(백엔드 계약).
      // 첫 팀을 그 갈래로 둬 "제출됨(링크 없음)" 표시가 검토 화면에 실제로 뜨게 한다.
      const expired = index === 0;
      return {
        documentId: seed.id,
        isSubmitted: true,
        submittedAt,
        file:
          seed.submissionType === 'FILE' && !expired
            ? {
                // 두 번째 팀은 파일명이 길다 — 열 폭을 밀지 않고 잘리는지, 잘린
                // 이름의 전체가 title로 남는지 눈으로 확인할 자리다.
                name: profileless
                  ? `합성-${seed.name}-아주-긴-파일-이름-확인용-${teamNumber}팀-최종본.pdf`
                  : `합성-${seed.name}-${teamNumber}팀.pdf`,
                sizeBytes: 245_760 + index * 1024,
              }
            : null,
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
