'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api-client';
import { getSubmissionMatrix } from '../api';
import {
  isMatrixFilterActive,
  MATRIX_PAGE_SIZE,
  type MatrixQueryInput,
  type MatrixQuickFilter,
} from '../matrix';
import type { SubmissionMatrixPage } from '../types';
import { SubmissionMatrixView } from './submission-matrix-view';

const INITIAL_QUERY: MatrixQueryInput = {
  q: '',
  page: 1,
  pageSize: MATRIX_PAGE_SIZE,
};

/** #124 제출 현황 매트릭스 — 검색·페이지는 서버 조회 조건(#124 query 계약). */
export function SubmissionMatrixScreen({
  programId,
}: {
  readonly programId: string;
}) {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState<MatrixQueryInput>(INITIAL_QUERY);
  // #619 스펙 3버튼 빠른 필터 — 서버 재조회 없이 로드된 페이지 행만 거른다.
  const [quickFilter, setQuickFilter] = useState<MatrixQuickFilter>('ALL');
  const [data, setData] = useState<SubmissionMatrixPage | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(
    async (input: MatrixQueryInput, requestId: number) => {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const next = await getSubmissionMatrix(programId, input);
        // 이전 조회 응답이 늦게 도착해도 최신 query 결과만 반영한다.
        if (requestId !== requestIdRef.current) return;
        setData(next);
      } catch (error) {
        if (requestId !== requestIdRef.current) return;
        setErrorMessage(
          error instanceof ApiError
            ? error.problem.detail
            : '제출 현황을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
        );
      } finally {
        if (requestId === requestIdRef.current) {
          setIsLoading(false);
        }
      }
    },
    [programId],
  );

  useEffect(() => {
    requestIdRef.current += 1;
    void load(query, requestIdRef.current);
  }, [query, load]);

  return (
    <SubmissionMatrixView
      programId={programId}
      data={data}
      search={search}
      filterActive={isMatrixFilterActive(query.q)}
      quickFilter={quickFilter}
      isLoading={isLoading}
      errorMessage={errorMessage}
      now={new Date()}
      onSearchChange={setSearch}
      onSearch={() => {
        setQuickFilter('ALL');
        setQuery((prev) => ({ ...prev, q: search.trim(), page: 1 }));
      }}
      onQuickFilterChange={setQuickFilter}
      onResetFilters={() => {
        setSearch('');
        setQuickFilter('ALL');
        setQuery(INITIAL_QUERY);
      }}
      onPageChange={(page) => {
        setQuickFilter('ALL');
        setQuery((prev) => ({ ...prev, page }));
      }}
      onRetry={() => {
        requestIdRef.current += 1;
        void load(query, requestIdRef.current);
      }}
    />
  );
}
