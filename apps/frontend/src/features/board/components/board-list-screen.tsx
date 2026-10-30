'use client';

import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { programFeatureKey } from '@/lib/query-keys';
import { useBoardListUrlState } from '../board-list-url-state';
import { useBoardListQuery } from '../queries';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError } from '@/lib/api-client';
import { createBoardPost } from '../api';
import {
  invalidateBoardList,
  subscribeBoardListInvalidation,
} from '../board-list-refetch';
import {
  hasBoardPostInputError,
  mapBoardError,
  validateBoardPostInput,
} from '../board-format';
import { boardPostHref } from '../board-paths';
import type { BoardListState } from '../types';
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
  const {
    state: { page },
    navigate,
  } = useBoardListUrlState();
  const queryClient = useQueryClient();
  const query = useBoardListQuery(programId, page);
  const state: BoardListState = query.isPending
    ? { kind: 'loading' }
    : query.isError
      ? query.error instanceof ApiError &&
        query.error.problem.code === BOARD_PARTICIPATION_REQUIRED_CODE
        ? { kind: 'not-participant' }
        : {
            kind: 'error',
            message:
              query.error instanceof ApiError
                ? mapBoardError(query.error.problem)
                : '잠시 후 다시 시도해 주세요.',
          }
      : { kind: 'ready', page: query.data };
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

  const retry = () => void query.refetch();

  useEffect(
    () =>
      subscribeBoardListInvalidation(programId, () => {
        void queryClient.invalidateQueries({
          queryKey: programFeatureKey(programId, 'board'),
        });
      }),
    [programId, queryClient],
  );

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
        invalidateBoardList(programId);
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
      onPageChange={(nextPage) => navigate({ page: nextPage })}
      onRetry={retry}
    />
  );
}
