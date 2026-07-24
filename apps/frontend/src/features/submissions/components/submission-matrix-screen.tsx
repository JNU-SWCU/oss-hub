'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api-client';
import { getSubmissionMatrix } from '../api';
import {
  isMatrixFilterActive,
  MATRIX_PAGE_SIZE,
  type MatrixModeFilter,
  type MatrixQueryInput,
} from '../matrix';
import type { SubmissionMatrixPage } from '../types';
import { SubmissionMatrixView } from './submission-matrix-view';

const INITIAL_QUERY: MatrixQueryInput = {
  q: '',
  mode: 'ALL',
  page: 1,
  pageSize: MATRIX_PAGE_SIZE,
};

/** #124 제출 현황 매트릭스 — 검색·형태 필터·페이지는 서버 조회 조건(#124 query 계약). */
export function SubmissionMatrixScreen({
  programId,
}: {
  readonly programId: string;
}) {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState<MatrixQueryInput>(INITIAL_QUERY);
  const [data, setData] = useState<SubmissionMatrixPage | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(
    async (input: MatrixQueryInput) => {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        setData(await getSubmissionMatrix(programId, input));
      } catch (error) {
        setErrorMessage(
          error instanceof ApiError
            ? error.problem.detail
            : '제출 현황을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
        );
      } finally {
        setIsLoading(false);
      }
    },
    [programId],
  );

  useEffect(() => {
    void load(query);
  }, [query, load]);

  return (
    <SubmissionMatrixView
      programId={programId}
      data={data}
      search={search}
      mode={query.mode}
      filterActive={isMatrixFilterActive(query.q, query.mode)}
      isLoading={isLoading}
      errorMessage={errorMessage}
      now={new Date()}
      onSearchChange={setSearch}
      onSearch={() =>
        setQuery((prev) => ({ ...prev, q: search.trim(), page: 1 }))
      }
      onModeChange={(mode: MatrixModeFilter) =>
        setQuery((prev) => ({ ...prev, mode, page: 1 }))
      }
      onResetFilters={() => {
        setSearch('');
        setQuery(INITIAL_QUERY);
      }}
      onPageChange={(page) => setQuery((prev) => ({ ...prev, page }))}
      onRetry={() => void load(query)}
    />
  );
}
