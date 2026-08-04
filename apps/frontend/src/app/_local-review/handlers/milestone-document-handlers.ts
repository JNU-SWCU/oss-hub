import type { SubmissionType } from '@/features/programs/types';
import { apiPath } from '@/lib/api-client';
import {
  accepted,
  bodyBoolean,
  bodyEnum,
  bodyRecord,
  bodyString,
  json,
  matchGet,
  matchPath,
  notFound,
  problem,
  unauthenticated,
  type LocalReviewContext,
  type LocalReviewHandler,
  type LocalReviewResponsePlan,
} from '../handler-kit';
import {
  isKnownMilestoneId,
  milestoneDocumentSubmissionFor,
  milestoneDocumentsFor,
  UPLOADED_MILESTONE_DOCUMENT_FILE_FIXTURE,
  uploadedMilestoneDocumentTemplateFor,
} from './milestone-document-fixtures';

/**
 * 마일스톤 서류 화면의 로컬 검토 응답.
 * 담당 경로: `milestones/:milestoneId/documents`(GET/POST),
 * `.../documents/:documentId`(PATCH/DELETE), `.../documents/:documentId/template`
 * (GET/POST), `.../documents/:documentId/submissions`(POST), `milestone-document-files`(POST).
 *
 * 실제 백엔드는 조회는 SessionGuard만, 등록·수정·삭제·양식 업로드는
 * `MilestoneDocumentsStaffGuard`(STAFF·ADMIN만 통과, 학생은 403 MSD_001)를 추가로
 * 두므로(`milestone-documents.controller.ts`) 여기서도 같은 순서로 가른다.
 */

const MILESTONE_NOT_FOUND_CODE = 'MSD_003';
const STAFF_ONLY_CODE = 'MSD_001';
const TEMPLATE_NOT_FOUND_CODE = 'MSD_015';

const SUBMISSION_TYPES: readonly SubmissionType[] = [
  'FILE',
  'TEXT',
  'REPOSITORY_RELEASE',
];

/** 조작(POST/PATCH/DELETE)은 method까지 일치해야 한다 — GET 전용 matchGet의 짝(staff-handlers.ts와 동일 패턴). */
function matchMethod(
  context: LocalReviewContext,
  method: string,
  pattern: string,
): Record<string, string> | null {
  return context.method === method ? matchPath(pattern, context.path) : null;
}

function bodyNumber(context: LocalReviewContext, key: string): number | null {
  const value = bodyRecord(context)?.[key];
  return typeof value === 'number' ? value : null;
}

/** 로그인은 됐지만 학생이면 403, 비로그인이면 401 — 통과하면 `null`. */
function staffGuardResponse(
  context: LocalReviewContext,
): LocalReviewResponsePlan | null {
  if (!context.isAuthenticated || context.role === null) {
    return unauthenticated(context.path);
  }
  if (context.role === 'STUDENT') {
    return problem(
      403,
      STAFF_ONLY_CODE,
      apiPath(context.path),
      '교직원만 이용할 수 있습니다.',
    );
  }
  return null;
}

const listDocumentsHandler: LocalReviewHandler = (context) => {
  const params = matchGet(context, 'milestones/:milestoneId/documents');
  if (params === null) return null;
  if (!context.isAuthenticated || context.role === null) {
    return unauthenticated(context.path);
  }
  const milestoneId = params.milestoneId ?? '';
  const documents = milestoneDocumentsFor(milestoneId, context.role);
  return documents === null
    ? notFound(MILESTONE_NOT_FOUND_CODE, context.path)
    : json(200, documents);
};

/** 한계: 저장되지 않아 화면을 다시 열면 추가한 서류는 사라진다(staff-handlers.ts의 마일스톤 생성과 같은 한계). */
const createDocumentHandler: LocalReviewHandler = (context) => {
  const params = matchMethod(
    context,
    'POST',
    'milestones/:milestoneId/documents',
  );
  if (params === null) return null;
  const guard = staffGuardResponse(context);
  if (guard !== null) return guard;
  if (!isKnownMilestoneId(params.milestoneId ?? '')) {
    return notFound(MILESTONE_NOT_FOUND_CODE, context.path);
  }
  return accepted({
    id: `synthetic-document-${params.milestoneId}-new`,
    milestoneId: params.milestoneId,
    name: bodyString(context, 'name') ?? '합성 서류',
    required: bodyBoolean(context, 'required') ?? true,
    sortOrder: bodyNumber(context, 'sortOrder') ?? 1,
    submissionType:
      bodyEnum<SubmissionType>(context, 'submissionType', SUBMISSION_TYPES) ??
      'FILE',
    hasTemplateFile: false,
  });
};

/** 한계: 저장되지 않아 화면을 다시 열면 수정 전 값으로 돌아온다. */
const updateDocumentHandler: LocalReviewHandler = (context) => {
  const params = matchMethod(
    context,
    'PATCH',
    'milestones/:milestoneId/documents/:documentId',
  );
  if (params === null) return null;
  const guard = staffGuardResponse(context);
  if (guard !== null) return guard;
  return accepted({
    id: params.documentId,
    milestoneId: params.milestoneId,
    name: bodyString(context, 'name') ?? '합성 서류',
    required: bodyBoolean(context, 'required') ?? true,
    sortOrder: bodyNumber(context, 'sortOrder') ?? 1,
    submissionType:
      bodyEnum<SubmissionType>(context, 'submissionType', SUBMISSION_TYPES) ??
      'FILE',
    hasTemplateFile: false,
  });
};

const deleteDocumentHandler: LocalReviewHandler = (context) => {
  const params = matchMethod(
    context,
    'DELETE',
    'milestones/:milestoneId/documents/:documentId',
  );
  if (params === null) return null;
  const guard = staffGuardResponse(context);
  if (guard !== null) return guard;
  return accepted({ deleted: true });
};

/**
 * 양식 업로드. 로컬 검토 라우트(`local-review-api/[...path]/route.ts`)의
 * `readJsonBody`는 `request.text()` 후 `JSON.parse`만 시도해 multipart 본문은
 * 항상 파싱에 실패한다 — `context.body`가 없다고 보고 고정 합성 응답을 준다
 * (student-handlers.ts의 `submission-files` 핸들러와 같은 한계).
 */
const uploadTemplateHandler: LocalReviewHandler = (context) => {
  const params = matchMethod(
    context,
    'POST',
    'milestones/:milestoneId/documents/:documentId/template',
  );
  if (params === null) return null;
  const guard = staffGuardResponse(context);
  if (guard !== null) return guard;
  return accepted(
    uploadedMilestoneDocumentTemplateFor(params.documentId ?? ''),
  );
};

/**
 * 양식 다운로드. 실제 백엔드는 `StreamableFile`(바이너리)을 주지만, 로컬 검토
 * 응답 계약(`LocalReviewResponsePlan`)은 json/delay/redirect만 표현할 수 있어
 * 다운로드 자체를 흉내 낼 수 없다 — 항상 "양식 없음"으로 응답한다. 목록 픽스처도
 * 모두 `hasTemplateFile: false`로 둬 화면에 다운로드 버튼이 뜨지 않게 맞춰 뒀다.
 */
const downloadTemplateHandler: LocalReviewHandler = (context) => {
  const params = matchGet(
    context,
    'milestones/:milestoneId/documents/:documentId/template',
  );
  if (params === null) return null;
  if (!context.isAuthenticated || context.role === null) {
    return unauthenticated(context.path);
  }
  return notFound(TEMPLATE_NOT_FOUND_CODE, context.path);
};

/**
 * 서류 제출/재제출. 실제 컨트롤러는 `SessionGuard`·`OriginGuard`만 두고 역할은
 * 서비스 레이어에서 판정하므로(팀·신청 소속 확인), 여기서는 로그인 여부만 본다.
 */
const submitDocumentHandler: LocalReviewHandler = (context) => {
  const params = matchMethod(
    context,
    'POST',
    'milestones/:milestoneId/documents/:documentId/submissions',
  );
  if (params === null) return null;
  if (!context.isAuthenticated || context.role === null) {
    return unauthenticated(context.path);
  }
  return accepted(milestoneDocumentSubmissionFor(params.documentId ?? ''));
};

/** 제출용 파일 업로드. FormData라 본문을 읽지 못하므로 고정 합성 응답을 준다. */
const uploadDocumentFileHandler: LocalReviewHandler = (context) => {
  if (
    context.method !== 'POST' ||
    context.path !== 'milestone-document-files'
  ) {
    return null;
  }
  if (!context.isAuthenticated || context.role === null) {
    return unauthenticated(context.path);
  }
  return accepted(UPLOADED_MILESTONE_DOCUMENT_FILE_FIXTURE);
};

export const MILESTONE_DOCUMENT_HANDLERS: readonly LocalReviewHandler[] = [
  listDocumentsHandler,
  createDocumentHandler,
  updateDocumentHandler,
  deleteDocumentHandler,
  uploadTemplateHandler,
  downloadTemplateHandler,
  submitDocumentHandler,
  uploadDocumentFileHandler,
];
