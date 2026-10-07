'use client';

import { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { DataTable, StatusBadge, type DataTableColumn } from '@/components';
import { formatRelativeTime } from '../format-relative-time';
import type {
  CollectionStreamBucket,
  CollectionStreamDetail,
  CollectionStreamRepository,
  CollectionStreamType,
} from '../types';

const STREAM_TYPES: readonly CollectionStreamType[] = [
  'COMMIT',
  'PULL_REQUEST',
  'RELEASE',
  'ISSUE',
];

const STREAM_TYPE_LABEL: Record<CollectionStreamType, string> = {
  COMMIT: 'Commit',
  PULL_REQUEST: 'PR',
  RELEASE: 'Release',
  ISSUE: 'Issue',
};

const BUCKET_BADGE = {
  READY: { label: '완료', variant: 'approved' },
  BACKFILLING: { label: '과거 활동 수집 중', variant: 'recruiting' },
  PARTIAL: { label: '부분', variant: 'pending' },
  RETRY_PENDING: { label: '재시도 대기', variant: 'rejected' },
} as const satisfies Record<
  CollectionStreamBucket,
  {
    label: string;
    variant: 'approved' | 'recruiting' | 'pending' | 'rejected';
  }
>;

const ERROR_CODE_DESCRIPTION: Record<string, string> = {
  PROVIDER_UPSTREAM: 'GitHub 연결 실패',
  PROVIDER_RESPONSE: '응답 형식 오류',
  PROVIDER_PAGINATION: '페이지네이션 오류',
  PROVIDER_DEADLINE: '요청 시간 초과',
  PROVIDER_RATE_LIMITED: 'GitHub 호출 한도 초과',
  PROVIDER_AUTH: '수집 연동 앱 인증 실패',
  PROVIDER_PERMISSION: '저장소 접근 권한 없음',
  PROVIDER_NOT_FOUND: '저장소를 찾을 수 없음',
  PROVIDER_GRAPHQL_ERROR: 'GraphQL 응답 오류',
  STREAM_SYNC_FAILED: '수집 실패',
};

function isProblemStream(stream: CollectionStreamDetail): boolean {
  return stream.bucket !== 'READY' || stream.lastErrorCode !== null;
}

function repositoryHasProblem(repo: CollectionStreamRepository): boolean {
  return repo.streams.some(isProblemStream);
}

interface LatestStreamError {
  readonly code: string;
  readonly at: string | null;
}

function latestStreamError(
  repo: CollectionStreamRepository,
): LatestStreamError | null {
  let latest: LatestStreamError | null = null;
  for (const stream of repo.streams) {
    if (stream.lastErrorCode === null) continue;
    const isMoreRecent =
      latest === null ||
      (stream.lastErrorAt !== null &&
        (latest.at === null || stream.lastErrorAt > latest.at));
    if (isMoreRecent) {
      latest = { code: stream.lastErrorCode, at: stream.lastErrorAt };
    }
  }
  return latest;
}

function sortedByProblemFirst(
  repositories: readonly CollectionStreamRepository[],
): CollectionStreamRepository[] {
  return [...repositories].sort((a, b) => {
    const aProblem = repositoryHasProblem(a);
    const bProblem = repositoryHasProblem(b);
    if (aProblem !== bProblem) return aProblem ? -1 : 1;
    return a.repositoryName.localeCompare(b.repositoryName);
  });
}

function StreamCell({
  stream,
  now,
}: {
  readonly stream: CollectionStreamDetail | undefined;
  readonly now: Date;
}) {
  if (!stream) {
    return <span className="text-muted-foreground">—</span>;
  }
  const badge = BUCKET_BADGE[stream.bucket];
  return (
    <div className="flex flex-col gap-1">
      <StatusBadge variant={badge.variant}>{badge.label}</StatusBadge>
      <span className="text-xs text-muted-foreground">
        {stream.lastSuccessAt
          ? formatRelativeTime(stream.lastSuccessAt, now)
          : '기록 없음'}
      </span>
    </div>
  );
}

function ProblemCell({
  repo,
  now,
}: {
  readonly repo: CollectionStreamRepository;
  readonly now: Date;
}) {
  const error = latestStreamError(repo);
  if (!error) {
    return <span className="text-muted-foreground">—</span>;
  }
  const description = ERROR_CODE_DESCRIPTION[error.code];
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm">
        {description ?? <code className="font-mono text-xs">{error.code}</code>}
      </span>
      {error.at ? (
        <span className="text-xs text-muted-foreground">
          {formatRelativeTime(error.at, now)}
        </span>
      ) : null}
    </div>
  );
}

const COLLECTION_STREAMS_PAGE_SIZE = 10;

export interface CollectionStreamsTableProps {
  readonly repositories: readonly CollectionStreamRepository[];
}

export function CollectionStreamsTable({
  repositories,
}: CollectionStreamsTableProps) {
  const now = new Date();

  const safeRepositories = repositories ?? [];

  const sorted = useMemo(
    () => sortedByProblemFirst(safeRepositories),
    [safeRepositories],
  );
  const problemCount = useMemo(
    () => sorted.filter(repositoryHasProblem).length,
    [sorted],
  );

  const columns: DataTableColumn<CollectionStreamRepository>[] = [
    {
      id: 'repositoryName',
      header: '저장소',
      cellClassName: 'font-mono text-sm whitespace-nowrap',
      cell: (repo) => repo.repositoryName,
    },
    {
      id: 'programName',
      header: '프로그램',

      cell: (repo) => (
        <span
          className={repo.programName ? undefined : 'text-muted-foreground'}
        >
          {repo.programName ?? '—'}
        </span>
      ),
    },
    ...STREAM_TYPES.map(
      (streamType): DataTableColumn<CollectionStreamRepository> => ({
        id: streamType,
        header: STREAM_TYPE_LABEL[streamType],
        cell: (repo) => (
          <StreamCell
            stream={repo.streams.find(
              (stream) => stream.streamType === streamType,
            )}
            now={now}
          />
        ),
      }),
    ),
    {
      id: 'problem',
      header: '문제',
      cell: (repo) => <ProblemCell repo={repo} now={now} />,
    },
  ];

  return (
    <section aria-label="수집 대상 상세" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">수집 대상 상세</h2>

        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <AlertTriangle aria-hidden="true" className="size-4" />
          문제 {problemCount} / 전체 {sorted.length}
        </span>
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        <DataTable
          scrollRegionLabel="수집 대상 상세 표"
          paginationLabel="수집 대상 상세 페이지"
          columns={columns}
          data={sorted}
          pageSize={COLLECTION_STREAMS_PAGE_SIZE}
          rowKey={(repo) => repo.repositoryName}
          emptyState="수집 대상 저장소가 없습니다."
        />
      </div>
    </section>
  );
}
