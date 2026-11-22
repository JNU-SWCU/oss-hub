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
  headerActions,
}: {
  readonly programId: string;
  readonly headerActions?: ReactNode;
}) {
  const { state: urlState, navigate } = useSubmissionMatrixUrlState();
  const { q, page, pageSize, status, sort, direction } = urlState;
  const query = { q, page, pageSize, status, sort, direction };
  const [search, setSearch] = useUrlSearchDraft(q);
  const result = useSubmissionMatrixQuery(programId, query);
  const data = result.data ?? null;
  const isLoading = result.isFetching && data === null;
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
      filterActive={isMatrixFilterActive(q)}
      status={status}
      sort={sort}
      direction={direction}
      isLoading={isLoading}
      errorMessage={errorMessage}
      now={new Date()}
      headerActions={headerActions}
      onSearchChange={setSearch}
      onSearch={() => {
        navigate({ q: search.trim(), page: 1 }, 'replace');
      }}
      onStatusChange={(status) => navigate({ status, page: 1 })}
      onSort={(next) => {
        navigate({
          sort: next,
          direction: next === sort && direction === 'asc' ? 'desc' : 'asc',
          page: 1,
        });
      }}
      onResetFilters={() => {
        setSearch('');
        navigate({ q: '', page: 1, status: undefined });
      }}
      onPageChange={(page) => {
        navigate({ page });
      }}
      onRetry={() => void result.refetch()}
    />
  );
}
