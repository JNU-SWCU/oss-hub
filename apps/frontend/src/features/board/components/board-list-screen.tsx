'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError } from '@/lib/api-client';
import { createBoardPost, listBoardPosts } from '../api';
import { subscribeBoardListInvalidation } from '../board-list-refetch';
import {
  hasBoardPostInputError,
  mapBoardError,
  validateBoardPostInput,
} from '../board-format';
import { boardPostHref } from '../board-paths';
import type { BoardListState } from '../types';
import { BOARD_PAGE_SIZE } from '../board-pagination';
import { BoardListContent } from './board-list-content';

const BOARD_PARTICIPATION_REQUIRED_CODE = 'BRD_001';

export function BoardListScreen({
  programId,
  isStaff,
}: {
  readonly programId: string;
  readonly isStaff: boolean;
}) {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<BoardListState>({ kind: 'loading' });
  const [newPostOpen, setNewPostOpen] = useState(false);
  const [newPostTitle, setNewPostTitle] = useState('');
  const [newPostBody, setNewPostBody] = useState('');
  const [newPostSubmitting, setNewPostSubmitting] = useState(false);
  const [newPostSubmitted, setNewPostSubmitted] = useState(false);
  const [newPostSubmitError, setNewPostSubmitError] = useState<string | null>(
    null,
  );

  const newPostErrors = useMemo(
    () => validateBoardPostInput({ title: newPostTitle, body: newPostBody }),
    [newPostTitle, newPostBody],
  );

  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  useEffect(() => {
    let active = true;
    const loadPosts = () => {
      setState({ kind: 'loading' });
      listBoardPosts(programId, { page, limit: BOARD_PAGE_SIZE })
        .then((result) => {
          if (active) setState({ kind: 'ready', page: result });
        })
        .catch((error: unknown) => {
          if (!active) return;
          if (
            error instanceof ApiError &&
            error.problem.code === BOARD_PARTICIPATION_REQUIRED_CODE
          ) {
            setState({ kind: 'not-participant' });
            return;
          }
          const message =
            error instanceof ApiError
              ? mapBoardError(error.problem)
              : '잠시 후 다시 시도해 주세요.';
          setState({ kind: 'error', message });
        });
    };
    const unsubscribe = subscribeBoardListInvalidation(programId, loadPosts);
    loadPosts();
    return () => {
      active = false;
      unsubscribe();
    };
  }, [programId, page, attempt]);

  const toggleNewPost = useCallback(() => {
    setNewPostOpen((open) => !open);
    setNewPostTitle('');
    setNewPostBody('');
    setNewPostSubmitted(false);
    setNewPostSubmitError(null);
  }, []);

  const submitNewPost = useCallback(() => {
    setNewPostSubmitted(true);
    if (hasBoardPostInputError(newPostErrors)) return;
    setNewPostSubmitting(true);
    setNewPostSubmitError(null);
    createBoardPost(programId, { title: newPostTitle, body: newPostBody })
      .then((post) => {
        router.push(boardPostHref(programId, post.id));
      })
      .catch((error: unknown) => {
        setNewPostSubmitting(false);
        setNewPostSubmitError(
          error instanceof ApiError
            ? mapBoardError(error.problem)
            : '잠시 후 다시 시도해 주세요.',
        );
      });
  }, [programId, newPostTitle, newPostBody, newPostErrors, router]);

  return (
    <BoardListContent
      programId={programId}
      isStaff={isStaff}
      state={state}
      page={page}
      newPostOpen={newPostOpen}
      newPostTitle={newPostTitle}
      newPostBody={newPostBody}
      newPostSubmitting={newPostSubmitting}
      newPostErrors={newPostErrors}
      newPostShowFieldErrors={newPostSubmitted}
      newPostSubmitError={newPostSubmitError}
      onToggleNewPost={toggleNewPost}
      onTitleChange={setNewPostTitle}
      onBodyChange={setNewPostBody}
      onSubmitNewPost={submitNewPost}
      onPageChange={setPage}
      onRetry={retry}
    />
  );
}
