'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api-client';
import {
  getMilestoneDocumentCollection,
  MILESTONE_DOCUMENT_COLLECTION_PAGE_SIZE,
  type MilestoneDocumentCollection,
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
  const [data, setData] = useState<MilestoneDocumentCollection | null>(null);
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
        setData(next);
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
      data={data}
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
