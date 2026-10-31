'use client';

import { type ReactNode } from 'react';
import { useUrlSearchDraft } from '@/lib/list-url-state';
import { useSubmissionMatrixUrlState } from '../submission-matrix-url-state';
import { useSubmissionMatrixQuery } from '../queries';
import { ApiError } from '@/lib/api-client';
import { isMatrixFilterActive } from '../matrix';
import { SubmissionMatrixView } from './submission-matrix-view';

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
  const { state: urlState, navigate } = useSubmissionMatrixUrlState();
  const { quickFilter, q, page, pageSize } = urlState;
  const query = { q, page, pageSize };
  const [search, setSearch] = useUrlSearchDraft(q);
  const result = useSubmissionMatrixQuery(programId, query);
  const data = result.data ?? null;
  const isLoading = result.isFetching;
  const errorMessage = result.isError
    ? result.error instanceof ApiError
      ? result.error.problem.detail
      : '제출 현황을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'
    : null;

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
        navigate({ q: search.trim(), page: 1, quickFilter: 'ALL' }, 'replace');
      }}
      onQuickFilterChange={(next) => navigate({ quickFilter: next })}
      onResetFilters={() => {
        setSearch('');
        navigate({ q: '', page: 1, quickFilter: 'ALL' });
      }}
      onPageChange={(page) => {
        navigate({ page, quickFilter: 'ALL' });
      }}
      onRetry={() => void result.refetch()}
      onSelectMilestone={onSelectMilestone}
    />
  );
}
