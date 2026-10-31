'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMilestoneDocumentCollectionUrlState } from './milestone-document-collection-url-state';
import {
  useMilestoneDocumentCollectionQuery,
  useMilestoneDocumentReviewHistoryQuery,
} from './queries';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateProgram } from '../catalog/queries';
import { ApiError } from '@/lib/api-client';
import {
  milestoneDocumentCollectionLoadPhase,
  selectCollectionDocument,
} from './milestone-document-collection';
import type {
  MilestoneDocumentCollectionArchiveGrouping,
  MilestoneDocumentCollectionFilter,
} from './milestone-document-collection-dto';
import { MilestoneDocumentCollectionView } from './milestone-document-collection-view';
import {
  isMilestoneDocumentReviewTargetChanged,
  milestoneDocumentReviewConflictNotice,
  milestoneDocumentReviewConflictOf,
  type MilestoneDocumentCollectionReloadResult,
  type MilestoneDocumentReviewConflict,
} from './milestone-document-conflict';
import {
  milestoneDocumentResubmissionDueAtPayload,
  milestoneDocumentReviewCommentPayload,
  milestoneDocumentReviewFormError,
  milestoneDocumentReviewVersionError,
  nextMilestoneDocumentReviewState,
  type MilestoneDocumentReviewFormState,
  type MilestoneDocumentReviewTarget,
  type MilestoneDocumentReviewVersion,
} from './milestone-document-review';
import { createMilestoneDocumentReview } from './milestone-document-review-api';
import type { MilestoneDocumentReviewDecision } from './milestone-document-review-dto';

export function MilestoneDocumentCollectionScreen({
  programId,
  milestoneId,
}: {
  readonly programId: string;
  readonly milestoneId: string;
}) {
  const queryClient = useQueryClient();
  const { state: query, navigate } = useMilestoneDocumentCollectionUrlState();
  const result = useMilestoneDocumentCollectionQuery(
    programId,
    milestoneId,
    query,
  );
  const [conflictFailed, setConflictFailed] = useState(false);
  const isLoading = result.isFetching;
  const errorMessage = result.isError
    ? result.error instanceof ApiError
      ? result.error.problem.detail
      : '서류 수합 표를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'
    : null;
  const [review, setReview] = useState<MilestoneDocumentReviewFormState | null>(
    null,
  );

  const [reviewNotice, setReviewNotice] = useState<string | null>(null);

  const [archiveGrouping, setArchiveGrouping] =
    useState<MilestoneDocumentCollectionArchiveGrouping>('TEAM');
  const currentQuery = JSON.stringify([milestoneId, query]);
  const queryRef = useRef(currentQuery);
  queryRef.current = currentQuery;

  const reviewRequestIdRef = useRef(0);
  const historyQuery = useMilestoneDocumentReviewHistoryQuery(
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

  const reloadCollection =
    useCallback(async (): Promise<MilestoneDocumentCollectionReloadResult> => {
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
    async (conflict: MilestoneDocumentReviewConflict, requestId: number) => {
      setReviewNotice(null);
      const result = await reloadCollection();

      if (result === 'superseded') return;

      if (result === 'failed') setConflictFailed(true);

      if (requestId !== reviewRequestIdRef.current) return;
      const notice = milestoneDocumentReviewConflictNotice(conflict, result);
      if (notice !== null) setReviewNotice(notice);
    },
    [reloadCollection],
  );

  const submitReview = useCallback(async () => {
    if (review === null) return;
    const { decision, comment, resubmissionDueAt, target, version } = review;

    const formError =
      milestoneDocumentReviewFormError(decision, comment, resubmissionDueAt) ??
      milestoneDocumentReviewVersionError(version);

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
      await createMilestoneDocumentReview(
        milestoneId,
        target.documentId,
        target.applicationId,
        {
          decision,
          comment: milestoneDocumentReviewCommentPayload(comment),

          resubmissionDueAt: milestoneDocumentResubmissionDueAtPayload(
            decision,
            resubmissionDueAt,
          ),

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

      const conflict = milestoneDocumentReviewConflictOf(error);

      if (
        conflict !== null &&
        isMilestoneDocumentReviewTargetChanged(conflict)
      ) {
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
    <MilestoneDocumentCollectionView
      programId={programId}
      data={data}
      filter={query.filter}
      documentSelection={query.document ?? null}
      onDocumentSelectionChange={(document) => {
        discardPendingReview();
        setReview(null);
        setReviewNotice(null);
        setConflictFailed(false);
        navigate({
          ...selectCollectionDocument(query, document),
          document: document ?? undefined,
        });
      }}
      loadPhase={milestoneDocumentCollectionLoadPhase({ data, isLoading })}
      errorMessage={errorMessage}
      review={visibleReview}
      reviewNotice={reviewNotice}
      archiveGrouping={archiveGrouping}

      onResetFilters={() => {
        discardPendingReview();
        setReview(null);
        setReviewNotice(null);
        setConflictFailed(false);
        navigate({ document: undefined, filter: 'ALL', page: 1 });
      }}
      onArchiveGroupingChange={setArchiveGrouping}
      onFilterChange={(filter: MilestoneDocumentCollectionFilter) => {
        discardPendingReview();
        setReview(null);

        setReviewNotice(null);

        setConflictFailed(false);
        navigate({ filter, page: 1 });
      }}
      onPageChange={(page: number) => {
        discardPendingReview();
        setReview(null);
        setReviewNotice(null);
        setConflictFailed(false);
        navigate({ page });
      }}
      onRetry={reload}
      onReviewOpen={(
        target: MilestoneDocumentReviewTarget,
        version: MilestoneDocumentReviewVersion | null,
      ) => {
        discardPendingReview();

        setReviewNotice(null);
        setReview((previous) =>
          nextMilestoneDocumentReviewState(previous, target, version),
        );
      }}
      onReviewClose={() => {
        discardPendingReview();
        setReview(null);
      }}
      onReviewDecisionChange={(decision: MilestoneDocumentReviewDecision) =>
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
      onReviewResubmissionDueAtChange={(resubmissionDueAt: string) =>
        setReview((previous) =>
          previous === null
            ? previous
            : { ...previous, resubmissionDueAt, errorMessage: null },
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
