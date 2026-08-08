'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api-client';
import {
  milestoneDocumentCollectionDataFor,
  milestoneDocumentCollectionLoadPhase,
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
  milestoneDocumentReviewVersionError,
  nextMilestoneDocumentReviewState,
  type MilestoneDocumentReviewFormState,
  type MilestoneDocumentReviewTarget,
  type MilestoneDocumentReviewVersion,
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
 * 「내가 본 그 제출물이 아니다」(409 MSD_025)인가 — 다른 실패와 다루는 방식이 다르다.
 *
 * 이건 입력이 틀린 것도, 잠깐의 장애도 아니다. **판정의 근거가 이미 사라졌다**는 뜻이라
 * 같은 판정을 다시 눌러 통과시켜서는 안 된다. 그래서 패널 안에 문구만 남기지 않고
 * 적어 둔 판정을 버리고 표부터 최신으로 되돌린다.
 */
function isReviewTargetChanged(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.problem.code ===
      MILESTONE_DOCUMENT_REVIEW_ERROR_CODES.REVIEW_TARGET_CHANGED
  );
}

/**
 * MSD_025를 받았을 때 교직원에게 하는 말.
 *
 * MSD_024(「제출하는 사이에 판정이 등록되었습니다」)와 **겹치지 않게** 쓴다. 024는 학생
 * 제출 경로의 문구이고 여기서 막힌 사람은 교직원이다 — 두 자리에 같은 말을 띄우면
 * 「무엇이 바뀌었는지」가 사라진다. 이 문구는 세 가지를 다 말해야 한다: 저장되지 않았다,
 * 표는 최신으로 되돌렸다, 다시 **보고** 판정하라.
 */
const REVIEW_TARGET_CHANGED_NOTICE =
  '검토하는 사이에 이 서류의 제출물 또는 판정이 바뀌어, 방금 고른 판정은 저장하지 않았습니다. 표를 최신 내용으로 다시 불러왔습니다 — 제출 내용을 다시 확인한 뒤 판정해 주세요.';

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
  /** 저장되지 않고 버려진 판정을 알리는 문구 — 패널을 닫은 뒤에도 남아야 한다. */
  const [reviewNotice, setReviewNotice] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  /**
   * 지금 화면의 조회 조건. 표를 다시 부르는 쪽이 **호출 시점의 조건**을 쓰게 하려는 것이다.
   *
   * 판정 전송처럼 오래 매달려 있는 일은 시작할 때의 `query`를 손에 쥔 채로 끝난다. 그
   * 조건으로 표를 다시 부르면, 그 사이 필터를 바꾼 화면에 **옛 조건의 답**이 도착한다 —
   * `milestoneDocumentCollectionDataFor`가 조건이 어긋난 응답을 버리므로 표가 통째로 빈다.
   */
  const queryRef = useRef(query);
  queryRef.current = query;
  /**
   * 판정 전송에도 표 조회와 **같은 결**의 경합 방지를 건다. 교직원은 여러 건을 연달아
   * 처리하므로 앞 전송의 응답이 뒤에 도착할 수 있고, 그때 「저장 중…」이 풀리거나 오류
   * 문구가 지금 열어 둔 다른 칸에 가서 앉으면 남의 칸이 실패한 것처럼 보인다.
   */
  const reviewRequestIdRef = useRef(0);
  /**
   * 진행 중인 판정 전송을 **버린다**(응답이 와도 아무것도 하지 않는다).
   *
   * 전송이 날아가 있는 동안에도 페이지·필터·다른 칸은 그대로 눌린다. 그때 늦게 온 옛
   * 응답이 성공 처리를 그대로 밟으면 **방금 연 판정 폼을 닫고**, 자기가 들고 있던 **옛
   * 조회 조건으로 표를 다시 불러** 화면의 조건과 데이터가 어긋난다(조건이 어긋난 응답은
   * `milestoneDocumentCollectionDataFor`가 버리므로 표는 그대로 빈다). 실패 쪽도 같다 —
   * 남의 칸에 오류 문구가 가서 앉는다.
   *
   * 조작을 막는 대신 버리는 쪽을 고른 이유: 판정은 이미 서버로 갔고 그 결과는 다음 조회가
   * 가져온다. 전송이 끝날 때까지 표를 얼려 두면 교직원은 이유를 알 수 없는 벽을 만난다.
   */
  const discardPendingReview = useCallback(() => {
    reviewRequestIdRef.current += 1;
  }, []);

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

  /** 언제 불려도 **지금** 화면의 조건으로 다시 부른다(위 `queryRef` 주석 참고). */
  const reload = useCallback(() => {
    requestIdRef.current += 1;
    void load(queryRef.current, requestIdRef.current);
  }, [load]);

  useEffect(() => {
    requestIdRef.current += 1;
    void load(query, requestIdRef.current);
  }, [query, load]);

  const submitReview = useCallback(async () => {
    if (review === null) return;
    const { decision, comment, target, version } = review;
    // 입력이 먼저다 — 교직원이 고칠 수 있는 것을 먼저 말한다. 기대 버전을 못 떠 온 것은
    // 그가 고칠 수 있는 일이 아니라 표를 다시 부르라는 안내가 된다.
    const formError =
      milestoneDocumentReviewFormError(decision, comment) ??
      milestoneDocumentReviewVersionError(version);
    // `decision`·`version`의 null은 formError가 이미 잡지만, 그 사실은 타입에 남지 않는다.
    if (formError !== null || decision === null || version === null) {
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
          // 패널을 열 때 떠 온 값 그대로다 — 지금 표를 다시 읽어 채우면 대조가 언제나
          // 통과해 검사가 없는 것과 같아진다.
          expectedRevision: version.expectedRevision,
          expectedLatestReviewId: version.expectedLatestReviewId,
        },
      );
      if (requestId !== reviewRequestIdRef.current) {
        /*
         * 이 응답은 버려진 것이다(그 사이 칸을 옮겼거나 패널을 닫았다). 그래도 **서버에는
         * 저장됐다** — 그냥 지나가면 표에는 옛 배지가 그대로 남아, 교직원이 이미 판정한
         * 건을 다시 판정한다(판정은 쌓이므로 학생 화면에 지적이 두 번 남는다).
         *
         * 그래서 표만 지금 조건으로 다시 부른다. 폼 상태(`review`)는 건드리지 않는다 —
         * 방금 연 다른 칸의 패널과 적어 둔 사유가 여기서 닫히면 안 된다.
         */
        reload();
        return;
      }
      // 저장한 판정은 곧바로 칸의 배지와 「지난 판정」이 되어야 한다 — 그 값은 서버가
      // 소유하므로 응답을 손으로 표에 꽂지 않고 표를 다시 부른다.
      setReviewNotice(null);
      setReview(null);
      reload();
    } catch (error) {
      // 실패한 뒤의 버려진 응답은 조용히 지나간다 — 서버에 남은 것이 없다.
      if (requestId !== reviewRequestIdRef.current) return;
      /*
       * 「내가 본 그 제출물이 아니다」는 판정의 근거가 사라졌다는 뜻이다. 패널에 문구만
       * 띄우고 열어 두면 교직원은 같은 판정을 다시 누르고, 그때는 통과할 수도 있다 —
       * 바뀐 내용을 여전히 못 본 채로. 그래서 고른 판정을 버리고 표부터 되돌린 뒤,
       * 무슨 일이 났는지 표 쪽 문구로 말한다.
       */
      if (isReviewTargetChanged(error)) {
        setReview(null);
        setReviewNotice(REVIEW_TARGET_CHANGED_NOTICE);
        reload();
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
                  : '판정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.',
            },
      );
      if (shouldReloadAfterReviewError(error)) reload();
    }
  }, [milestoneId, reload, review]);

  /*
   * 조건과 짝이 맞는 응답만 화면으로 내려보낸다. 그 값이 그대로 「다시 부르는 동안 표를
   * 유지할 수 있는가」의 근거가 된다 — 조건이 바뀌어 짝이 어긋나면 `null`이 되고, 화면은
   * 유지할 것이 없어 뼈대를 그린다. 두 규칙을 한 값에서 끌어내야 「같은 조건의 재조회일
   * 때만 유지한다」가 두 곳에서 어긋나지 않는다.
   */
  const data = milestoneDocumentCollectionDataFor(loaded, query);

  return (
    <MilestoneDocumentCollectionView
      programId={programId}
      data={data}
      filter={query.filter}
      loadPhase={milestoneDocumentCollectionLoadPhase({ data, isLoading })}
      errorMessage={errorMessage}
      review={review}
      reviewNotice={reviewNotice}
      onFilterChange={(filter: MilestoneDocumentCollectionFilter) => {
        // 조회 조건이 바뀌면 열어 둔 판정은 닫는다 — 그 팀이 다음 페이지에 없을 수 있고,
        // 적어 둔 사유가 남으면 엉뚱한 팀 칸에 그대로 저장된다. 보내는 중이던 판정도
        // 함께 버린다(옛 조건으로 표를 다시 부르는 것을 막는다).
        discardPendingReview();
        setReview(null);
        // 다른 표로 넘어가면 앞 판정에 대한 안내는 가리키는 자리를 잃는다.
        setReviewNotice(null);
        // 필터를 바꾸면 1페이지로 되돌린다 — 걸리는 팀 수가 줄어 3페이지가 사라진
        // 뒤에도 page=3을 그대로 물고 가면 빈 표만 남는다.
        setQuery((previous) => ({ ...previous, filter, page: 1 }));
      }}
      onPageChange={(page: number) => {
        discardPendingReview();
        setReview(null);
        setReviewNotice(null);
        setQuery((previous) => ({ ...previous, page }));
      }}
      onRetry={reload}
      onReviewOpen={(
        target: MilestoneDocumentReviewTarget,
        version: MilestoneDocumentReviewVersion | null,
      ) => {
        // 다른 칸을 열면 앞 칸의 전송은 남의 일이 된다 — 그 응답이 방금 연 폼을 닫게
        // 두지 않는다.
        discardPendingReview();
        // 새 칸을 열었으면 앞 판정에 대한 안내는 할 일을 마쳤다.
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
      onReviewSubmit={() => void submitReview()}
    />
  );
}
