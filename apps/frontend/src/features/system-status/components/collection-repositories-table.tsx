'use client';

import { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { DataTable, StatusBadge, type DataTableColumn } from '@/components';
import { formatLastSuccess } from '../format-relative-time';
import type { CollectionRepositoryStatus } from '../types';

const COLLECTION_REPOSITORIES_PAGE_SIZE = 10;

function sortedByStaleFirst(
  repositories: readonly CollectionRepositoryStatus[],
): CollectionRepositoryStatus[] {
  return [...repositories].sort((a, b) => {
    if (a.stale !== b.stale) return a.stale ? -1 : 1;
    return a.repositoryName.localeCompare(b.repositoryName);
  });
}

export interface CollectionRepositoriesTableProps {
  readonly repositories: readonly CollectionRepositoryStatus[];
}

export function CollectionRepositoriesTable({
  repositories,
}: CollectionRepositoriesTableProps) {
  const sorted = useMemo(
    () => sortedByStaleFirst(repositories),
    [repositories],
  );
  const staleCount = sorted.filter((repository) => repository.stale).length;

  const columns: DataTableColumn<CollectionRepositoryStatus>[] = [
    {
      id: 'repositoryName',
      header: '저장소',
      cellClassName: 'font-mono text-sm whitespace-nowrap',
      cell: (repository) => repository.repositoryName,
    },
    {
      id: 'programName',
      header: '프로그램',
      cell: (repository) => (
        <span
          className={
            repository.programName ? undefined : 'text-muted-foreground'
          }
        >
          {repository.programName ?? '—'}
        </span>
      ),
    },
    {
      id: 'lastSuccessAt',
      header: '마지막 수집 성공',
      cell: (repository) => formatLastSuccess(repository.lastSuccessAt),
    },
    {
      id: 'state',
      header: '상태',
      cell: (repository) =>
        repository.stale ? (
          <StatusBadge variant="pending">지연</StatusBadge>
        ) : repository.lastSuccessAt === null ? (
          <StatusBadge variant="closed">수집 전</StatusBadge>
        ) : (
          <StatusBadge variant="approved">정상</StatusBadge>
        ),
    },
  ];

  return (
    <section aria-label="수집 대상 상세" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">수집 대상 상세</h2>
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <AlertTriangle aria-hidden="true" className="size-4" />
          지연 {staleCount} / 전체 {sorted.length}
        </span>
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        <DataTable
          scrollRegionLabel="수집 대상 상세 표"
          paginationLabel="수집 대상 상세 페이지"
          columns={columns}
          data={sorted}
          pageSize={COLLECTION_REPOSITORIES_PAGE_SIZE}
          rowKey={(repository) => repository.repositoryName}
          emptyState="수집 대상 저장소가 없습니다."
        />
      </div>
    </section>
  );
}
