'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
  hasBoardPostInputError,
  mapBoardError,
  validateBoardCommentInput,
  validateBoardPostInput,
} from '../board-format';
import { boardListHref } from '../board-paths';
import type { BoardDetailState } from '../types';
import { BoardDetailContent } from './board-detail-content';

export function BoardDetailScreen({
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
