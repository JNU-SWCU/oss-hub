// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditLogPage, AuditLogRecord } from './types';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const api = vi.hoisted(() => ({ fetchAuditLogs: vi.fn() }));
vi.mock('./api', () => api);

type CapturedViewProps = {
  readonly records: readonly AuditLogRecord[];
  readonly total: number;
  readonly page: number;
  readonly isLoading: boolean;
  readonly errorMessage: string | null;
  readonly onPageChange: (page: number) => void;
};

const captured = vi.hoisted(() => ({
  props: null as CapturedViewProps | null,
}));

vi.mock('./audit-log-view', () => ({
  AuditLogView: (props: CapturedViewProps) => {
    captured.props = props;
    return null;
  },
}));

import { AuditLogScreen } from './audit-log-screen';

function props(): CapturedViewProps {
  if (captured.props === null) {
    throw new Error('expected AuditLogView props');
  }
  return captured.props;
}

// 실명·학번 금지(docs/rules/security.md) — actor·target 은 합성 값만 쓴다.
function record(id: string): AuditLogRecord {
  return {
    id,
    actor: 'synthetic-admin',
    action: 'STAFF_ROLE_REQUEST_APPROVED',
    targetType: 'USER',
    targetId: `synthetic-target-${id}`,
    target: `synthetic-target-${id}`,
    occurredAt: '2026-07-24T04:00:00.000Z',
  };
}

function page(ids: readonly string[], total: number): AuditLogPage {
  return { items: ids.map(record), total, page: 1, limit: total };
}

/** 응답 시각을 테스트가 직접 정하기 위한 수동 해제 Promise. */
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

describe('AuditLogScreen 이전 조회 결과가 최신 조건을 덮지 않는다', () => {
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

    // 첫 조회가 끝나기 전에 페이지를 바꿔 두 번째 조회를 띄운다.
    await act(async () => {
      props().onPageChange(2);
    });
    expect(api.fetchAuditLogs).toHaveBeenCalledTimes(2);

    // 나중에 띄운 요청이 먼저 끝난다.
    await act(async () => {
      second.resolve(page(['latest'], 1));
      await second.promise;
    });
    expect(props().records.map(({ id }) => id)).toEqual(['latest']);

    // 뒤늦게 끝난 첫 요청은 화면을 바꾸지 않아야 한다.
    await act(async () => {
      first.resolve(page(['stale-a', 'stale-b'], 2));
      await first.promise;
    });

    expect(props().records.map(({ id }) => id)).toEqual(['latest']);
    expect(props().total).toBe(1);
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
      second.resolve(page(['latest'], 1));
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

    // 두 번째 조회가 진행 중인 상태에서 첫 요청만 끝난다.
    await act(async () => {
      first.resolve(page(['stale'], 1));
      await first.promise;
    });

    // 아직 불러오는 중이므로 스켈레톤이 유지돼야 한다
    // (페이지 이동 버튼의 disabled 도 이 값에 묶여 있다).
    expect(props().isLoading).toBe(true);

    await act(async () => {
      second.resolve(page(['latest'], 1));
      await second.promise;
    });
    expect(props().isLoading).toBe(false);
  });
});
