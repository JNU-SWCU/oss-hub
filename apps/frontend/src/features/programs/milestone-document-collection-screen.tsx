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

const INITIAL_QUERY: MilestoneDocumentCollectionQueryInput = {
  page: 1,
  pageSize: MILESTONE_DOCUMENT_COLLECTION_PAGE_SIZE,
  filter: 'ALL',
};

/**
 * 교직원 서류 수합 표의 컨테이너 — 조회 조건(페이지·필터)과 재시도만 갖는다.
 * 표를 어떻게 그릴지는 `milestone-document-collection-view.tsx`가 정한다
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
  const requestIdRef = useRef(0);

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

  useEffect(() => {
    requestIdRef.current += 1;
    void load(query, requestIdRef.current);
  }, [query, load]);

  return (
    <MilestoneDocumentCollectionView
      programId={programId}
      data={milestoneDocumentCollectionDataFor(loaded, query)}
      filter={query.filter}
      isLoading={isLoading}
      errorMessage={errorMessage}
      onFilterChange={(filter: MilestoneDocumentCollectionFilter) =>
        // 필터를 바꾸면 1페이지로 되돌린다 — 걸리는 팀 수가 줄어 3페이지가 사라진
        // 뒤에도 page=3을 그대로 물고 가면 빈 표만 남는다.
        setQuery((previous) => ({ ...previous, filter, page: 1 }))
      }
      onPageChange={(page: number) =>
        setQuery((previous) => ({ ...previous, page }))
      }
      onRetry={() => {
        requestIdRef.current += 1;
        void load(query, requestIdRef.current);
      }}
    />
  );
}
