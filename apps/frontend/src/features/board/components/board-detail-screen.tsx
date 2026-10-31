'use client';

import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { ApiError } from '@/lib/api-client';
import {
  createBoardComment,
  deleteBoardComment,
  deleteBoardPost,
  setBoardPostPinned,
  updateBoardPost,
} from '../api';
import { boardPostKey, invalidateBoard, useBoardPostQuery } from '../queries';
import {
  hasBoardPostInputError,
  mapBoardError,
  validateBoardCommentInput,
  validateBoardPostInput,
} from '../board-format';
import { boardListHref } from '../board-paths';
import type { BoardDetailState, BoardPostDetail } from '../types';
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
  const queryClient = useQueryClient();
  const query = useBoardPostQuery(programId, postId);
  const state: BoardDetailState =
    query.isError &&
    query.error instanceof ApiError &&
    query.error.problem.code === 'BRD_002'
      ? { kind: 'not-found' }
      : query.data !== undefined
        ? { kind: 'ready', post: query.data }
        : query.isError
          ? {
              kind: 'error',
              message:
                query.error instanceof ApiError
                  ? mapBoardError(query.error.problem)
                  : '잠시 후 다시 시도해 주세요.',
            }
          : { kind: 'loading' };
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

  const { refetch } = query;
  const retry = useCallback(() => void refetch(), [refetch]);

  const applyPost = useCallback(
    (update: (post: BoardPostDetail) => BoardPostDetail) => {
      queryClient.setQueryData<BoardPostDetail>(
        boardPostKey(programId, postId),
        (current) => (current === undefined ? current : update(current)),
      );
      void invalidateBoard(queryClient, programId);
    },
    [queryClient, programId, postId],
  );

  const editErrors = useMemo(
    () => validateBoardPostInput({ title: editTitle, body: editBody }),
    [editTitle, editBody],
  );
  const commentDraftError = useMemo(
    () => validateBoardCommentInput(commentDraft),
    [commentDraft],
  );

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
        applyPost(() => post);
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
  }, [state, programId, postId, editTitle, editBody, editErrors, applyPost]);

  const deletePost = useCallback(() => {
    if (state.kind !== 'ready') return;
    if (!window.confirm('게시글을 삭제하시겠습니까?')) return;
    setDeleteSubmitting(true);
    setDeleteError(null);
    deleteBoardPost(programId, postId)
      .then(() => {
        queryClient.removeQueries({
          queryKey: boardPostKey(programId, postId),
          exact: true,
        });
        void invalidateBoard(queryClient, programId, postId);
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
  }, [state, programId, postId, router, queryClient]);

  const togglePin = useCallback(() => {
    if (state.kind !== 'ready') return;
    const nextPinned = !state.post.pinned;
    setPinSubmitting(true);
    setPinError(null);
    setBoardPostPinned(programId, postId, nextPinned)
      .then(({ pinned }) => {
        applyPost((current) => ({ ...current, pinned }));
      })
      .catch((error: unknown) => {
        setPinError(
          error instanceof ApiError
            ? mapBoardError(error.problem)
            : '잠시 후 다시 시도해 주세요.',
        );
      })
      .finally(() => setPinSubmitting(false));
  }, [state, programId, postId, applyPost]);

  const submitComment = useCallback(() => {
    if (state.kind !== 'ready') return;
    setCommentSubmitted(true);
    if (commentDraftError) return;
    setCommentSubmitting(true);
    setCommentSubmitError(null);
    createBoardComment(programId, postId, { body: commentDraft })
      .then((comment) => {
        applyPost((current) => ({
          ...current,
          comments: [...current.comments, comment],
          commentCount: current.commentCount + 1,
        }));
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
  }, [state, programId, postId, commentDraft, commentDraftError, applyPost]);

  const deleteComment = useCallback(
    (commentId: string) => {
      if (state.kind !== 'ready') return;
      if (!window.confirm('댓글을 삭제하시겠습니까?')) return;
      setDeletingCommentId(commentId);
      setCommentSubmitError(null);
      deleteBoardComment(programId, postId, commentId)
        .then(() => {
          applyPost((current) => ({
            ...current,
            comments: current.comments.filter(
              (comment) => comment.id !== commentId,
            ),
            commentCount: Math.max(0, current.commentCount - 1),
          }));
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
    [state, programId, postId, applyPost],
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
