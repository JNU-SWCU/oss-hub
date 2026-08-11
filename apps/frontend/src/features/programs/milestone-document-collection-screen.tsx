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
  type MilestoneDocumentCollectionArchiveGrouping,
  type MilestoneDocumentCollectionFilter,
  type MilestoneDocumentCollectionQueryInput,
} from './milestone-document-collection-api';
import { MilestoneDocumentCollectionView } from './milestone-document-collection-view';
import {
  isMilestoneDocumentReviewTargetChanged,
  milestoneDocumentReviewConflictNotice,
  milestoneDocumentReviewConflictOf,
  type MilestoneDocumentCollectionReloadResult,
  type MilestoneDocumentReviewConflict,
} from './milestone-document-conflict';
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
  type MilestoneDocumentReviewDecision,
} from './milestone-document-review-api';

const INITIAL_QUERY: MilestoneDocumentCollectionQueryInput = {
  page: 1,
  pageSize: MILESTONE_DOCUMENT_COLLECTION_PAGE_SIZE,
  filter: 'ALL',
};

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
  /**
   * 전체 제출물 ZIP의 폴더 구조. **조회 조건이 아니라 표시 전용 상태**라 `query`와 따로
   * 둔다 — 이 값을 `query`에 섞으면 토글을 켤 때마다 표를 통째로 다시 부르고, 그동안
   * 열어 둔 판정 패널까지 닫힌다(필터·페이지 핸들러가 하는 일이 그것이다).
   *
   * 같은 이유로 URL 쿼리로도 올리지 않는다. 주소에 남길 만한 것은 「무엇을 보고 있는가」
   * 이고, 이 값은 아직 누르지도 않은 내려받기의 옵션일 뿐이라 되돌아올 자리를 만들지
   * 않는다. 기본값 `TEAM`은 서버 쪽 기본과 같지만 링크에는 언제나 명시해 보낸다
   * (`milestoneDocumentCollectionArchiveHref`).
   */
  const [archiveGrouping, setArchiveGrouping] =
    useState<MilestoneDocumentCollectionArchiveGrouping>('TEAM');
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

  /**
   * 조회 한 번. **어떻게 끝났는지를 돌려준다** — 판정 충돌 뒤의 재조회는 그 결과를 보고
   * 무슨 말을 할지 정해야 하기 때문이다(「다시 불러왔습니다」는 실제로 불러왔을 때만
   * 참이다). 그냥 부르기만 하는 자리는 `reload`가 결과를 버린다.
   */
  const load = useCallback(
    async (
      input: MilestoneDocumentCollectionQueryInput,
      requestId: number,
    ): Promise<MilestoneDocumentCollectionReloadResult> => {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const next = await getMilestoneDocumentCollection(milestoneId, input);
        // 조건을 바꿔 다시 부른 뒤 이전 응답이 늦게 오면 옛 표가 덮어쓴다.
        if (requestId !== requestIdRef.current) return 'superseded';
        setLoaded({ query: input, data: next });
        return 'reloaded';
      } catch (error) {
        if (requestId !== requestIdRef.current) return 'superseded';
        setErrorMessage(
          error instanceof ApiError
            ? error.problem.detail
            : '서류 수합 표를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
        );
        return 'failed';
      } finally {
        if (requestId === requestIdRef.current) {
          setIsLoading(false);
        }
      }
    },
    [milestoneId],
  );

  /** 언제 불려도 **지금** 화면의 조건으로 다시 부른다(위 `queryRef` 주석 참고). */
  const reloadCollection =
    useCallback((): Promise<MilestoneDocumentCollectionReloadResult> => {
      requestIdRef.current += 1;
      return load(queryRef.current, requestIdRef.current);
    }, [load]);

  /** 결과를 보지 않고 부르기만 하는 자리 — 저장 성공·버려진 성공·「다시 시도」. */
  const reload = useCallback(() => {
    void reloadCollection();
  }, [reloadCollection]);

  useEffect(() => {
    requestIdRef.current += 1;
    void load(query, requestIdRef.current);
  }, [query, load]);

  /**
   * 충돌(표가 낡았다) 뒤의 재조회 — **다 부른 다음에** 표와 문구를 정한다.
   *
   * 순서가 이 함수의 전부다. 「표를 최신 내용으로 다시 불러왔습니다」를 부르기 전에
   * 띄우면, 조회가 느리거나 실패한 화면에는 그 문구 아래에 **옛 표가 그대로 살아서
   * 조작까지 된다** — 교직원은 이미 지나간 칸을 최신인 줄 알고 누른다.
   */
  const reloadAfterReviewConflict = useCallback(
    async (conflict: MilestoneDocumentReviewConflict, requestId: number) => {
      // 아직 아무것도 안 불렀다 — 앞선 안내가 남아 있으면 지금 일의 결과로 읽힌다.
      setReviewNotice(null);
      const result = await reloadCollection();
      // 그 사이 다른 조회가 화면을 가져갔다. 여기서 표를 건드리면 남의 결과를 되돌린다.
      if (result === 'superseded') return;
      /*
       * 못 불러왔으면 낡은 표를 걷는다. 조회 실패가 손에 든 표를 그대로 두는 것은
       * 평상시엔 옳다(같은 조건의 재조회 중에 표를 걷으면 보던 자리를 잃는다). 그러나
       * 여기서는 서버가 방금 **그 표가 낡았다고 말한** 뒤다 — 남겨 두면 교직원은 이미
       * 지나간 칸을 계속 조작하고, 누를 때마다 같은 409를 다시 받는다.
       */
      if (result === 'failed') setLoaded(null);
      // 그 사이 다른 칸을 열었거나 패널을 닫았으면 이 안내는 가리킬 자리를 잃었다.
      if (requestId !== reviewRequestIdRef.current) return;
      const notice = milestoneDocumentReviewConflictNotice(conflict, result);
      if (notice !== null) setReviewNotice(notice);
    },
    [reloadCollection],
  );

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
       * 「그 사이 판정이 바뀜」(409)·「제출이 없음」(404)·「내가 본 그 제출물이 아님」(409)은
       * 손에 든 표가 낡았다는 뜻이다. 문구만 띄우고 표를 그대로 두면 교직원은 낡은 「지난
       * 판정」을 보며 같은 실패를 되풀이한다. 사유 필수(422)는 표가 아니라 입력이 문제라
       * 다시 부르지 않는다.
       */
      const conflict = milestoneDocumentReviewConflictOf(error);
      /*
       * 「내가 본 그 제출물이 아니다」는 판정의 근거가 사라졌다는 뜻이다. 패널에 문구만
       * 띄우고 열어 두면 교직원은 같은 판정을 다시 누르고, 그때는 통과할 수도 있다 —
       * 바뀐 내용을 여전히 못 본 채로. 그래서 고른 판정을 버리고, 표를 되돌린 **뒤에**
       * 무슨 일이 났는지 표 쪽 문구로 말한다.
       */
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
                  : '판정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.',
            },
      );
      if (conflict !== null) {
        await reloadAfterReviewConflict(conflict, requestId);
      }
    }
  }, [milestoneId, reload, reloadAfterReviewConflict, review]);

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
      archiveGrouping={archiveGrouping}
      /*
       * 표시만 바꾼다 — 조회도, 열어 둔 판정 패널도 건드리지 않는다. 담기는 파일은 그대로고
       * ZIP 안의 경로만 뒤집히므로 다시 부를 것이 없다.
       */
      onArchiveGroupingChange={setArchiveGrouping}
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
