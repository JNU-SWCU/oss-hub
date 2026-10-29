'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { loadArchivePage, loadArchiveYears } from '../api';
import {
  archiveListHref,
  parseArchiveListFilter,
  type ArchiveListFilter,
  type ArchiveListState,
} from '../types';
import { ArchiveListContent } from './archive-list-content';

const PAGE_SIZE = 12;

export function ArchiveListScreen() {
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
