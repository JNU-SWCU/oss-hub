'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api-client';
import type { MilestoneDocumentCollectionFilter } from './milestone-document-collection';
import {
  getMilestoneDocumentCollection,
  type MilestoneDocumentCollection,
} from './milestone-document-collection-api';
import { MilestoneDocumentCollectionView } from './milestone-document-collection-view';

/**
 * 교직원 서류 수합 표의 컨테이너 — 조회·재시도·필터 상태만 갖는다.
 * 표를 어떻게 그릴지는 `milestone-document-collection-view.tsx`가 정한다
 * (`features/submissions/components/submission-matrix-screen.tsx`와 같은 분리).
 *
 * 빠른 필터는 서버 재조회 없이 받아 온 행만 거른다 — 이 endpoint는 한 마일스톤의
 * 전체 팀을 한 번에 주므로 거를 대상이 이미 손에 다 있다.
 */
export function MilestoneDocumentCollectionScreen({
  programId,
  milestoneId,
}: {
  readonly programId: string;
  readonly milestoneId: string;
}) {
  const [data, setData] = useState<MilestoneDocumentCollection | null>(null);
  const [filter, setFilter] =
    useState<MilestoneDocumentCollectionFilter>('ALL');
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(
    async (requestId: number) => {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const next = await getMilestoneDocumentCollection(milestoneId);
        // 마일스톤을 바꿔 다시 부른 뒤 이전 응답이 늦게 오면 옛 표가 덮어쓴다.
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
    void load(requestIdRef.current);
  }, [load]);

  return (
    <MilestoneDocumentCollectionView
      programId={programId}
      data={data}
      filter={filter}
      isLoading={isLoading}
      errorMessage={errorMessage}
      onFilterChange={setFilter}
      onRetry={() => {
        requestIdRef.current += 1;
        void load(requestIdRef.current);
      }}
    />
  );
}
