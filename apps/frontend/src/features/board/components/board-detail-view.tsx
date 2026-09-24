'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ChevronLeft, Pin, PinOff, RotateCcw } from 'lucide-react';
import { FormErrorSummary, PageHeader, StatusBadge } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api-client';
import {
  createBoardComment,
  deleteBoardComment,
  deleteBoardPost,
  getBoardPost,
  setBoardPostPinned,
  updateBoardPost,
} from '../api';
import { invalidateBoardList } from '../board-list-refetch';
import {
  BOARD_CATEGORY_BADGE_VARIANT,
  BOARD_CATEGORY_LABELS,
  BOARD_COMMENT_AUTHOR_LABEL,
  BOARD_COMMENT_AUTHOR_ROLE_VARIANT,
  boardCommentAuthorRoleLabel,
  boardPostAuthorRoleLabel,
  formatBoardDateTime,
  hasBoardPostInputError,
  mapBoardError,
  validateBoardCommentInput,
  validateBoardPostInput,
  type BoardPostInputErrors,
} from '../board-format';
import { boardListHref } from '../board-paths';
import type { BoardDetailState, BoardPostDetail } from '../types';

const EDIT_TITLE_ERROR_ID = 'board-edit-title-error';
const EDIT_BODY_ERROR_ID = 'board-edit-body-error';
const COMMENT_ERROR_ID = 'board-comment-error';

export interface BoardDetailContentProps {
  readonly programId: string;
  readonly isStaff: boolean;
  readonly state: BoardDetailState;
  readonly editing: boolean;
  readonly editTitle: string;
  readonly editBody: string;
  readonly editSubmitting: boolean;
  /** 지금 입력값으로 다시 판정한 칸 오류. 서버 실패와 섞지 않는다. */
  readonly editErrors: BoardPostInputErrors;
  /** 한 번 「저장」을 누른 뒤부터 칸 오류를 보인다. */
  readonly editShowFieldErrors: boolean;
  /** 서버가 거절한 이유. 칸이 아니라 폼의 경고 상자에 남는다. */
  readonly editSubmitError: string | null;
  readonly pinSubmitting: boolean;
  readonly pinError: string | null;
  readonly deleteSubmitting: boolean;
  readonly deleteError: string | null;
  readonly commentDraft: string;
  readonly commentSubmitting: boolean;
  readonly commentDraftError: string | null;
  readonly commentShowDraftError: boolean;
  /** 댓글 작성·삭제 실패. 입력 누락과 달리 댓글 목록 끝 경고 상자에 남는다. */
  readonly commentSubmitError: string | null;
  readonly deletingCommentId: string | null;
  readonly onRetry: () => void;
  readonly onToggleEdit: () => void;
  readonly onEditTitleChange: (value: string) => void;
  readonly onEditBodyChange: (value: string) => void;
  readonly onSubmitEdit: () => void;
  readonly onDeletePost: () => void;
  readonly onTogglePin: () => void;
  readonly onCommentDraftChange: (value: string) => void;
  readonly onSubmitComment: () => void;
  readonly onDeleteComment: (commentId: string) => void;
}

/**
 * 본문은 붙여넣은 저장소 주소·해시처럼 공백이 하나도 없는 문자열을 그대로 받는다.
 * `whitespace-pre-wrap`은 작성자가 넣은 줄바꿈을 살릴 뿐 그런 문자열을 대신 접어 주지는
 * 않아서, 넘친 부분을 카드(`card.tsx`의 `overflow-hidden`)가 잘라 냈다 — 가로 스크롤도
 * 생기지 않으니 뒷부분을 볼 방법이 아예 없었다.
 *
 * 그래서 신청 상세(`program-application-detail-page.tsx`)와 같은
 * `[overflow-wrap:anywhere]`를 건다. 그쪽이 함께 쓰는 `break-keep`은 여기서 빼 둔다 —
 * 그건 넘치지 않는 한글의 줄바꿈 자리까지 옮기는데, 이 화면은 지금 줄바꿈 모양을 그대로
 * 둔 채 잘림만 없애는 것이 목표다. 아카이브 상세의 `break-all`도 같은 이유로 안 쓴다.
 */
function PostBody({ post }: { readonly post: BoardPostDetail }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="max-w-[70ch] whitespace-pre-wrap text-sm leading-7 text-foreground [overflow-wrap:anywhere]">
          {post.body}
        </p>
      </CardContent>
    </Card>
  );
}

export function BoardDetailContent({
  programId,
  isStaff,
  state,
  editing,
  editTitle,
  editBody,
  editSubmitting,
  editErrors,
  editShowFieldErrors,
  editSubmitError,
  pinSubmitting,
  pinError,
  deleteSubmitting,
  deleteError,
  commentDraft,
  commentSubmitting,
  commentDraftError,
  commentShowDraftError,
  commentSubmitError,
  deletingCommentId,
  onRetry,
  onToggleEdit,
  onEditTitleChange,
  onEditBodyChange,
  onSubmitEdit,
  onDeletePost,
  onTogglePin,
  onCommentDraftChange,
  onSubmitComment,
  onDeleteComment,
}: BoardDetailContentProps) {
  const editTitleRef = useRef<HTMLInputElement>(null);
  const editBodyRef = useRef<HTMLTextAreaElement>(null);
  const commentRef = useRef<HTMLInputElement>(null);
  const showEditTitleError = editShowFieldErrors && editErrors.title !== null;
  const showEditBodyError = editShowFieldErrors && editErrors.body !== null;
  const showCommentError = commentShowDraftError && commentDraftError !== null;

  // 오류 칸으로 커서를 옮긴다 — 눌린 값으로 판정하므로 이 시점의 오류가 결과다.
  function handleSubmitEdit(): void {
    onSubmitEdit();
    if (editErrors.title !== null) editTitleRef.current?.focus();
    else if (editErrors.body !== null) editBodyRef.current?.focus();
  }

  function handleSubmitComment(): void {
    onSubmitComment();
    if (commentDraftError !== null) commentRef.current?.focus();
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-5 sm:p-8">
      <Link
        href={boardListHref(programId)}
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground hover:underline"
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
        게시판 목록
      </Link>

      {state.kind === 'loading' ? (
        <p
          role="status"
          aria-label="게시글을 불러오는 중"
          className="text-sm text-muted-foreground"
        >
          게시글을 불러오는 중…
        </p>
      ) : state.kind === 'not-found' ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>게시글을 찾을 수 없습니다</AlertTitle>
          <AlertDescription>
            삭제되었거나 존재하지 않는 게시글입니다.
          </AlertDescription>
        </Alert>
      ) : state.kind === 'error' ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>게시글을 불러오지 못했습니다</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{state.message}</span>
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              <RotateCcw aria-hidden="true" />
              다시 시도
            </Button>
          </AlertDescription>
        </Alert>
      ) : editing ? (
        <Card>
          <CardContent className="grid gap-4 pt-6">
            <FormErrorSummary
              count={Number(showEditTitleError) + Number(showEditBodyError)}
            />
            <Field data-invalid={showEditTitleError || undefined}>
              <FieldLabel htmlFor="board-edit-title">제목</FieldLabel>
              <Input
                id="board-edit-title"
                ref={editTitleRef}
                value={editTitle}
                maxLength={200}
                disabled={editSubmitting}
                aria-invalid={showEditTitleError}
                aria-describedby={
                  showEditTitleError ? EDIT_TITLE_ERROR_ID : undefined
                }
                onChange={(event) => onEditTitleChange(event.target.value)}
                placeholder="제목"
              />
              {showEditTitleError ? (
                <FieldError id={EDIT_TITLE_ERROR_ID}>
                  {editErrors.title}
                </FieldError>
              ) : null}
            </Field>
            <Field data-invalid={showEditBodyError || undefined}>
              <FieldLabel htmlFor="board-edit-body">내용</FieldLabel>
              <Textarea
                id="board-edit-body"
                ref={editBodyRef}
                value={editBody}
                maxLength={10000}
                rows={6}
                disabled={editSubmitting}
                aria-invalid={showEditBodyError}
                aria-describedby={
                  showEditBodyError ? EDIT_BODY_ERROR_ID : undefined
                }
                onChange={(event) => onEditBodyChange(event.target.value)}
                placeholder="내용"
                className="min-h-28"
              />
              {showEditBodyError ? (
                <FieldError id={EDIT_BODY_ERROR_ID}>
                  {editErrors.body}
                </FieldError>
              ) : null}
            </Field>
            {editSubmitError ? (
              <Alert variant="destructive">
                <AlertDescription>{editSubmitError}</AlertDescription>
              </Alert>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                size="sm"
                disabled={editSubmitting}
                onClick={handleSubmitEdit}
              >
                {editSubmitting ? '저장 중…' : '저장'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={editSubmitting}
                onClick={onToggleEdit}
              >
                취소
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <PageHeader
            title={state.post.title}
            description={`${state.post.authorName ?? boardPostAuthorRoleLabel(state.post.category)} · ${boardPostAuthorRoleLabel(state.post.category)} · ${formatBoardDateTime(state.post.createdAt)}`}
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge
                  variant={BOARD_CATEGORY_BADGE_VARIANT[state.post.category]}
                >
                  {BOARD_CATEGORY_LABELS[state.post.category]}
                </StatusBadge>
                {isStaff ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pinSubmitting}
                    onClick={onTogglePin}
                  >
                    {state.post.pinned ? (
                      <PinOff aria-hidden="true" />
                    ) : (
                      <Pin aria-hidden="true" />
                    )}
                    {state.post.pinned ? '고정 해제' : '고정'}
                  </Button>
                ) : null}
                {state.post.canEdit ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onToggleEdit}
                  >
                    수정
                  </Button>
                ) : null}
                {state.post.canDelete ? (
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={deleteSubmitting}
                    onClick={onDeletePost}
                  >
                    {deleteSubmitting ? '삭제 중…' : '삭제'}
                  </Button>
                ) : null}
              </div>
            }
          />
          {pinError ? (
            <Alert variant="destructive">
              <AlertDescription>{pinError}</AlertDescription>
            </Alert>
          ) : null}
          {deleteError ? (
            <Alert variant="destructive">
              <AlertDescription>{deleteError}</AlertDescription>
            </Alert>
          ) : null}
          <PostBody post={state.post} />

          <h2 className="text-base font-bold text-foreground">
            댓글 {state.post.commentCount}
          </h2>
          <Card>
            <CardContent className="flex flex-col gap-3 pt-6">
              {state.post.comments.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  아직 댓글이 없습니다.
                </p>
              ) : (
                state.post.comments.map((comment) => (
                  <div
                    key={comment.id}
                    className="flex flex-wrap items-baseline gap-2 border-b border-border py-2.5 text-sm last:border-b-0"
                  >
                    <span className="font-bold">
                      {comment.authorName ?? BOARD_COMMENT_AUTHOR_LABEL}
                    </span>
                    <StatusBadge
                      variant={
                        BOARD_COMMENT_AUTHOR_ROLE_VARIANT[comment.authorRole]
                      }
                      aria-label={`${boardCommentAuthorRoleLabel(comment.authorRole)} 역할`}
                    >
                      {boardCommentAuthorRoleLabel(comment.authorRole)}
                    </StatusBadge>
                    {/* 본문과 같은 이유로 접는다 — `PostBody` 주석 참고. */}
                    <span className="min-w-0 flex-1 leading-6 text-foreground [overflow-wrap:anywhere]">
                      {comment.body}
                    </span>
                    <span className="tabular-nums text-xs text-muted-foreground">
                      {formatBoardDateTime(comment.createdAt)}
                    </span>
                    {comment.canDelete ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        disabled={deletingCommentId === comment.id}
                        onClick={() => onDeleteComment(comment.id)}
                      >
                        삭제
                      </Button>
                    ) : null}
                  </div>
                ))
              )}
              {commentSubmitError ? (
                <Alert variant="destructive">
                  <AlertDescription>{commentSubmitError}</AlertDescription>
                </Alert>
              ) : null}
              {/* 오류가 입력칸 밑에 붙어도 버튼이 내려가지 않도록 윗줄에 맞춘다. */}
              <div className="mt-2 flex items-start gap-2">
                <Field
                  className="min-w-0 flex-1"
                  data-invalid={showCommentError || undefined}
                >
                  <Input
                    aria-label="댓글 내용"
                    ref={commentRef}
                    value={commentDraft}
                    maxLength={2000}
                    disabled={commentSubmitting}
                    aria-invalid={showCommentError}
                    aria-describedby={
                      showCommentError ? COMMENT_ERROR_ID : undefined
                    }
                    onChange={(event) =>
                      onCommentDraftChange(event.target.value)
                    }
                    placeholder="댓글을 입력하세요"
                  />
                  {showCommentError ? (
                    <FieldError id={COMMENT_ERROR_ID}>
                      {commentDraftError}
                    </FieldError>
                  ) : null}
                </Field>
                <Button
                  type="button"
                  disabled={commentSubmitting}
                  onClick={handleSubmitComment}
                >
                  댓글 달기
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </main>
  );
}

export function BoardDetailView({
  programId,
  postId,
  isStaff,
}: {
  readonly programId: string;
  readonly postId: string;
  readonly isStaff: boolean;
}) {
  const router = useRouter();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<BoardDetailState>({ kind: 'loading' });
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editSubmitted, setEditSubmitted] = useState(false);
  const [editSubmitError, setEditSubmitError] = useState<string | null>(null);
  const [pinSubmitting, setPinSubmitting] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [commentSubmitted, setCommentSubmitted] = useState(false);
  const [commentSubmitError, setCommentSubmitError] = useState<string | null>(
    null,
  );
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(
    null,
  );

  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  /*
    가입 프로필·설정 폼과 같은 방식이다 — 한 번 제출한 뒤부터는 지금 입력값으로 매번 다시
    판정한다. 그래서 비운 칸을 채우면 그 칸의 빨간색이 사라지고, 공백만 친 칸은 그대로 남는다.
  */
  const editErrors = useMemo(
    () => validateBoardPostInput({ title: editTitle, body: editBody }),
    [editTitle, editBody],
  );
  const commentDraftError = useMemo(
    () => validateBoardCommentInput(commentDraft),
    [commentDraft],
  );

  useEffect(() => {
    let active = true;
    setState({ kind: 'loading' });
    getBoardPost(programId, postId)
      .then((post) => {
        if (active) setState({ kind: 'ready', post });
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiError && error.problem.code === 'BRD_002') {
          setState({ kind: 'not-found' });
          return;
        }
        const message =
          error instanceof ApiError
            ? mapBoardError(error.problem)
            : '잠시 후 다시 시도해 주세요.';
        setState({ kind: 'error', message });
      });
    return () => {
      active = false;
    };
  }, [programId, postId, attempt]);

  const toggleEdit = useCallback(() => {
    if (state.kind !== 'ready') return;
    setEditing((open) => {
      const next = !open;
      if (next) {
        setEditTitle(state.post.title);
        setEditBody(state.post.body);
        setEditSubmitted(false);
        setEditSubmitError(null);
      }
      return next;
    });
  }, [state]);

  const submitEdit = useCallback(() => {
    if (state.kind !== 'ready') return;
    setEditSubmitted(true);
    if (hasBoardPostInputError(editErrors)) return;
    setEditSubmitting(true);
    setEditSubmitError(null);
    updateBoardPost(programId, postId, { title: editTitle, body: editBody })
      .then((post) => {
        setState({ kind: 'ready', post });
        setEditing(false);
      })
      .catch((error: unknown) => {
        setEditSubmitError(
          error instanceof ApiError
            ? mapBoardError(error.problem)
            : '잠시 후 다시 시도해 주세요.',
        );
      })
      .finally(() => setEditSubmitting(false));
  }, [state, programId, postId, editTitle, editBody, editErrors]);

  const deletePost = useCallback(() => {
    if (state.kind !== 'ready') return;
    if (!window.confirm('게시글을 삭제하시겠습니까?')) return;
    setDeleteSubmitting(true);
    setDeleteError(null);
    deleteBoardPost(programId, postId)
      .then(() => {
        invalidateBoardList(programId);
        router.push(boardListHref(programId));
      })
      .catch((error: unknown) => {
        setDeleteSubmitting(false);
        setDeleteError(
          error instanceof ApiError
            ? mapBoardError(error.problem)
            : '잠시 후 다시 시도해 주세요.',
        );
      });
  }, [state, programId, postId, router]);

  const togglePin = useCallback(() => {
    if (state.kind !== 'ready') return;
    const nextPinned = !state.post.pinned;
    setPinSubmitting(true);
    setPinError(null);
    setBoardPostPinned(programId, postId, nextPinned)
      .then(({ pinned }) => {
        setState((current) =>
          current.kind === 'ready'
            ? { kind: 'ready', post: { ...current.post, pinned } }
            : current,
        );
      })
      .catch((error: unknown) => {
        setPinError(
          error instanceof ApiError
            ? mapBoardError(error.problem)
            : '잠시 후 다시 시도해 주세요.',
        );
      })
      .finally(() => setPinSubmitting(false));
  }, [state, programId, postId]);

  const submitComment = useCallback(() => {
    if (state.kind !== 'ready') return;
    setCommentSubmitted(true);
    if (commentDraftError) return;
    setCommentSubmitting(true);
    setCommentSubmitError(null);
    createBoardComment(programId, postId, { body: commentDraft })
      .then((comment) => {
        setState((current) =>
          current.kind === 'ready'
            ? {
                kind: 'ready',
                post: {
                  ...current.post,
                  comments: [...current.post.comments, comment],
                  commentCount: current.post.commentCount + 1,
                },
              }
            : current,
        );
        setCommentDraft('');
        // 보낸 뒤 빈 칸이 곧바로 빨개지지 않도록 「한 번 제출했다」를 되돌린다.
        setCommentSubmitted(false);
      })
      .catch((error: unknown) => {
        setCommentSubmitError(
          error instanceof ApiError
            ? mapBoardError(error.problem)
            : '잠시 후 다시 시도해 주세요.',
        );
      })
      .finally(() => setCommentSubmitting(false));
  }, [state, programId, postId, commentDraft, commentDraftError]);

  const deleteComment = useCallback(
    (commentId: string) => {
      if (state.kind !== 'ready') return;
      if (!window.confirm('댓글을 삭제하시겠습니까?')) return;
      setDeletingCommentId(commentId);
      setCommentSubmitError(null);
      deleteBoardComment(programId, postId, commentId)
        .then(() => {
          setState((current) =>
            current.kind === 'ready'
              ? {
                  kind: 'ready',
                  post: {
                    ...current.post,
                    comments: current.post.comments.filter(
                      (comment) => comment.id !== commentId,
                    ),
                    commentCount: Math.max(0, current.post.commentCount - 1),
                  },
                }
              : current,
          );
        })
        .catch((error: unknown) => {
          setCommentSubmitError(
            error instanceof ApiError
              ? mapBoardError(error.problem)
              : '잠시 후 다시 시도해 주세요.',
          );
        })
        .finally(() => setDeletingCommentId(null));
    },
    [state, programId, postId],
  );

  return (
    <BoardDetailContent
      programId={programId}
      isStaff={isStaff}
      state={state}
      editing={editing}
      editTitle={editTitle}
      editBody={editBody}
      editSubmitting={editSubmitting}
      editErrors={editErrors}
      editShowFieldErrors={editSubmitted}
      editSubmitError={editSubmitError}
      pinSubmitting={pinSubmitting}
      pinError={pinError}
      deleteSubmitting={deleteSubmitting}
      deleteError={deleteError}
      commentDraft={commentDraft}
      commentSubmitting={commentSubmitting}
      commentDraftError={commentDraftError}
      commentShowDraftError={commentSubmitted}
      commentSubmitError={commentSubmitError}
      deletingCommentId={deletingCommentId}
      onRetry={retry}
      onToggleEdit={toggleEdit}
      onEditTitleChange={setEditTitle}
      onEditBodyChange={setEditBody}
      onSubmitEdit={submitEdit}
      onDeletePost={deletePost}
      onTogglePin={togglePin}
      onCommentDraftChange={setCommentDraft}
      onSubmitComment={submitComment}
      onDeleteComment={deleteComment}
    />
  );
}
