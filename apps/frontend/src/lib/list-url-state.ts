'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useDebouncedValue } from './use-debounced-value';

export { parseListPage, parseListEnum } from './list-url-params';

export function setListPage(params: URLSearchParams, page: number) {
  if (page > 1) params.set('page', String(page));
}

export function useListUrlNavigation<T>(
  state: T,
  build: (state: T) => URLSearchParams,
  owned: readonly string[],
  serialized: string,
) {
  const router = useRouter();
  const pathname = usePathname();
  return useCallback(
    (next: Partial<T>, mode: 'push' | 'replace' = 'push') => {
      const params = new URLSearchParams(serialized);
      for (const key of owned) params.delete(key);
      for (const [key, value] of build({ ...state, ...next }))
        params.set(key, value);
      const query = params.toString();
      router[mode](query ? pathname + '?' + query : pathname);
    },
    [state, build, owned, serialized, router, pathname],
  );
}

export function useParsedListUrlState<T>(
  serialized: string,
  parse: (params: URLSearchParams) => T,
) {
  return useMemo(
    () => parse(new URLSearchParams(serialized)),
    [serialized, parse],
  );
}

export function useUrlSearchDraft(search: string) {
  const [draft, setDraft] = useState({ source: search, value: search });
  if (draft.source !== search) setDraft({ source: search, value: search });
  const value = draft.source === search ? draft.value : search;
  return [
    value,
    (next: string) => setDraft({ source: search, value: next }),
  ] as const;
}

export function useDebouncedUrlSearch(
  search: string,
  onSearch: (value: string) => void,
) {
  const [value, setValue] = useUrlSearchDraft(search);
  const debounced = useDebouncedValue(value, 300);
  useEffect(() => {
    if (debounced === value && debounced.trim() !== search)
      onSearch(debounced.trim());
  }, [debounced, value, search, onSearch]);
  return [value, setValue] as const;
}
