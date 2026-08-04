'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Archive, RotateCcw } from 'lucide-react';
import { CardGrid, EmptyState, PageHeader, StatusBadge } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { loadArchivePage } from '../api';
import { ArchiveListCategoryChips } from '../archive-list-category-nav';
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

function ArchiveCard({ item }: { readonly item: ArchiveListItem }) {
  return (
    <Card className="min-w-0">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">
              {item.programName} · {item.modeLabel} · {item.categoryLabel}
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

export function ArchiveListContent({
  state,
  filter,
  hasPrevious,
  onFilterChange,
  onNext,
  onPrevious,
  onRetry,
}: ArchiveListContentProps) {
  if (state.kind === 'loading') return <LoadingState />;
  if (state.kind === 'error') return <ErrorState onRetry={onRetry} />;

  const { page } = state;
  // 서버가 category 쿼리로 이미 거른다 — 클라이언트 재필터 금지.
  const items = page.items;
  const filterActive = filter !== 'all';
  const hasNext = page.nextPageId !== null;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-5 sm:p-8">
      <PageHeader
        title="공개 아카이브"
        description="공개된 프로젝트와 누적 활동 기록을 확인합니다. 분류는 왼쪽 메뉴에서 고릅니다."
      />
      {/* 좁은 폭: 전역 사이드가 가로 띠라 분류 칩을 본문에 한 번 더 둔다 */}
      <ArchiveListCategoryChips
        className="min-[900px]:hidden"
        value={filter}
        onChange={onFilterChange}
      />
      {items.length === 0 ? (
        <EmptyState
          icon={<Archive className="size-8" />}
          title={filterActive ? '검색 결과 없음' : '공개된 프로젝트 없음'}
          description={
            filterActive
              ? '분류를 바꾸어 다시 찾아보세요.'
              : '아직 공개된 프로젝트가 없습니다.'
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
          <div className="flex items-center justify-between gap-3">
            <h2
              id="archive-list-title"
              className="font-heading text-xl font-semibold"
            >
              공개 프로젝트
            </h2>
            <span className="text-sm text-muted-foreground">
              {items.length}개 표시
            </span>
          </div>
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
 * 분류 필터는 **전역 사이드 패널**(공개 아카이브 메뉴)이 URL `?category=` 로 보낸다.
 * 이 페이지는 그 쿼리를 읽고 서버에 전달하며, 좁은 폭에서만 칩으로 같은 전환을 제공한다.
 */
export function ArchiveListView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const filter = parseArchiveListFilter(searchParams.get('category'));
  const category = filter === 'all' ? undefined : filter;

  const [attempt, setAttempt] = useState(0);
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

  // 분류가 바뀌면 커서 스택을 비워 이전 분류 커서가 오염되지 않게 한다.
  useEffect(() => {
    setCursorStack([null]);
  }, [filter]);

  useEffect(() => {
    let active = true;
    setState({ kind: 'loading' });
    loadArchivePage({ pageId: cursor, pageSize: PAGE_SIZE, category })
      .then((page) => {
        if (active) setState({ kind: 'ready', page });
      })
      .catch(() => {
        if (active) setState({ kind: 'error' });
      });
    return () => {
      active = false;
    };
  }, [attempt, cursor, category]);

  return (
    <ArchiveListContent
      state={state}
      filter={filter}
      hasPrevious={cursorStack.length > 1}
      onFilterChange={changeFilter}
      onNext={next}
      onPrevious={previous}
      onRetry={retry}
    />
  );
}
