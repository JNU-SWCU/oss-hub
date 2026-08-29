import type { MilestoneDocumentCollectionFilter } from '@/features/programs/milestone-document-collection-api';
import {
  MILESTONE_DOCUMENT_REVIEW_DECISIONS,
  type MilestoneDocumentReviewDecision,
} from '@/features/programs/milestone-document-review-api';
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
  positiveIntParam,
  problem,
  unauthenticated,
  type LocalReviewContext,
  type LocalReviewHandler,
  type LocalReviewResponsePlan,
} from '../handler-kit';
import {
  createdMilestoneDocumentReviewFor,
  isKnownMilestoneId,
  MILESTONE_DOCUMENT_COLLECTION_FIXTURE_DEFAULT_QUERY,
  milestoneDocumentCollectionFor,
  milestoneDocumentHistoryFor,
  milestoneDocumentSubmissionFor,
  milestoneDocumentsFor,
  reorderedMilestoneDocumentsFor,
  UPLOADED_MILESTONE_DOCUMENT_FILE_FIXTURE,
  uploadedMilestoneDocumentTemplateFor,
} from './milestone-document-fixtures';

/**
 * 마일스톤 서류 화면의 로컬 검토 응답.
 * 담당 경로: `milestones/:milestoneId/documents`(GET/POST),
 * `.../documents/collection`(GET), `.../documents/collection/archive`(GET),
 * `.../documents/order`(PATCH),
 * `.../documents/:documentId`(PATCH/DELETE),
 * `.../documents/:documentId/template`(GET/POST),
 * `.../documents/:documentId/applications/:applicationId/file`(GET),
 * `.../documents/:documentId/applications/:applicationId/history`(GET),
 * `.../documents/:documentId/history`(GET),
 * `.../documents/:documentId/applications/:applicationId/reviews`(POST),
 * `.../documents/:documentId/submissions`(POST), `milestone-document-files`(POST).
 *
 * 실제 백엔드는 조회는 SessionGuard만, 등록·수정·삭제·양식 업로드·수합 표는
 * `MilestoneDocumentsStaffGuard`(STAFF·ADMIN만 통과, 학생은 403 MSD_001)를 추가로
 * 두므로(`milestone-documents.controller.ts`) 여기서도 같은 순서로 가른다.
 */

const MILESTONE_NOT_FOUND_CODE = 'MSD_003';
const DOCUMENT_NOT_FOUND_CODE = 'MSD_004';
const STAFF_ONLY_CODE = 'MSD_001';
const TEMPLATE_NOT_FOUND_CODE = 'MSD_015';
const SUBMISSION_FILE_NOT_FOUND_CODE = 'MSD_020';
const SUBMISSION_NOT_FOUND_CODE = 'MSD_022';
const INVALID_REQUEST_CODE = 'MSD_019';
const REVIEW_COMMENT_REQUIRED_CODE = 'MSD_021';
const CONTENT_REQUIRED_CODE = 'MSD_008';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const COLLECTION_FILTERS: readonly MilestoneDocumentCollectionFilter[] = [
  'ALL',
  'HAS_MISSING',
  'ZERO_SUBMISSION',
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

function hasObsoleteSubmissionType(context: LocalReviewContext): boolean {
  const body = bodyRecord(context);
  return body !== null && Object.hasOwn(body, 'submissionType');
}

/** 시드가 가진 자리. 모르는 서류면 1 — 수정 응답은 순서를 만들어 내지 않는다. */
function storedSortOrder(milestoneId: string, documentId: string): number {
  const documents = milestoneDocumentsFor(milestoneId, 'STAFF') ?? [];
  return (
    documents.find((document) => document.id === documentId)?.sortOrder ?? 1
  );
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

/**
 * 교직원 서류 수합 표. `collection`은 고정 세그먼트라 `:documentId` 경로들과 겹치지
 * 않지만(백엔드 컨트롤러도 같은 이유로 `collection`을 위에 둔다), 이 파일에서도
 * 목록 바로 아래에 둬 읽는 순서가 컨트롤러와 같게 한다.
 */
const collectionHandler: LocalReviewHandler = (context) => {
  const params = matchGet(
    context,
    'milestones/:milestoneId/documents/collection',
  );
  if (params === null) return null;
  const guard = staffGuardResponse(context);
  if (guard !== null) return guard;
  // 모르는 filter 값은 기본값(ALL)으로 떨어뜨린다 — 실제 백엔드는 422로 거절하지만,
  // 검토 화면이 보내는 값은 계약 안의 3종뿐이라 여기서 갈래를 늘리지 않는다.
  const filter = context.searchParams.get('filter');
  const collection = milestoneDocumentCollectionFor(params.milestoneId ?? '', {
    page: positiveIntParam(
      context.searchParams.get('page'),
      MILESTONE_DOCUMENT_COLLECTION_FIXTURE_DEFAULT_QUERY.page,
    ),
    pageSize: positiveIntParam(
      context.searchParams.get('pageSize'),
      MILESTONE_DOCUMENT_COLLECTION_FIXTURE_DEFAULT_QUERY.pageSize,
    ),
    filter: COLLECTION_FILTERS.includes(
      filter as MilestoneDocumentCollectionFilter,
    )
      ? (filter as MilestoneDocumentCollectionFilter)
      : MILESTONE_DOCUMENT_COLLECTION_FIXTURE_DEFAULT_QUERY.filter,
  });
  return collection === null
    ? notFound(MILESTONE_NOT_FOUND_CODE, context.path)
    : json(200, collection);
};

/**
 * 서류 순서 재부여. `order`는 고정 세그먼트라 아래 `updateDocumentHandler`(`:documentId`)
 * **보다 먼저 등록해야 한다** — 이 파일의 핸들러는 배열 순서대로 물어보므로, 뒤에 두면
 * `:documentId`가 먼저 잡아 `order`라는 id를 수정하려 든다(백엔드 컨트롤러가 `@Patch('order')`를
 * `@Patch(':documentId')` 위에 두는 것과 같은 이유다).
 */
const reorderDocumentsHandler: LocalReviewHandler = (context) => {
  const params = matchMethod(
    context,
    'PATCH',
    'milestones/:milestoneId/documents/order',
  );
  if (params === null) return null;
  const guard = staffGuardResponse(context);
  if (guard !== null) return guard;
  const milestoneId = params.milestoneId ?? '';
  if (!isKnownMilestoneId(milestoneId)) {
    return notFound(MILESTONE_NOT_FOUND_CODE, context.path);
  }
  const documentIds = bodyRecord(context)?.documentIds;
  if (
    !Array.isArray(documentIds) ||
    documentIds.some((id) => typeof id !== 'string')
  ) {
    return problem(
      400,
      INVALID_REQUEST_CODE,
      apiPath(context.path),
      '요청 값을 확인해 주세요.',
    );
  }
  const reordered = reorderedMilestoneDocumentsFor(
    milestoneId,
    documentIds as readonly string[],
  );
  // 전체 집합이 아니면 400 — 부분 목록을 조용히 받아 주면 화면이 실제 백엔드에서만
  // 실패하는 요청을 만들어도 로컬 검토에서는 성공으로 보인다.
  return reordered === null
    ? problem(
        400,
        INVALID_REQUEST_CODE,
        apiPath(context.path),
        '요청 값을 확인해 주세요.',
      )
    : accepted(reordered);
};

/**
 * 기대 버전 두 값이 요청 본문에 **제대로 실려 있는가**.
 *
 * `expectedRevision`은 **1 이상의 정수**여야 하고(백엔드 DTO의 `@IsInt() @Min(1)`),
 * `expectedLatestReviewId`는 문자열이거나 **명시된 `null`**이어야 한다. 키를 아예 빼먹은
 * 요청은 통과시키지 않는다 — 백엔드가 `@IsOptional`이 아니라 `@ValidateIf`로 받아 누락을
 * 400으로 막기 때문이고, 여기서 느슨하게 받으면 옛 본문을 보내는 화면이 로컬 검토에서만
 * 멀쩡히 저장되는 것처럼 보인다.
 *
 * ⚠ 숫자를 **문자열로 보낸 요청**(`'2'`)도, 0·음수·소수도 막는다. 첫 제출이 1이라 그
 * 범위 밖의 값은 어떤 제출도 가리키지 않는다 — 여기서 받아 주면 그런 값을 싣는 화면이
 * 실제 백엔드에 붙어서야 400으로 드러난다.
 */
function hasReviewTargetVersion(context: LocalReviewContext): boolean {
  const record = bodyRecord(context);
  if (record === null) return false;
  const revision = record.expectedRevision;
  if (typeof revision !== 'number') return false;
  if (!Number.isInteger(revision) || revision < 1) return false;
  if (!('expectedLatestReviewId' in record)) return false;
  const reviewId = record.expectedLatestReviewId;
  return reviewId === null || typeof reviewId === 'string';
}

/**
 * 서류 제출물 판정. 실제 백엔드와 **같은 순서로** 갈린다: 교직원 가드 →
 * 요청 값 검사(400) → 사유 필수(422).
 *
 * 사유 필수를 여기서도 보는 것이 요점이다. 화면이 먼저 막지만, 그 검증이 사라져도
 * 로컬 검토가 조용히 성공을 돌려주면 **검증이 없어진 것을 아무도 못 본다** — 실제
 * 백엔드에 붙였을 때에야 422가 드러난다. 공백만 적은 사유를 함께 거절하는 것도 서버와
 * 같다(`trim()` 후 빈 문자열은 `null`로 접힌다). 기대 버전 두 값을 400으로 막는 것도
 * 같은 이유다 — 그 값을 빼먹은 화면은 실제 백엔드에서 **판정이 통째로 실패한다**.
 *
 * 한계: 판정이 저장되지 않아 표를 다시 불러도 칸은 그대로다
 * (`createdMilestoneDocumentReviewFor` 주석 참고). 같은 이유로 「내가 본 그 제출물이
 * 아니다」(409 MSD_025)도 여기서는 재현되지 않는다 — 그 갈래는 화면 쪽 테스트가 덮는다.
 */
const reviewSubmissionHandler: LocalReviewHandler = (context) => {
  const params = matchMethod(
    context,
    'POST',
    'milestones/:milestoneId/documents/:documentId/applications/:applicationId/reviews',
  );
  if (params === null) return null;
  const guard = staffGuardResponse(context);
  if (guard !== null) return guard;
  const decision = bodyEnum<MilestoneDocumentReviewDecision>(
    context,
    'decision',
    MILESTONE_DOCUMENT_REVIEW_DECISIONS,
  );
  if (decision === null || !hasReviewTargetVersion(context)) {
    return problem(
      400,
      INVALID_REQUEST_CODE,
      apiPath(context.path),
      '요청 값을 확인해 주세요.',
    );
  }
  const comment = bodyString(context, 'comment')?.trim() || null;
  if (comment === null && decision !== 'APPROVED') {
    return problem(
      422,
      REVIEW_COMMENT_REQUIRED_CODE,
      apiPath(context.path),
      '보완 요청과 반려는 사유를 입력해 주세요.',
    );
  }
  return json(
    201,
    createdMilestoneDocumentReviewFor(
      params.documentId ?? '',
      params.applicationId ?? '',
      decision,
      comment,
    ),
  );
};

/** 교직원 판정 패널이 필요할 때만 불러오는 제출·검토 이력. */
const submissionHistoryHandler: LocalReviewHandler = (context) => {
  const params = matchGet(
    context,
    'milestones/:milestoneId/documents/:documentId/applications/:applicationId/history',
  );
  if (params === null) return null;
  const guard = staffGuardResponse(context);
  if (guard !== null) return guard;
  const rawLimit = context.searchParams.get('limit');
  const limit = positiveIntParam(rawLimit, 20);
  const cursor = context.searchParams.get('cursor');
  // DTO의 limit 범위는 1..50이다. `positiveIntParam`은 없는 값의 기본만 맡기고,
  // 범위 밖·숫자가 아닌 값은 실제 ValidationPipe와 같이 400으로 가른다.
  if (
    (rawLimit !== null &&
      (!/^[1-9]\d*$/.test(rawLimit) ||
        !Number.isSafeInteger(Number(rawLimit)) ||
        Number(rawLimit) > 50)) ||
    (cursor !== null && cursor.length > 64)
  ) {
    return problem(
      400,
      INVALID_REQUEST_CODE,
      apiPath(context.path),
      '요청 값을 확인해 주세요.',
    );
  }
  const history = milestoneDocumentHistoryFor(
    params.milestoneId ?? '',
    params.documentId ?? '',
    params.applicationId ?? '',
    { cursor, limit },
  );
  switch (history.kind) {
    case 'page':
      return json(200, history.page);
    case 'document-not-found':
      return notFound(DOCUMENT_NOT_FOUND_CODE, context.path);
    case 'invalid-request':
      return problem(
        400,
        INVALID_REQUEST_CODE,
        apiPath(context.path),
        '요청 값을 확인해 주세요.',
      );
    case 'submission-not-found':
      return notFound(SUBMISSION_NOT_FOUND_CODE, context.path);
    default: {
      const exhaustive: never = history;
      return exhaustive;
    }
  }
};

/**
 * 학생 — 자기 팀 제출·검토 이력. 실제 endpoint에는 applicationId가 없으므로 로컬
 * 학생 페르소나가 속한 두 번째 합성 팀으로 범위를 고정한다. 판정자는 학생에게
 * 식별되지 않도록 운영 서비스와 같이 `담당 교직원`으로 가린다.
 */
const participantHistoryHandler: LocalReviewHandler = (context) => {
  const params = matchGet(
    context,
    'milestones/:milestoneId/documents/:documentId/history',
  );
  if (params === null) return null;
  if (!context.isAuthenticated || context.role === null) {
    return unauthenticated(context.path);
  }
  const rawLimit = context.searchParams.get('limit');
  const limit = positiveIntParam(rawLimit, 20);
  const cursor = context.searchParams.get('cursor');
  if (
    (rawLimit !== null &&
      (!/^[1-9]\d*$/.test(rawLimit) ||
        !Number.isSafeInteger(Number(rawLimit)) ||
        Number(rawLimit) > 50)) ||
    (cursor !== null && cursor.length > 64)
  ) {
    return problem(
      400,
      INVALID_REQUEST_CODE,
      apiPath(context.path),
      '요청 값을 확인해 주세요.',
    );
  }
  const milestoneId = params.milestoneId ?? '';
  const history = milestoneDocumentHistoryFor(
    milestoneId,
    params.documentId ?? '',
    `synthetic-application-${milestoneId}-2`,
    { cursor, limit },
  );
  switch (history.kind) {
    case 'page':
      return json(200, {
        ...history.page,
        items: history.page.items.map((item) => ({
          ...item,
          actorNickname:
            item.event === 'SUBMITTED' || item.event === 'RESUBMITTED'
              ? item.actorNickname
              : '담당 교직원',
        })),
      });
    case 'document-not-found':
      return notFound(DOCUMENT_NOT_FOUND_CODE, context.path);
    case 'invalid-request':
      return problem(
        400,
        INVALID_REQUEST_CODE,
        apiPath(context.path),
        '요청 값을 확인해 주세요.',
      );
    case 'submission-not-found':
      return notFound(SUBMISSION_NOT_FOUND_CODE, context.path);
    default: {
      const exhaustive: never = history;
      return exhaustive;
    }
  }
};

/**
 * 전체 제출물 ZIP 일괄 내려받기. 실제 백엔드는 압축 스트림을 주는데 로컬 검토 응답
 * 계약(`LocalReviewResponsePlan`)은 json/delay/redirect만 표현할 수 있어 압축 파일을
 * 흉내 낼 수 없다 — 아래 `downloadSubmissionFileHandler`와 **같은 한계, 같은 처방**이다.
 *
 * ⚠ 그래서 검토자가 「전체 내려받기(ZIP)」를 누르면 실제 마일스톤인데도 "마일스톤을 찾을 수
 * 없습니다"가 나온다. **이 한 줄이 없으면** 그 자리에서 「경로를 모른다」(LFX_404)가 나와
 * 커버리지 판정이 「픽스처가 이 경로 모양을 아예 모른다」로 읽는다 — 그것과 「알지만 못 만든다」는
 * 다른 상태이고, 후자만 이 어댑터의 정직한 한계다.
 *
 * `collection/archive`는 고정 세그먼트 두 칸이라 `:documentId/template` 같은 규칙과 겹치지
 * 않지만, 읽는 순서를 컨트롤러와 같게 하려고 수합 표 바로 아래에 둔다.
 */
const collectionArchiveHandler: LocalReviewHandler = (context) => {
  const params = matchGet(
    context,
    'milestones/:milestoneId/documents/collection/archive',
  );
  if (params === null) return null;
  const guard = staffGuardResponse(context);
  if (guard !== null) return guard;
  return notFound(MILESTONE_NOT_FOUND_CODE, context.path);
};

/**
 * 제출 파일 다운로드. 실제 백엔드는 `StreamableFile`(바이너리)을 주지만 로컬 검토
 * 응답 계약(`LocalReviewResponsePlan`)은 json/delay/redirect만 표현할 수 있어
 * 다운로드 자체를 흉내 낼 수 없다 — 아래 `downloadTemplateHandler`와 같은 방식으로
 * 언제나 도메인 404(MSD_020)를 준다. 검토자가 수합 표의 파일명을 눌러 보면 파일
 * 대신 "제출된 파일을 찾을 수 없습니다"가 나오는데, 그것이 이 어댑터의 한계다.
 * 링크가 붙는지·주소가 맞는지는 그래도 확인할 수 있고, 도메인 404는 "경로는 안다"는
 * 뜻이라 fixture-route-coverage.test.ts의 커버리지 판정도 통과한다.
 */
const downloadSubmissionFileHandler: LocalReviewHandler = (context) => {
  const params = matchGet(
    context,
    'milestones/:milestoneId/documents/:documentId/applications/:applicationId/file',
  );
  if (params === null) return null;
  const guard = staffGuardResponse(context);
  if (guard !== null) return guard;
  return notFound(SUBMISSION_FILE_NOT_FOUND_CODE, context.path);
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
  if (hasObsoleteSubmissionType(context)) {
    return problem(
      400,
      INVALID_REQUEST_CODE,
      apiPath(context.path),
      '요청 값을 확인해 주세요.',
    );
  }
  return accepted({
    id: `synthetic-document-${params.milestoneId}-new`,
    milestoneId: params.milestoneId,
    name: bodyString(context, 'name') ?? '합성 서류',
    required: bodyBoolean(context, 'required') ?? true,
    sortOrder: bodyNumber(context, 'sortOrder') ?? 1,
    hasTemplateFile: false,
  });
};

/**
 * 한계: 저장되지 않아 화면을 다시 열면 수정 전 값으로 돌아온다.
 *
 * ⚠ 본문의 `sortOrder`는 **읽지 않는다** — 실제 백엔드도 수정 요청의 sortOrder를 무시하고
 * 순서는 `PATCH .../documents/order`가 소유한다. 되받아 주면 로컬 검토에서만 「고치면
 * 순서가 바뀐다」로 보여, 화면이 그 전제 위에 얹혀도 여기서는 드러나지 않는다.
 */
const updateDocumentHandler: LocalReviewHandler = (context) => {
  const params = matchMethod(
    context,
    'PATCH',
    'milestones/:milestoneId/documents/:documentId',
  );
  if (params === null) return null;
  const guard = staffGuardResponse(context);
  if (guard !== null) return guard;
  if (hasObsoleteSubmissionType(context)) {
    return problem(
      400,
      INVALID_REQUEST_CODE,
      apiPath(context.path),
      '요청 값을 확인해 주세요.',
    );
  }
  return accepted({
    id: params.documentId,
    milestoneId: params.milestoneId,
    name: bodyString(context, 'name') ?? '합성 서류',
    required: bodyBoolean(context, 'required') ?? true,
    sortOrder: storedSortOrder(
      params.milestoneId ?? '',
      params.documentId ?? '',
    ),
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
  const rawContent = bodyRecord(context)?.content;
  const content = isRecord(rawContent) ? rawContent : null;
  const hasText =
    typeof content?.text === 'string' && content.text.trim().length > 0;
  const hasFile =
    typeof content?.fileId === 'string' && content.fileId.trim().length > 0;
  if (!hasText && !hasFile) {
    return problem(
      422,
      CONTENT_REQUIRED_CODE,
      apiPath(context.path),
      '제출 내용을 입력해 주세요.',
    );
  }
  return json(201, milestoneDocumentSubmissionFor(params.documentId ?? ''));
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
  collectionHandler,
  collectionArchiveHandler,
  submissionHistoryHandler,
  participantHistoryHandler,
  reviewSubmissionHandler,
  downloadSubmissionFileHandler,
  createDocumentHandler,
  // ⚠ `updateDocumentHandler`보다 위여야 한다 — 위 주석 참고. 순서를 바꾸면
  //   순서 바꾸기 요청이 「`order`라는 서류를 수정」으로 잘못 처리된다.
  reorderDocumentsHandler,
  updateDocumentHandler,
  deleteDocumentHandler,
  uploadTemplateHandler,
  downloadTemplateHandler,
  submitDocumentHandler,
  uploadDocumentFileHandler,
];
