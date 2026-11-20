'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useUrlSearchDraft } from '@/lib/list-url-state';
import { useRequirementCollectionUrlState } from './requirement-collection-url-state';
import {
  useRequirementCollectionQuery,
  useRequirementReviewHistoryQuery,
} from './queries';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateProgram } from '../catalog/queries';
import { ApiError } from '@/lib/api-client';
import { requirementCollectionLoadPhase } from './requirement-collection';
import type {
  RequirementCollectionArchiveGrouping,
  RequirementCollectionCell,
  RequirementCollectionQueryInput,
} from './requirement-collection-dto';
import {
  RequirementCollectionView,
  type RequirementCollectionPresentation,
} from './requirement-collection-view';
import {
  isRequirementReviewTargetChanged,
  requirementReviewConflictNotice,
  requirementReviewConflictOf,
  type RequirementCollectionReloadResult,
  type RequirementReviewConflict,
} from './requirement-conflict';
import {
  requirementReviewCommentPayload,
  requirementReviewFormError,
  requirementReviewVersionError,
  requirementReviewVersionOf,
  nextRequirementReviewState,
  type RequirementReviewFormState,
  type RequirementReviewTarget,
} from './requirement-review';
import { createRequirementReview } from './requirement-review-api';
import type { RequirementReviewDecision } from './requirement-review-dto';

export function RequirementCollectionScreen({
  programId,
  milestoneId,
  headerActions,
  Table,
  StatusFilters,
}: {
  readonly programId: string;
  readonly milestoneId: string;
  readonly headerActions?: ReactNode;
} & RequirementCollectionPresentation) {
  const queryClient = useQueryClient();
  const { state: query, navigate } = useRequirementCollectionUrlState();
  const sort = query.sort ?? 'team';
  const direction = query.direction ?? 'asc';
  const [search, setSearch] = useUrlSearchDraft(query.q);
  const result = useRequirementCollectionQuery(programId, milestoneId, query);
  const [conflictFailed, setConflictFailed] = useState(false);
  const isLoading = result.isFetching;
  const errorMessage = result.isError
    ? result.error instanceof ApiError
      ? result.error.problem.detail
      : '서류 수합 표를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'
    : null;
  const [review, setReview] = useState<
    | (RequirementReviewFormState & {
        readonly cell: RequirementCollectionCell;
      })
    | null
  >(null);

  const [reviewNotice, setReviewNotice] = useState<string | null>(null);

  const [archiveGrouping, setArchiveGrouping] =
    useState<RequirementCollectionArchiveGrouping>('TEAM');
  const currentQuery = JSON.stringify([milestoneId, query]);
  const queryRef = useRef(currentQuery);
  queryRef.current = currentQuery;

  const reviewRequestIdRef = useRef(0);
  const historyQuery = useRequirementReviewHistoryQuery(
    programId,
    milestoneId,
    review?.target ?? null,
  );
  const historyPages = historyQuery.data?.pages ?? [];
  const lastHistoryPage = historyPages.at(-1);
  const visibleReview =
    review === null
      ? null
      : {
          ...review,
          history: historyPages.toReversed().flatMap((page) => page.items),
          historyNextCursor: lastHistoryPage?.nextCursor ?? null,
          historyIsComplete: lastHistoryPage?.isComplete ?? true,
          isHistoryLoading: historyQuery.isFetching,
          historyError: historyQuery.isError
            ? '제출 이력을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'
            : null,
        };

  useEffect(() => {
    reviewRequestIdRef.current += 1;
    setReview(null);
    setReviewNotice(null);
    setConflictFailed(false);
  }, [currentQuery]);

  const discardPendingReview = useCallback(() => {
    reviewRequestIdRef.current += 1;
  }, []);

  const navigateCollection = (
    next: Partial<RequirementCollectionQueryInput>,
    mode?: 'push' | 'replace',
  ) => {
    discardPendingReview();
    setReview(null);
    setReviewNotice(null);
    setConflictFailed(false);
    navigate(next, mode);
  };

  const reloadCollection =
    useCallback(async (): Promise<RequirementCollectionReloadResult> => {
      const next = await result.refetch();
      if (queryRef.current !== currentQuery) return 'superseded';
      if (next.isError) return 'failed';
      setConflictFailed(false);
      return 'reloaded';
    }, [result.refetch, currentQuery]);

  const reload = useCallback(() => {
    void reloadCollection();
  }, [reloadCollection]);

  const reloadAfterReviewConflict = useCallback(
    async (conflict: RequirementReviewConflict, requestId: number) => {
      setReviewNotice(null);
      const result = await reloadCollection();

      if (result === 'superseded') return;

      if (result === 'failed') setConflictFailed(true);

      if (requestId !== reviewRequestIdRef.current) return;
      const notice = requirementReviewConflictNotice(conflict, result);
      if (notice !== null) setReviewNotice(notice);
    },
    [reloadCollection],
  );

  const submitReview = useCallback(async () => {
    if (review === null) return;
    const { decision, comment, target, version } = review;

    const formError =
      requirementReviewFormError(decision, comment) ??
      requirementReviewVersionError(version);

    if (formError !== null || decision === null || version === null) {
      setReview((previous) =>
        previous === null
          ? previous
          : {
              ...previous,
              errorMessage:
                formError ?? '승인, 보완 요청, 반려 중 하나를 골라 주세요.',
            },
      );
      return;
    }

    reviewRequestIdRef.current += 1;
    const requestId = reviewRequestIdRef.current;
    setReview((previous) =>
      previous === null
        ? previous
        : { ...previous, isSubmitting: true, errorMessage: null },
    );
    try {
      await createRequirementReview(
        milestoneId,
        target.documentId,
        target.teamId,
        {
          decision,
          comment: requirementReviewCommentPayload(comment),

          expectedRevision: version.expectedRevision,
          expectedLatestReviewId: version.expectedLatestReviewId,
        },
      );
      if (requestId !== reviewRequestIdRef.current) {
        void invalidateProgram(queryClient, programId);
        return;
      }

      setReviewNotice(null);
      setReview(null);
      void invalidateProgram(queryClient, programId);
    } catch (error) {
      if (requestId !== reviewRequestIdRef.current) return;

      const conflict = requirementReviewConflictOf(error);

      if (conflict !== null && isRequirementReviewTargetChanged(conflict)) {
        setReview(null);
        await reloadAfterReviewConflict(conflict, requestId);
        return;
      }
      setReview((previous) =>
        previous === null
          ? previous
          : {
              ...previous,
              isSubmitting: false,
              errorMessage:
                error instanceof ApiError
                  ? error.problem.detail
                  : '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.',
            },
      );
      if (conflict !== null) {
        await reloadAfterReviewConflict(conflict, requestId);
      }
    }
  }, [milestoneId, programId, queryClient, reloadAfterReviewConflict, review]);

  const data = conflictFailed ? null : (result.data ?? null);

  return (
    <RequirementCollectionView
      programId={programId}
      headerActions={headerActions}
      Table={Table}
      StatusFilters={StatusFilters}
      data={data}
      search={search}
      searchQuery={query.q}
      status={query.status}
      sort={sort}
      direction={direction}
      onSearchChange={setSearch}
      onSearch={() =>
        navigateCollection({ q: search.trim(), page: 1 }, 'replace')
      }
      onStatusChange={(status) => navigateCollection({ status, page: 1 })}
      onSort={(next) =>
        navigateCollection({
          sort: next,
          direction: next === sort && direction === 'asc' ? 'desc' : 'asc',
          page: 1,
        })
      }
      loadPhase={requirementCollectionLoadPhase({ data, isLoading })}
      errorMessage={errorMessage}
      review={visibleReview}
      reviewNotice={reviewNotice}
      archiveGrouping={archiveGrouping}

      onResetFilters={() => {
        setSearch('');
        navigateCollection({ status: undefined, page: 1, q: '' });
      }}
      onArchiveGroupingChange={setArchiveGrouping}
      onPageChange={(page) => navigateCollection({ page })}
      onRetry={reload}
      onReviewOpen={(
        target: RequirementReviewTarget,
        cell: RequirementCollectionCell,
      ) => {
        discardPendingReview();

        setReviewNotice(null);
        setReview((previous) => {
          const next = nextRequirementReviewState(
            previous,
            target,
            requirementReviewVersionOf(cell),
          );
          return next === null ? null : { ...next, cell };
        });
      }}
      onReviewClose={() => {
        discardPendingReview();
        setReview(null);
      }}
      onReviewDecisionChange={(decision: RequirementReviewDecision) =>
        setReview((previous) =>
          previous === null
            ? previous
            : { ...previous, decision, errorMessage: null },
        )
      }
      onReviewCommentChange={(comment: string) =>
        setReview((previous) =>
          previous === null ? previous : { ...previous, comment },
        )
      }
      onReviewSubmit={() => void submitReview()}
      onReviewHistoryMore={() => {
        if (historyQuery.data === undefined) void historyQuery.refetch();
        else void historyQuery.fetchNextPage();
      }}
    />
  );
}
