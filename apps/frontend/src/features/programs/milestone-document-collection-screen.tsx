'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api-client';
import {
  milestoneDocumentCollectionDataFor,
  type LoadedMilestoneDocumentCollection,
} from './milestone-document-collection';
import {
  getMilestoneDocumentCollection,
  MILESTONE_DOCUMENT_COLLECTION_PAGE_SIZE,
  type MilestoneDocumentCollectionFilter,
  type MilestoneDocumentCollectionQueryInput,
} from './milestone-document-collection-api';
import { MilestoneDocumentCollectionView } from './milestone-document-collection-view';
import {
  milestoneDocumentReviewCommentPayload,
  milestoneDocumentReviewFormError,
  nextMilestoneDocumentReviewState,
  type MilestoneDocumentReviewFormState,
  type MilestoneDocumentReviewTarget,
} from './milestone-document-review';
import {
  createMilestoneDocumentReview,
  MILESTONE_DOCUMENT_REVIEW_ERROR_CODES,
  type MilestoneDocumentReviewDecision,
} from './milestone-document-review-api';

const INITIAL_QUERY: MilestoneDocumentCollectionQueryInput = {
  page: 1,
  pageSize: MILESTONE_DOCUMENT_COLLECTION_PAGE_SIZE,
  filter: 'ALL',
};

/**
 * 판정을 저장하지 못했을 때, 표를 다시 불러와야 하는 오류인가.
 *
 * 「그 사이 판정이 바뀜」(409)과 「제출이 없음」(404)은 **손에 든 표가 낡았다**는 뜻이다.
 * 그때 문구만 띄우고 표를 그대로 두면 교직원은 낡은 「지난 판정」을 보며 같은 실패를
 * 되풀이한다. 사유 필수(422)는 손에 든 표가 아니라 입력이 문제라 다시 부르지 않는다.
 */
function shouldReloadAfterReviewError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  return (
    error.problem.code ===
      MILESTONE_DOCUMENT_REVIEW_ERROR_CODES.REVIEW_CHANGED ||
    error.problem.code ===
      MILESTONE_DOCUMENT_REVIEW_ERROR_CODES.SUBMISSION_NOT_FOUND
  );
}

/**
 * 교직원 서류 수합 표의 컨테이너 — 조회 조건(페이지·필터), 재시도, 그리고 판정 패널의
 * 상태를 갖는다. 표를 어떻게 그릴지는 `milestone-document-collection-view.tsx`가 정한다
 * (`features/submissions/components/submission-matrix-screen.tsx`와 같은 분리).
 *
 * 빠른 필터는 **서버 조회 조건**이다. 응답이 페이지 한 장이라 손에 있는 행만 걸러서는
 * 다른 페이지의 대상 팀을 놓치기 때문이다.
 */
export function MilestoneDocumentCollectionScreen({
  programId,
  milestoneId,
}: {
  readonly programId: string;
  readonly milestoneId: string;
}) {
  /**
   * 응답은 **그것을 불러온 조회 조건과 함께** 들고 있는다. 조건만 바뀌고 요청이 실패하면
   * 이전 응답이 손에 남는데, 짝을 지어 두지 않으면 새 필터 이름 아래에 옛 행과 옛 합계가
   * 오류 문구와 나란히 그려진다. 늦게 온 응답을 막는 `requestIdRef`가 「누가 이겼는가」를
   * 본다면, 이 짝짓기는 「지금 조건의 답이 맞는가」를 본다 — 실패 뒤에는 뒤엣것만 남는다.
   */
  const [loaded, setLoaded] =
    useState<LoadedMilestoneDocumentCollection | null>(null);
  const [query, setQuery] =
    useState<MilestoneDocumentCollectionQueryInput>(INITIAL_QUERY);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [review, setReview] = useState<MilestoneDocumentReviewFormState | null>(
    null,
  );
  const requestIdRef = useRef(0);
  /**
   * 판정 전송에도 표 조회와 **같은 결**의 경합 방지를 건다. 교직원은 여러 건을 연달아
   * 처리하므로 앞 전송의 응답이 뒤에 도착할 수 있고, 그때 「저장 중…」이 풀리거나 오류
   * 문구가 지금 열어 둔 다른 칸에 가서 앉으면 남의 칸이 실패한 것처럼 보인다.
   */
  const reviewRequestIdRef = useRef(0);

  const load = useCallback(
    async (input: MilestoneDocumentCollectionQueryInput, requestId: number) => {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const next = await getMilestoneDocumentCollection(milestoneId, input);
        // 조건을 바꿔 다시 부른 뒤 이전 응답이 늦게 오면 옛 표가 덮어쓴다.
        if (requestId !== requestIdRef.current) return;
        setLoaded({ query: input, data: next });
      } catch (error) {
        if (requestId !== requestIdRef.current) return;
        setErrorMessage(
          error instanceof ApiError
            ? error.problem.detail
            : '서류 수합 표를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
        );
      } finally {
        if (requestId === requestIdRef.current) {
          setIsLoading(false);
        }
      }
    },
    [milestoneId],
  );

  const reload = useCallback(() => {
    requestIdRef.current += 1;
    void load(query, requestIdRef.current);
  }, [load, query]);

  useEffect(() => {
    requestIdRef.current += 1;
    void load(query, requestIdRef.current);
  }, [query, load]);

  const submitReview = useCallback(async () => {
    if (review === null) return;
    const { decision, comment, target } = review;
    const formError = milestoneDocumentReviewFormError(decision, comment);
    // `decision === null`은 formError가 이미 잡지만, 그 사실은 타입에 남지 않는다.
    if (formError !== null || decision === null) {
      setReview((previous) =>
        previous === null
          ? previous
          : { ...previous, errorMessage: formError ?? '판정을 골라 주세요.' },
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
        },
      );
      if (requestId !== reviewRequestIdRef.current) return;
      // 저장한 판정은 곧바로 칸의 배지와 「지난 판정」이 되어야 한다 — 그 값은 서버가
      // 소유하므로 응답을 손으로 표에 꽂지 않고 표를 다시 부른다.
      setReview(null);
      reload();
    } catch (error) {
      if (requestId !== reviewRequestIdRef.current) return;
      setReview((previous) =>
        previous === null
          ? previous
          : {
              ...previous,
              isSubmitting: false,
              errorMessage:
                error instanceof ApiError
                  ? error.problem.detail
                  : '판정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.',
            },
      );
      if (shouldReloadAfterReviewError(error)) reload();
    }
  }, [milestoneId, reload, review]);

  return (
    <MilestoneDocumentCollectionView
      programId={programId}
      data={milestoneDocumentCollectionDataFor(loaded, query)}
      filter={query.filter}
      isLoading={isLoading}
      errorMessage={errorMessage}
      review={review}
      onFilterChange={(filter: MilestoneDocumentCollectionFilter) => {
        // 조회 조건이 바뀌면 열어 둔 판정은 닫는다 — 그 팀이 다음 페이지에 없을 수 있고,
        // 적어 둔 사유가 남으면 엉뚱한 팀 칸에 그대로 저장된다.
        setReview(null);
        // 필터를 바꾸면 1페이지로 되돌린다 — 걸리는 팀 수가 줄어 3페이지가 사라진
        // 뒤에도 page=3을 그대로 물고 가면 빈 표만 남는다.
        setQuery((previous) => ({ ...previous, filter, page: 1 }));
      }}
      onPageChange={(page: number) => {
        setReview(null);
        setQuery((previous) => ({ ...previous, page }));
      }}
      onRetry={reload}
      onReviewOpen={(target: MilestoneDocumentReviewTarget) =>
        setReview((previous) =>
          nextMilestoneDocumentReviewState(previous, target),
        )
      }
      onReviewClose={() => setReview(null)}
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
      onReviewSubmit={() => void submitReview()}
    />
  );
}
