import type {
  MilestoneDocument,
  MilestoneDocumentSubmission,
  MilestoneDocumentTeamSubmissionCount,
  MilestoneDocumentViewerSubmission,
  UploadedMilestoneDocumentFile,
  UploadedMilestoneDocumentTemplate,
} from '@/features/programs/milestone-document-api';
import type { SubmissionType } from '@/features/programs/types';

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
