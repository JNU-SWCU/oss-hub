import { apiPath } from '@/lib/api-client';
import {
  accepted,
  bodyBoolean,
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
  boardActorId,
  boardPostDetailFor,
  boardPostsFor,
  studentHasBoardAccess,
} from './board-fixtures';

/**
 * 프로그램 게시판 화면의 로컬 검토 응답.
 * 담당 경로: `programs/:programId/board/posts`(GET/POST),
 * `.../posts/:postId`(GET/PATCH/DELETE), `.../posts/:postId/pin`(PATCH),
 * `.../posts/:postId/comments`(POST), `.../posts/:postId/comments/:commentId`(DELETE).
 *
 * 실제 백엔드는 class-level `SessionGuard`·`BoardAccessGuard`를 두므로
 * (board.controller.ts) 비로그인은 401(AUT_003), 로그인했지만 해당 프로그램에
 * `APPROVED` 신청이 없는 학생은 403(BRD_001)이다 — 교직원·관리자는 항상 통과한다.
 */

const POST_NOT_FOUND_CODE = 'BRD_002';
const COMMENT_NOT_FOUND_CODE = 'BRD_003';
const NOT_AUTHOR_CODE = 'BRD_004';
const STAFF_ONLY_CODE = 'BRD_005';

/** 조작(POST/PATCH/DELETE)은 method까지 일치해야 한다 — milestone-document-handlers.ts와 같은 패턴. */
function matchMethod(
  context: LocalReviewContext,
  method: string,
  pattern: string,
): Record<string, string> | null {
  return context.method === method ? matchPath(pattern, context.path) : null;
}

/** 비로그인은 401, 학생인데 해당 프로그램에 접근 권한이 없으면 403 — 통과하면 `null`. */
function boardAccessDenied(
  context: LocalReviewContext,
  programId: string,
): LocalReviewResponsePlan | null {
  if (!context.isAuthenticated || context.role === null) {
    return unauthenticated(context.path);
  }
  if (context.role !== 'STUDENT') return null;
  if (studentHasBoardAccess(programId)) return null;
  return problem(
    403,
    'BRD_001',
    apiPath(context.path),
    '이 프로그램 게시판에 접근할 권한이 없습니다.',
  );
}

const listPostsHandler: LocalReviewHandler = (context) => {
  const params = matchGet(context, 'programs/:programId/board/posts');
  if (params === null) return null;
  const programId = params.programId ?? '';
  const denied = boardAccessDenied(context, programId);
  if (denied !== null) return denied;
  const items = boardPostsFor(programId);
  const page = positiveIntParam(context.searchParams.get('page'), 1);
  const limit = positiveIntParam(context.searchParams.get('limit'), 20);
  const offset = (page - 1) * limit;
  return json(200, {
    items: items.slice(offset, offset + limit),
    total: items.length,
    page,
    limit,
  });
};

const postDetailHandler: LocalReviewHandler = (context) => {
  const params = matchGet(context, 'programs/:programId/board/posts/:postId');
  if (params === null) return null;
  const programId = params.programId ?? '';
  const denied = boardAccessDenied(context, programId);
  if (denied !== null) return denied;
  const detail = boardPostDetailFor(programId, params.postId ?? '');
  return detail === null
    ? notFound(POST_NOT_FOUND_CODE, context.path)
    : json(200, detail);
};

/** 한계: 저장되지 않아 목록을 다시 열면 새 글이 사라진다(다른 도메인과 같은 한계). */
const createPostHandler: LocalReviewHandler = (context) => {
  const params = matchMethod(
    context,
    'POST',
    'programs/:programId/board/posts',
  );
  if (params === null) return null;
  const programId = params.programId ?? '';
  const denied = boardAccessDenied(context, programId);
  if (denied !== null) return denied;
  const role = context.role;
  if (role === null) return unauthenticated(context.path);
  const isStaff = role === 'STAFF' || role === 'ADMIN';
  const now = '2026-08-01T00:00:00.000Z';
  return accepted({
    id: 'synthetic-post-created',
    programId,
    authorId: boardActorId(role),
    // 실제 서비스는 작성자 역할로 분류를 정한다(board.service.ts) — 교직원=공지, 학생=질문.
    category: isStaff ? 'NOTICE' : 'QNA',
    title: bodyString(context, 'title') ?? '합성 게시글',
    body: bodyString(context, 'body') ?? '',
    pinned: false,
    createdAt: now,
    updatedAt: now,
    commentCount: 0,
    comments: [],
  });
};

/** 한계: 저장되지 않아 다시 열면 수정 전 값으로 돌아온다. */
const updatePostHandler: LocalReviewHandler = (context) => {
  const params = matchMethod(
    context,
    'PATCH',
    'programs/:programId/board/posts/:postId',
  );
  if (params === null) return null;
  const programId = params.programId ?? '';
  const postId = params.postId ?? '';
  const denied = boardAccessDenied(context, programId);
  if (denied !== null) return denied;
  const role = context.role;
  if (role === null) return unauthenticated(context.path);
  const existing = boardPostDetailFor(programId, postId);
  if (existing === null) return notFound(POST_NOT_FOUND_CODE, context.path);
  // 실제 서비스는 작성자만 수정할 수 있다 — 교직원도 남의 글은 못 고친다(board.service.ts).
  if (existing.authorId !== boardActorId(role)) {
    return problem(
      403,
      NOT_AUTHOR_CODE,
      apiPath(context.path),
      '작성자만 수정·삭제할 수 있습니다.',
    );
  }
  return accepted({
    ...existing,
    title: bodyString(context, 'title') ?? existing.title,
    body: bodyString(context, 'body') ?? existing.body,
    updatedAt: '2026-08-01T00:00:00.000Z',
  });
};

const deletePostHandler: LocalReviewHandler = (context) => {
  const params = matchMethod(
    context,
    'DELETE',
    'programs/:programId/board/posts/:postId',
  );
  if (params === null) return null;
  const programId = params.programId ?? '';
  const postId = params.postId ?? '';
  const denied = boardAccessDenied(context, programId);
  if (denied !== null) return denied;
  const role = context.role;
  if (role === null) return unauthenticated(context.path);
  const existing = boardPostDetailFor(programId, postId);
  if (existing === null) return notFound(POST_NOT_FOUND_CODE, context.path);
  const isStaff = role === 'STAFF' || role === 'ADMIN';
  // 삭제는 작성자 또는 교직원이면 된다(수정과 달리 교직원이 대신 지울 수 있다).
  if (existing.authorId !== boardActorId(role) && !isStaff) {
    return problem(
      403,
      NOT_AUTHOR_CODE,
      apiPath(context.path),
      '작성자만 수정·삭제할 수 있습니다.',
    );
  }
  return accepted({ deleted: true });
};

/** 고정은 작성자 여부와 무관하게 교직원·관리자만 할 수 있다(board.service.ts). */
const pinPostHandler: LocalReviewHandler = (context) => {
  const params = matchMethod(
    context,
    'PATCH',
    'programs/:programId/board/posts/:postId/pin',
  );
  if (params === null) return null;
  const programId = params.programId ?? '';
  const postId = params.postId ?? '';
  const denied = boardAccessDenied(context, programId);
  if (denied !== null) return denied;
  const role = context.role;
  if (role === null) return unauthenticated(context.path);
  if (role !== 'STAFF' && role !== 'ADMIN') {
    return problem(
      403,
      STAFF_ONLY_CODE,
      apiPath(context.path),
      '교직원만 게시글을 고정할 수 있습니다.',
    );
  }
  const existing = boardPostDetailFor(programId, postId);
  if (existing === null) return notFound(POST_NOT_FOUND_CODE, context.path);
  return accepted({
    ...existing,
    pinned: bodyBoolean(context, 'pinned') ?? true,
  });
};

/** 한계: 저장되지 않아 다시 열면 새 댓글이 사라진다. */
const createCommentHandler: LocalReviewHandler = (context) => {
  const params = matchMethod(
    context,
    'POST',
    'programs/:programId/board/posts/:postId/comments',
  );
  if (params === null) return null;
  const programId = params.programId ?? '';
  const postId = params.postId ?? '';
  const denied = boardAccessDenied(context, programId);
  if (denied !== null) return denied;
  const role = context.role;
  if (role === null) return unauthenticated(context.path);
  const existing = boardPostDetailFor(programId, postId);
  if (existing === null) return notFound(POST_NOT_FOUND_CODE, context.path);
  return accepted({
    id: 'synthetic-comment-created',
    postId,
    authorId: boardActorId(role),
    body: bodyString(context, 'body') ?? '',
    createdAt: '2026-08-01T00:00:00.000Z',
  });
};

const deleteCommentHandler: LocalReviewHandler = (context) => {
  const params = matchMethod(
    context,
    'DELETE',
    'programs/:programId/board/posts/:postId/comments/:commentId',
  );
  if (params === null) return null;
  const programId = params.programId ?? '';
  const postId = params.postId ?? '';
  const commentId = params.commentId ?? '';
  const denied = boardAccessDenied(context, programId);
  if (denied !== null) return denied;
  const role = context.role;
  if (role === null) return unauthenticated(context.path);
  const existing = boardPostDetailFor(programId, postId);
  const comment =
    existing?.comments.find((candidate) => candidate.id === commentId) ?? null;
  if (comment === null) return notFound(COMMENT_NOT_FOUND_CODE, context.path);
  const isStaff = role === 'STAFF' || role === 'ADMIN';
  if (comment.authorId !== boardActorId(role) && !isStaff) {
    return problem(
      403,
      NOT_AUTHOR_CODE,
      apiPath(context.path),
      '작성자만 수정·삭제할 수 있습니다.',
    );
  }
  return accepted({ deleted: true });
};

export const BOARD_HANDLERS: readonly LocalReviewHandler[] = [
  listPostsHandler,
  postDetailHandler,
  createPostHandler,
  updatePostHandler,
  deletePostHandler,
  pinPostHandler,
  createCommentHandler,
  deleteCommentHandler,
];
