import { act } from 'react';
import type { Root } from 'react-dom/client';
import {
  createListScreenRoot as createRoot,
  listNavigation,
  useTestSearchParams,
} from '../../../test-support/list-screen-root';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditLogPage, AuditLogRecord } from './types';
import type { AuditLogViewProps } from './audit-log-view';
import { parseAuditLogPage } from './parser';
import { AUDIT_LOG_PAGE_RESPONSE_FIXTURE } from './fixtures';

vi.mock('next/navigation', () => ({
  useSearchParams: useTestSearchParams,
  useRouter: () => listNavigation,
  usePathname: () => '/audit-log',
}));

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const api = vi.hoisted(() => ({ fetchAuditLogs: vi.fn() }));
vi.mock('./api', () => api);

const captured = vi.hoisted(() => ({
  props: null as AuditLogViewProps | null,
}));

vi.mock('./audit-log-view', () => ({
  AuditLogView: (props: AuditLogViewProps) => {
    captured.props = props;
    return null;
  },
}));

import { AuditLogScreen } from './audit-log-screen';

function props(): AuditLogViewProps {
  if (captured.props === null) {
    throw new Error('expected AuditLogView props');
  }
  return captured.props;
}

const fixture = parseAuditLogPage(AUDIT_LOG_PAGE_RESPONSE_FIXTURE);

function record(id: string): AuditLogRecord {
  return { ...fixture.items[0], id };
}

function page(ids: readonly string[], total: number): AuditLogPage {
  return {
    items: ids.map(record),
    total,
    page: 1,
    limit: total,
    counts: fixture.counts,
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('AuditLogScreen', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    captured.props = null;
    api.fetchAuditLogs.mockReset();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('기존 날짜 북마크의 페이지 범위를 보기 전환과 이동에도 유지한다', async () => {
    const from = '2026-01-01';
    const to = '2026-02-01';
    listNavigation.search = `from=${from}&to=${to}&page=2`;
    api.fetchAuditLogs.mockResolvedValue({ ...fixture, total: 65 });

    await act(async () => root.render(<AuditLogScreen />));

    const request = { q: '', action: '', category: '', from, to, limit: 20 };
    expect(api.fetchAuditLogs).toHaveBeenLastCalledWith({
      ...request,
      page: 2,
    });
    expect(props()).toMatchObject({ page: 2, limit: 20 });

    await act(async () => props().onViewChange('table'));

    expect(props()).toMatchObject({ view: 'table', page: 2, limit: 20 });
    expect(api.fetchAuditLogs).toHaveBeenCalledTimes(1);

    await act(async () => props().onPageChange(3));

    expect(api.fetchAuditLogs).toHaveBeenLastCalledWith({
      ...request,
      page: 3,
    });
    expect(props()).toMatchObject({ page: 3, limit: 20 });

    const filters = { ...props().filters, from: '2026-01-15' };
    await act(async () => props().onApply(filters));

    expect(api.fetchAuditLogs).toHaveBeenLastCalledWith({
      ...request,
      from: filters.from,
      page: 1,
      limit: 50,
    });
    expect(props()).toMatchObject({ page: 1, limit: 50 });
  });

  it('검색어만 있는 기존 조사 링크는 날짜 제한 없이 조회한다', async () => {
    const q = 'synthetic-admin';
    listNavigation.search = `q=${q}`;
    api.fetchAuditLogs.mockResolvedValue(fixture);

    await act(async () => root.render(<AuditLogScreen />));

    expect(api.fetchAuditLogs).toHaveBeenLastCalledWith({
      q,
      action: '',
      category: '',
      from: '',
      to: '',
      page: 1,
      limit: 50,
    });
    expect(props().filters).toMatchObject({ q, period: 'custom' });
  });

  it('마지막 페이지를 넘은 조사 링크는 필터를 유지하고 마지막 페이지를 다시 조회한다', async () => {
    listNavigation.search = 'category=LOGIN&page=9';
    api.fetchAuditLogs
      .mockResolvedValueOnce(page([], 51))
      .mockResolvedValueOnce(page(['last'], 51));
    await act(async () => root.render(<AuditLogScreen />));
    expect(api.fetchAuditLogs).toHaveBeenCalledTimes(2);
    expect(api.fetchAuditLogs).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ page: 9 }),
    );
    expect(api.fetchAuditLogs).toHaveBeenLastCalledWith({
      q: '',
      action: '',
      category: 'LOGIN',
      from: '',
      to: '',
      page: 2,
      limit: 50,
    });
    expect(props().records.map(({ id }) => id)).toEqual(['last']);
  });

  it('기본 화면에서 검색해도 최근 30일과 새 페이지 범위를 유지한다', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-01T00:00:00+09:00'));
    api.fetchAuditLogs.mockResolvedValue(fixture);

    await act(async () => root.render(<AuditLogScreen />));

    const request = {
      q: '',
      action: '',
      category: '',
      from: '2026-05-03',
      to: '',
      page: 1,
      limit: 50,
    };
    expect(api.fetchAuditLogs).toHaveBeenLastCalledWith(request);
    expect(props()).toMatchObject({ view: 'feed', page: 1, limit: 50 });

    const q = 'synthetic-admin';
    const filters = { ...props().filters, q: `  ${q}  ` };
    await act(async () => props().onApply(filters));

    expect(api.fetchAuditLogs).toHaveBeenLastCalledWith({ ...request, q });
    expect(new URLSearchParams(listNavigation.search).get('period')).toBe(
      '30d',
    );
  });

  it('늦게 끝난 이전 요청의 목록이 최신 결과를 덮지 않는다', async () => {
    const first = deferred<AuditLogPage>();
    const second = deferred<AuditLogPage>();
    api.fetchAuditLogs
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    await act(async () => {
      root.render(<AuditLogScreen />);
    });

    await act(async () => {
      props().onPageChange(2);
    });
    expect(api.fetchAuditLogs).toHaveBeenCalledTimes(2);

    await act(async () => {
      second.resolve(page(['latest'], 51));
      await second.promise;
    });
    expect(props().records.map(({ id }) => id)).toEqual(['latest']);

    await act(async () => {
      first.resolve(page(['stale-a', 'stale-b'], 2));
      await first.promise;
    });

    expect(props().records.map(({ id }) => id)).toEqual(['latest']);
    expect(props().total).toBe(51);
  });

  it('늦게 끝난 이전 요청의 실패가 최신 결과를 지우지 않는다', async () => {
    const first = deferred<AuditLogPage>();
    const second = deferred<AuditLogPage>();
    api.fetchAuditLogs
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    await act(async () => {
      root.render(<AuditLogScreen />);
    });
    await act(async () => {
      props().onPageChange(2);
    });
    await act(async () => {
      second.resolve(page(['latest'], 51));
      await second.promise;
    });

    await act(async () => {
      first.reject(new Error('synthetic slow failure'));
      await first.promise.catch(() => undefined);
    });

    expect(props().errorMessage).toBeNull();
    expect(props().records.map(({ id }) => id)).toEqual(['latest']);
  });

  it('이전 요청이 최신 조회의 로딩 표시를 끄지 않는다', async () => {
    const first = deferred<AuditLogPage>();
    const second = deferred<AuditLogPage>();
    api.fetchAuditLogs
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    await act(async () => {
      root.render(<AuditLogScreen />);
    });
    await act(async () => {
      props().onPageChange(2);
    });

    await act(async () => {
      first.resolve(page(['stale'], 1));
      await first.promise;
    });

    expect(props().isLoading).toBe(true);

    await act(async () => {
      second.resolve(page(['latest'], 51));
      await second.promise;
    });
    expect(props().isLoading).toBe(false);
  });
});
