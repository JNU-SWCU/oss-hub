'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, ChevronLeft, Pin, PinOff, RotateCcw } from 'lucide-react';
import { PageHeader, StatusBadge } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
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
  mapBoardError,
  validateBoardCommentInput,
  validateBoardPostInput,
} from '../board-format';
import { boardListHref } from '../board-paths';
import type { BoardDetailState, BoardPostDetail } from '../types';

export interface BoardDetailContentProps {
  readonly programId: string;
  readonly isStaff: boolean;
  readonly state: BoardDetailState;
  readonly editing: boolean;
  readonly editTitle: string;
  readonly editBody: string;
  readonly editSubmitting: boolean;
  readonly editError: string | null;
  readonly pinSubmitting: boolean;
  readonly pinError: string | null;
  readonly deleteSubmitting: boolean;
  readonly deleteError: string | null;
  readonly commentDraft: string;
  readonly commentSubmitting: boolean;
  readonly commentError: string | null;
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

function PostBody({ post }: { readonly post: BoardPostDetail }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="max-w-[70ch] whitespace-pre-wrap text-sm leading-7 text-foreground">
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
  editError,
  pinSubmitting,
  pinError,
  deleteSubmitting,
  deleteError,
  commentDraft,
  commentSubmitting,
  commentError,
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
            <Field>
              <FieldLabel htmlFor="board-edit-title">제목</FieldLabel>
              <Input
                id="board-edit-title"
                value={editTitle}
                maxLength={200}
                disabled={editSubmitting}
                onChange={(event) => onEditTitleChange(event.target.value)}
                placeholder="제목"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="board-edit-body">내용</FieldLabel>
              <textarea
                id="board-edit-body"
                value={editBody}
                maxLength={10000}
                rows={6}
                disabled={editSubmitting}
                onChange={(event) => onEditBodyChange(event.target.value)}
                placeholder="내용"
                className="min-h-28 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </Field>
            {editError ? (
              <Alert variant="destructive">
                <AlertDescription>{editError}</AlertDescription>
              </Alert>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                size="sm"
                disabled={editSubmitting}
                onClick={onSubmitEdit}
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
            description={`${boardPostAuthorRoleLabel(state.post.category)} · ${formatBoardDateTime(state.post.createdAt)}`}
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
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onToggleEdit}
                >
                  수정
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={deleteSubmitting}
                  onClick={onDeletePost}
                >
                  {deleteSubmitting ? '삭제 중…' : '삭제'}
                </Button>
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
                      {BOARD_COMMENT_AUTHOR_LABEL}
                    </span>
                    <StatusBadge
                      variant={
                        BOARD_COMMENT_AUTHOR_ROLE_VARIANT[comment.authorRole]
                      }
                      aria-label={`${boardCommentAuthorRoleLabel(comment.authorRole)} 역할`}
                    >
                      {boardCommentAuthorRoleLabel(comment.authorRole)}
                    </StatusBadge>
                    <span className="min-w-0 flex-1 leading-6 text-foreground">
                      {comment.body}
                    </span>
                    <span className="tabular-nums text-xs text-muted-foreground">
                      {formatBoardDateTime(comment.createdAt)}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      disabled={deletingCommentId === comment.id}
                      onClick={() => onDeleteComment(comment.id)}
                    >
                      삭제
                    </Button>
                  </div>
                ))
              )}
              {commentError ? (
                <Alert variant="destructive">
                  <AlertDescription>{commentError}</AlertDescription>
                </Alert>
              ) : null}
              <div className="mt-2 flex gap-2">
                <Input
                  aria-label="댓글 내용"
                  value={commentDraft}
                  maxLength={2000}
                  disabled={commentSubmitting}
                  onChange={(event) => onCommentDraftChange(event.target.value)}
                  placeholder="댓글을 입력하세요"
                />
                <Button
                  type="button"
                  disabled={commentSubmitting}
                  onClick={onSubmitComment}
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
  const [editError, setEditError] = useState<string | null>(null);
  const [pinSubmitting, setPinSubmitting] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(
    null,
  );

  const retry = useCallback(() => setAttempt((current) => current + 1), []);

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
        setEditError(null);
      }
      return next;
    });
  }, [state]);

  const submitEdit = useCallback(() => {
    if (state.kind !== 'ready') return;
    const validationError = validateBoardPostInput({
      title: editTitle,
      body: editBody,
    });
    if (validationError) {
      setEditError(validationError);
      return;
    }
    setEditSubmitting(true);
    setEditError(null);
    updateBoardPost(programId, postId, { title: editTitle, body: editBody })
      .then((post) => {
        setState({ kind: 'ready', post });
        setEditing(false);
      })
      .catch((error: unknown) => {
        setEditError(
          error instanceof ApiError
            ? mapBoardError(error.problem)
            : '잠시 후 다시 시도해 주세요.',
        );
      })
      .finally(() => setEditSubmitting(false));
  }, [state, programId, postId, editTitle, editBody]);

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
    const validationError = validateBoardCommentInput(commentDraft);
    if (validationError) {
      setCommentError(validationError);
      return;
    }
    setCommentSubmitting(true);
    setCommentError(null);
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
      })
      .catch((error: unknown) => {
        setCommentError(
          error instanceof ApiError
            ? mapBoardError(error.problem)
            : '잠시 후 다시 시도해 주세요.',
        );
      })
      .finally(() => setCommentSubmitting(false));
  }, [state, programId, postId, commentDraft]);

  const deleteComment = useCallback(
    (commentId: string) => {
      if (state.kind !== 'ready') return;
      if (!window.confirm('댓글을 삭제하시겠습니까?')) return;
      setDeletingCommentId(commentId);
      setCommentError(null);
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
          setCommentError(
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
      editError={editError}
      pinSubmitting={pinSubmitting}
      pinError={pinError}
      deleteSubmitting={deleteSubmitting}
      deleteError={deleteError}
      commentDraft={commentDraft}
      commentSubmitting={commentSubmitting}
      commentError={commentError}
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
