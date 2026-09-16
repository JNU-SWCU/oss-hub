'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Archive, RotateCcw } from 'lucide-react';
import { CardGrid, EmptyState, PageHeader, ListCard } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { loadArchivePage, loadArchiveYears } from '../api';
import { ArchiveListYearChips } from '../archive-list-category-nav';
import {
  archiveListHref,
  parseArchiveListFilter,
  type ArchiveListFilter,
  type ArchiveListItem,
  type ArchiveListState,
} from '../types';

const PAGE_SIZE = 12;

type ArchiveListContentProps = {
  readonly state: ArchiveListState;
  readonly filter: ArchiveListFilter;
  readonly years: readonly number[];
  readonly hasPrevious: boolean;
  readonly onFilterChange: (filter: ArchiveListFilter) => void;
  readonly onNext: () => void;
  readonly onPrevious: () => void;
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

/** GitHub 브랜드 마크. lucide가 브랜드 아이콘을 제공하지 않아 직접 둔다. */
function GithubMark() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="currentColor"
      className="size-3.5 shrink-0"
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

function ArchiveCard({ item }: { readonly item: ArchiveListItem }) {
  return (
    <ListCard
      title={item.displayName}
      subtitle={item.programName}
      badge={{ text: 'public', variant: 'approved', icon: <GithubMark /> }}
      details={[
        {
          label: '공개일',
          value: <time dateTime={item.publishedAt}>{item.publishedLabel}</time>,
        },
      ]}
      href={item.detailUrl}
    />
  );
}

export function ArchiveListContent({
  state,
  filter,
  years,
  hasPrevious,
  onFilterChange,
  onNext,
  onPrevious,
  onRetry,
}: ArchiveListContentProps) {
  if (state.kind === 'loading') return <LoadingState />;
  if (state.kind === 'error') return <ErrorState onRetry={onRetry} />;

  const { page } = state;
  const items = page.items;
  const filterActive = filter !== 'all';
  const hasNext = page.nextPageId !== null;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-5 sm:p-8">
      <PageHeader
        title="공개 아카이브"
        description="공개된 프로젝트와 누적 활동 기록을 확인합니다."
      />
      <ArchiveListYearChips
        className="min-[900px]:hidden"
        years={years}
        value={filter}
        onChange={onFilterChange}
      />
      {items.length === 0 ? (
        <EmptyState
          icon={<Archive className="size-8" />}
          title={
            filterActive
              ? '이 연도의 공개 프로젝트가 없습니다'
              : '아직 공개된 프로젝트가 없습니다'
          }
          description={
            filterActive
              ? '다른 연도를 선택하거나 전체 프로젝트를 확인해 주세요.'
              : undefined
          }
          action={
            filterActive ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => onFilterChange('all')}
              >
                필터 초기화
              </Button>
            ) : undefined
          }
        />
      ) : (
        <section aria-labelledby="archive-list-title" className="grid gap-4">
          <h2
            id="archive-list-title"
            className="font-heading text-xl font-semibold"
          >
            공개 프로젝트
          </h2>
          <CardGrid>
            {items.map((item) => (
              <ArchiveCard key={item.projectId} item={item} />
            ))}
          </CardGrid>
          {hasPrevious || hasNext ? (
            <nav
              aria-label="공개 아카이브 페이지"
              className="flex items-center justify-center gap-3"
            >
              <Button
                type="button"
                variant="outline"
                disabled={!hasPrevious}
                onClick={onPrevious}
              >
                이전
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={!hasNext}
                onClick={onNext}
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

/**
 * 연도 필터는 **전역 사이드 패널**(공개 아카이브 메뉴)이 URL `?year=` 로 보낸다.
 * 이 페이지는 그 쿼리를 읽고 서버에 전달하며, 좁은 폭에서만 칩으로 같은 전환을 제공한다.
 */
export function ArchiveListView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const filter = parseArchiveListFilter(searchParams.get('year'));
  const year = filter === 'all' ? undefined : filter;

  const [attempt, setAttempt] = useState(0);
  const [years, setYears] = useState<readonly number[]>([]);
  const [cursorStack, setCursorStack] = useState<readonly (string | null)[]>([
    null,
  ]);
  const [state, setState] = useState<ArchiveListState>({ kind: 'loading' });
  const cursor = cursorStack[cursorStack.length - 1] ?? null;

  const retry = useCallback(() => setAttempt((current) => current + 1), []);
  const changeFilter = useCallback(
    (next: ArchiveListFilter) => {
      router.push(archiveListHref(next));
    },
    [router],
  );
  const next = useCallback(() => {
    if (state.kind === 'ready' && state.page.nextPageId !== null) {
      const nextPageId = state.page.nextPageId;
      setCursorStack((current) => [...current, nextPageId]);
    }
  }, [state]);
  const previous = useCallback(() => {
    setCursorStack((current) =>
      current.length > 1 ? current.slice(0, -1) : current,
    );
  }, []);

  useEffect(() => {
    let active = true;
    loadArchiveYears()
      .then((loaded) => {
        if (active) setYears(loaded);
      })
      .catch(() => {
        if (active) setYears([]);
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  useEffect(() => {
    setCursorStack([null]);
  }, [filter]);

  useEffect(() => {
    let active = true;
    setState({ kind: 'loading' });
    loadArchivePage({ pageId: cursor, pageSize: PAGE_SIZE, year })
      .then((page) => {
        if (active) setState({ kind: 'ready', page });
      })
      .catch(() => {
        if (active) setState({ kind: 'error' });
      });
    return () => {
      active = false;
    };
  }, [attempt, cursor, year]);

  return (
    <ArchiveListContent
      state={state}
      filter={filter}
      years={years}
      hasPrevious={cursorStack.length > 1}
      onFilterChange={changeFilter}
      onNext={next}
      onPrevious={previous}
      onRetry={retry}
    />
  );
}
