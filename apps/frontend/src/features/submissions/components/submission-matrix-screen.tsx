'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
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

export function SubmissionMatrixScreen({
  programId,
  selectedMilestoneId,
  onSelectMilestone,
  headerActions,
}: {
  readonly programId: string;
  readonly selectedMilestoneId: string | null;
  readonly onSelectMilestone: (milestoneId: string | null) => void;
  readonly headerActions?: ReactNode;
}) {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState<MatrixQueryInput>(INITIAL_QUERY);

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
      selectedMilestoneId={selectedMilestoneId}
      headerActions={headerActions}
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
      onSelectMilestone={onSelectMilestone}
    />
  );
}
