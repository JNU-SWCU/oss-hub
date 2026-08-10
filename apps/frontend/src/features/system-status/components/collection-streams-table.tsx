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
];

const STREAM_TYPE_LABEL: Record<CollectionStreamType, string> = {
  COMMIT: '커밋',
  PULL_REQUEST: 'PR',
  RELEASE: '릴리즈',
};

/**
 * 요약 카드(`STREAM_SEGMENTS`)와 같은 4구간·같은 의미의 배지 색이다 — READY는
 * `HEALTH.NORMAL`과 같은 approved, RETRY_PENDING은 `HEALTH.FAILED`와 같은
 * rejected. 셀 하나에는 공간이 좁아 요약 카드의 긴 라벨(`완료(READY)`, `부분·대기`)
 * 대신 압축된 라벨을 쓴다.
 */
const BUCKET_BADGE = {
  READY: { label: '완료', variant: 'approved' },
  BACKFILLING: { label: '백필 중', variant: 'recruiting' },
  PARTIAL: { label: '부분', variant: 'pending' },
  RETRY_PENDING: { label: '재시도 대기', variant: 'rejected' },
} as const satisfies Record<
  CollectionStreamBucket,
  {
    label: string;
    variant: 'approved' | 'recruiting' | 'pending' | 'rejected';
  }
>;

/**
 * `collection-sync.service.ts`의 `streamErrorCode` 분류(#546)에 대응하는 설명.
 * provider client가 좁혀 둔 안전한 코드만 여기 매핑하고, 목록에 없는 코드는
 * 원문을 그대로 monospace로 보여 준다 — 이 화면의 안전 사유 계약과 같은 원칙이다.
 */
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

/** 저장소의 stream들 중 lastErrorAt이 가장 최근인 오류 하나를 고른다. 시각이 없는
 * 오류는 시각이 있는 오류보다 먼저 채택된 뒤 나중에 밀려난다(시각 있는 쪽이 더
 * 믿을 만한 최신 정보이므로). */
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

/**
 * 표 밀도(한 화면에 몇 줄이 편한지)를 보고 조정할 수 있다. 수집 대상 저장소는
 * 앞으로 늘어나므로 `DataTable`의 opt-in pagination을 이 값으로 항상 켠다.
 */
const COLLECTION_STREAMS_PAGE_SIZE = 10;

export interface CollectionStreamsTableProps {
  readonly repositories: readonly CollectionStreamRepository[];
}

export function CollectionStreamsTable({
  repositories,
}: CollectionStreamsTableProps) {
  // 렌더 한 번 안에서는 셀마다 기준 시각이 미묘하게 어긋나지 않도록 한 번만 고정한다
  // (audit-log-view.tsx와 같은 원칙).
  const now = new Date();

  // `fetchSystemStatus`가 이미 구계약 응답을 빈 배열로 정규화하지만, 이 컴포넌트를
  // 직접 부르는 다른 경로(로컬 검토 픽스처 오타 등)에도 안전하도록 한 번 더
  // 가드한다 — `undefined`가 새어 들어오면 `[...undefined]`가 던진다.
  const safeRepositories = repositories ?? [];
  // 문제 있는 저장소를 항상 맨 앞으로 정렬한다 — 「문제만 보기」 토글을 없앤
  // 뒤에도 페이지를 넘기지 않고 첫 페이지만 봐도 문제가 눈에 띄어야 한다.
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
      // 연결이 없는 저장소가 정상이다(조직 저장소 대부분, discovery로만 편입된
      // external 저장소) — em-dash로 자연스럽게 비워 보여준다. 현재 프로덕션은
      // `Repository` 행이 0건이라 이 열이 전부 em-dash로 보이는 게 정상이다
      // (데이터가 생기면 채워진다).
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
        {/* 「문제만 보기」 토글을 없앤 자리 — 문제 저장소는 항상 첫 페이지에
            오도록 정렬되어 있지만(sortedByProblemFirst), 페이지를 넘기지
            않고도 문제 유무·건수를 알 수 있도록 요약은 남긴다. */}
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
