'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Archive, RotateCcw, Search } from 'lucide-react';
import { CardGrid, EmptyState, PageHeader, StatusBadge } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { loadPublicArchive } from '../api';
import type {
  ArchiveApplicationMode,
  ArchiveListItem,
  ArchiveListState,
} from '../types';

const PAGE_SIZE = 12;

type ArchiveListContentProps = {
  readonly state: ArchiveListState;
  readonly q: string;
  readonly applicationMode?: ArchiveApplicationMode;
  readonly onSearch: (q: string, mode?: ArchiveApplicationMode) => void;
  readonly onPage: (page: number) => void;
  readonly onRetry: () => void;
};

function LoadingState() {
  return (
    <main
      aria-label="공개 아카이브를 불러오는 중"
      className="mx-auto grid w-full max-w-6xl gap-6 p-5 sm:p-8"
    >
      <div className="h-24 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
      <CardGrid>
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="h-56 animate-pulse rounded-lg bg-muted motion-reduce:animate-none"
          />
        ))}
      </CardGrid>
    </main>
  );
}

function ErrorState({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-6 p-5 sm:p-8">
      <Alert variant="destructive">
        <AlertCircle aria-hidden="true" />
        <AlertTitle>공개 아카이브를 불러오지 못했습니다</AlertTitle>
        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
          <span>잠시 후 다시 시도해 주세요.</span>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            <RotateCcw aria-hidden="true" />
            다시 시도
          </Button>
        </AlertDescription>
      </Alert>
    </main>
  );
}

function ArchiveCard({ item }: { readonly item: ArchiveListItem }) {
  return (
    <Card className="min-w-0">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">
              {item.programName} · {item.modeLabel}
            </p>
            <CardTitle className="mt-1 break-words">
              {item.displayName}
            </CardTitle>
          </div>
          <StatusBadge variant="approved">GitHub PUBLIC</StatusBadge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-1 text-sm">
        <span className="text-muted-foreground">공개일</span>
        <time dateTime={item.publishedAt}>{item.publishedLabel}</time>
      </CardContent>
      <CardFooter>
        <Button asChild size="sm" variant="outline">
          <Link href={item.detailUrl}>상세 보기</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

function ArchiveSearch({
  q,
  applicationMode,
  onSearch,
}: Pick<ArchiveListContentProps, 'q' | 'applicationMode' | 'onSearch'>) {
  const [query, setQuery] = useState(q);
  const [mode, setMode] = useState<ArchiveApplicationMode | undefined>(
    applicationMode,
  );

  useEffect(() => setQuery(q), [q]);
  useEffect(() => setMode(applicationMode), [applicationMode]);

  return (
    <form
      className="flex flex-col gap-3 sm:flex-row"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(query, mode);
      }}
    >
      <label className="sr-only" htmlFor="archive-search">
        프로젝트 검색
      </label>
      <Input
        id="archive-search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="프로그램 또는 프로젝트 이름 검색"
      />
      <label className="sr-only" htmlFor="archive-application-mode">
        참여 방식
      </label>
      <select
        id="archive-application-mode"
        className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
        value={mode ?? ''}
        onChange={(event) =>
          setMode(
            event.target.value === ''
              ? undefined
              : (event.target.value as ArchiveApplicationMode),
          )
        }
      >
        <option value="">전체</option>
        <option value="PERSONAL">개인</option>
        <option value="TEAM">팀</option>
      </select>
      <Button type="submit">
        <Search aria-hidden="true" />
        검색
      </Button>
    </form>
  );
}

export function ArchiveListContent({
  state,
  q,
  applicationMode,
  onSearch,
  onPage,
  onRetry,
}: ArchiveListContentProps) {
  if (state.kind === 'loading') return <LoadingState />;
  if (state.kind === 'error') return <ErrorState onRetry={onRetry} />;

  const { archive } = state;
  const searchActive = q.trim().length > 0 || applicationMode !== undefined;
  const lastPage = Math.max(1, Math.ceil(archive.total / archive.pageSize));

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-5 sm:p-8">
      <PageHeader
        title="공개 아카이브"
        description="공개된 프로젝트와 활동 기록을 확인합니다."
      />
      <ArchiveSearch
        q={q}
        applicationMode={applicationMode}
        onSearch={onSearch}
      />
      {archive.items.length === 0 ? (
        <EmptyState
          icon={<Archive className="size-8" />}
          title={searchActive ? '검색 결과 없음' : '공개된 프로젝트 없음'}
          description={
            searchActive
              ? '검색어나 참여 방식을 바꾸어 다시 찾아보세요.'
              : '아직 공개된 프로젝트가 없습니다.'
          }
          action={
            searchActive ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => onSearch('', undefined)}
              >
                필터 초기화
              </Button>
            ) : undefined
          }
        />
      ) : (
        <section aria-labelledby="archive-list-title" className="grid gap-4">
          <div className="flex items-center justify-between gap-3">
            <h2
              id="archive-list-title"
              className="font-heading text-xl font-semibold"
            >
              공개 프로젝트
            </h2>
            <span className="text-sm text-muted-foreground">
              {archive.total}개
            </span>
          </div>
          <CardGrid>
            {archive.items.map((item) => (
              <ArchiveCard key={item.repositoryId} item={item} />
            ))}
          </CardGrid>
          {lastPage > 1 ? (
            <nav
              aria-label="공개 아카이브 페이지"
              className="flex items-center justify-center gap-3"
            >
              <Button
                type="button"
                variant="outline"
                disabled={archive.page === 1}
                onClick={() => onPage(archive.page - 1)}
              >
                이전
              </Button>
              <span className="text-sm text-muted-foreground">
                {archive.page} / {lastPage}
              </span>
              <Button
                type="button"
                variant="outline"
                disabled={archive.page === lastPage}
                onClick={() => onPage(archive.page + 1)}
              >
                다음
              </Button>
            </nav>
          ) : null}
        </section>
      )}
    </main>
  );
}

export function ArchiveListView() {
  const [attempt, setAttempt] = useState(0);
  const [q, setQ] = useState('');
  const [applicationMode, setApplicationMode] = useState<
    ArchiveApplicationMode | undefined
  >();
  const [page, setPage] = useState(1);
  const [state, setState] = useState<ArchiveListState>({ kind: 'loading' });
  const retry = useCallback(() => setAttempt((current) => current + 1), []);
  const search = useCallback(
    (nextQ: string, nextMode?: ArchiveApplicationMode) => {
      setQ(nextQ);
      setApplicationMode(nextMode);
      setPage(1);
    },
    [],
  );

  useEffect(() => {
    let active = true;
    setState({ kind: 'loading' });
    loadPublicArchive({ page, pageSize: PAGE_SIZE, q, applicationMode })
      .then((archive) => {
        if (active) setState({ kind: 'ready', archive });
      })
      .catch(() => {
        if (active) setState({ kind: 'error' });
      });
    return () => {
      active = false;
    };
  }, [applicationMode, attempt, page, q]);

  return (
    <ArchiveListContent
      state={state}
      q={q}
      applicationMode={applicationMode}
      onSearch={search}
      onPage={setPage}
      onRetry={retry}
    />
  );
}
