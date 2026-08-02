'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Archive, RotateCcw } from 'lucide-react';
import { CardGrid, EmptyState, PageHeader, StatusBadge } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { loadArchivePage } from '../api';
import {
  ARCHIVE_CATEGORIES,
  ARCHIVE_CATEGORY_LABELS,
  type ArchiveCategory,
  type ArchiveListItem,
  type ArchiveListState,
} from '../types';

const PAGE_SIZE = 12;

type ArchiveListContentProps = {
  readonly state: ArchiveListState;
  readonly category?: ArchiveCategory;
  readonly hasPrevious: boolean;
  readonly onCategoryChange: (category?: ArchiveCategory) => void;
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

function ArchiveCategoryFilter({
  category,
  onCategoryChange,
}: Pick<ArchiveListContentProps, 'category' | 'onCategoryChange'>) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <label className="sr-only" htmlFor="archive-category">
        프로그램 분류
      </label>
      <Select
        id="archive-category"
        className="w-fit"
        value={category ?? ''}
        onChange={(event) =>
          onCategoryChange(
            event.target.value === ''
              ? undefined
              : (event.target.value as ArchiveCategory),
          )
        }
      >
        <option value="">전체 분류</option>
        {ARCHIVE_CATEGORIES.map((value) => (
          <option key={value} value={value}>
            {ARCHIVE_CATEGORY_LABELS[value]}
          </option>
        ))}
      </Select>
    </div>
  );
}

export function ArchiveListContent({
  state,
  category,
  hasPrevious,
  onCategoryChange,
  onNext,
  onPrevious,
  onRetry,
}: ArchiveListContentProps) {
  if (state.kind === 'loading') return <LoadingState />;
  if (state.kind === 'error') return <ErrorState onRetry={onRetry} />;

  const { page } = state;
  const items =
    category === undefined
      ? page.items
      : page.items.filter((item) => item.category === category);
  const filterActive = category !== undefined;
  const hasNext = page.nextPageId !== null;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-5 sm:p-8">
      <PageHeader
        title="공개 아카이브"
        description="공개된 프로젝트와 누적 활동 기록을 확인합니다."
      />
      <ArchiveCategoryFilter
        category={category}
        onCategoryChange={onCategoryChange}
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
                onClick={() => onCategoryChange(undefined)}
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

export function ArchiveListView() {
  const [attempt, setAttempt] = useState(0);
  const [category, setCategory] = useState<ArchiveCategory | undefined>();
  const [cursorStack, setCursorStack] = useState<readonly (string | null)[]>([
    null,
  ]);
  const [state, setState] = useState<ArchiveListState>({ kind: 'loading' });
  const cursor = cursorStack[cursorStack.length - 1] ?? null;

  const retry = useCallback(() => setAttempt((current) => current + 1), []);
  const changeCategory = useCallback((nextCategory?: ArchiveCategory) => {
    setCategory(nextCategory);
    setCursorStack([null]);
  }, []);
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
    setState({ kind: 'loading' });
    loadArchivePage({ pageId: cursor, pageSize: PAGE_SIZE })
      .then((page) => {
        if (active) setState({ kind: 'ready', page });
      })
      .catch(() => {
        if (active) setState({ kind: 'error' });
      });
    return () => {
      active = false;
    };
  }, [attempt, cursor]);

  return (
    <ArchiveListContent
      state={state}
      category={category}
      hasPrevious={cursorStack.length > 1}
      onCategoryChange={changeCategory}
      onNext={next}
      onPrevious={previous}
      onRetry={retry}
    />
  );
}
