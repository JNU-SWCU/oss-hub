'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMilestoneDocumentCollectionUrlState } from './milestone-document-collection-url-state';
import { useMilestoneDocumentCollectionQuery } from './queries';
import { ApiError } from '@/lib/api-client';
import {
  milestoneDocumentCollectionLoadPhase,
  selectCollectionDocument,
} from './milestone-document-collection';
import { getMilestoneDocumentHistory } from './milestone-document-collection-api';
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
  isSameMilestoneDocumentReviewTarget,
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
  const historyRequestIdRef = useRef(0);

  useEffect(() => {
    reviewRequestIdRef.current += 1;
    historyRequestIdRef.current += 1;
    setReview(null);
    setReviewNotice(null);
    setConflictFailed(false);
  }, [currentQuery]);

  const loadReviewHistory = useCallback(
    async (target: MilestoneDocumentReviewTarget, cursor: string | null) => {
      historyRequestIdRef.current += 1;
      const requestId = historyRequestIdRef.current;
      setReview((previous) =>
        previous !== null &&
        isSameMilestoneDocumentReviewTarget(previous.target, target)
          ? { ...previous, isHistoryLoading: true, historyError: null }
          : previous,
      );
      try {
        const page = await getMilestoneDocumentHistory(
          milestoneId,
          target.documentId,
          target.applicationId,
          cursor,
        );
        if (requestId !== historyRequestIdRef.current) return;
        setReview((previous) =>
          previous !== null &&
          isSameMilestoneDocumentReviewTarget(previous.target, target)
            ? {
                ...previous,
                history:
                  cursor === null
                    ? page.items
                    : [...page.items, ...previous.history],
                historyNextCursor: page.nextCursor,
                historyIsComplete: page.isComplete,
                isHistoryLoading: false,
                historyError: null,
              }
            : previous,
        );
      } catch {
        if (requestId !== historyRequestIdRef.current) return;
        setReview((previous) =>
          previous !== null &&
          isSameMilestoneDocumentReviewTarget(previous.target, target)
            ? {
                ...previous,
                isHistoryLoading: false,
                historyError:
                  '제출 이력을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
              }
            : previous,
        );
      }
    },
    [milestoneId],
  );

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
        reload();
        return;
      }

      setReviewNotice(null);
      setReview(null);
      reload();
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
  }, [milestoneId, reload, reloadAfterReviewConflict, review]);

  const data = conflictFailed ? null : (result.data ?? null);

  return (
    <MilestoneDocumentCollectionView
      programId={programId}
      data={data}
      filter={query.filter}
      documentSelection={query.document ?? null}
      onDocumentSelectionChange={(document) => {
        discardPendingReview();
        historyRequestIdRef.current += 1;
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
      review={review}
      reviewNotice={reviewNotice}
      archiveGrouping={archiveGrouping}

      onResetFilters={() => {
        discardPendingReview();
        historyRequestIdRef.current += 1;
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
        const closing =
          review !== null &&
          isSameMilestoneDocumentReviewTarget(review.target, target);
        setReview((previous) =>
          nextMilestoneDocumentReviewState(previous, target, version),
        );
        if (closing) {
          historyRequestIdRef.current += 1;
        } else {
          void loadReviewHistory(target, null);
        }
      }}
      onReviewClose={() => {
        discardPendingReview();
        historyRequestIdRef.current += 1;
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
        if (review === null) return;
        if (review.historyError !== null && review.history.length === 0) {
          void loadReviewHistory(review.target, null);
          return;
        }
        if (review.historyNextCursor === null) return;
        void loadReviewHistory(review.target, review.historyNextCursor);
      }}
    />
  );
}
