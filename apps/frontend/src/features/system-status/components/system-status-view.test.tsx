import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { SystemStatus, SystemStatusViewState } from '../types';
import { SystemStatusView } from './system-status-view';

const normal: SystemStatus = {
  health: 'NORMAL',
  dataAsOf: '2026-07-25T11:00:00.000Z',
  trackedRepositoryCount: 2,
  readyStreamCount: 6,
  backfillingStreamCount: 0,
  partialStreamCount: 0,
  retryPendingStreamCount: 0,
  oldestReadyCheckpointAt: '2026-07-25T10:00:00.000Z',
  oldestRetryPendingAt: null,
  lastCycleStartedAt: '2026-07-25T10:55:00.000Z',
  lastCycleCompletedAt: '2026-07-25T11:00:00.000Z',
  currentRunStatus: 'IDLE',
  safeReason: null,
};

function render(state: SystemStatusViewState): string {
  return renderToStaticMarkup(
    <SystemStatusView state={state} onRetry={() => undefined} />,
  );
}

function findRetry(node: ReactNode): (() => void) | undefined {
  if (!node || typeof node !== 'object' || !('props' in node)) return undefined;
  const element = node as ReactElement<{
    onClick?: () => void;
    children?: ReactNode;
  }>;
  if (element.props.onClick) return element.props.onClick;
  const children = element.props.children;
  const values = Array.isArray(children) ? children : [children];
  for (const child of values) {
    const handler = findRetry(child);
    if (handler) return handler;
  }
  return undefined;
}

describe('SystemStatusView', () => {
  it('loading 상태를 busy skeleton으로 안전하게 표시한다', () => {
    const html = render({ kind: 'loading' });
    expect(html).toContain('aria-label="시스템 상태를 불러오는 중"');
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain('undefined');
  });

  it('추적 중인 저장소가 없는 EMPTY 응답은 빈 상태로 표시한다', () => {
    const html = render({
      kind: 'success',
      status: {
        ...normal,
        health: 'EMPTY',
        trackedRepositoryCount: 0,
        readyStreamCount: 0,
        oldestReadyCheckpointAt: null,
        dataAsOf: null,
        lastCycleStartedAt: null,
        lastCycleCompletedAt: null,
        safeReason: 'NO_TRACKED_REPOSITORIES',
      },
    });
    expect(html).toContain('아직 추적 중인 저장소가 없습니다');
    expect(html).toContain('아직 추적 중인 저장소가 없습니다.');
    expect(html).not.toContain('시스템 상태 요약');
  });

  it('transport error는 내부 오류를 노출하지 않고 재시도를 표시한다', () => {
    const html = render({ kind: 'error' });
    expect(html).toContain('시스템 상태를 불러오지 못했습니다');
    expect(html).toContain('잠시 후 다시 시도해 주세요.');
    expect(html).toContain('다시 시도');
    expect(html).not.toContain('synthetic transport failure');
  });

  it('NORMAL 응답의 상태, 현재 작업, 시각, stream count를 표시한다', () => {
    const html = render({ kind: 'success', status: normal });
    expect(html).toContain('정상');
    expect(html).toContain('대기 중');
    expect(html).toContain('데이터 수집이 정상적으로 운영되고 있습니다.');
    expect(html).toContain('2026');
    expect(html).toContain('추적 저장소');
    expect(html).toContain('완료(READY)');
  });

  it.each([
    ['DELAYED', 'STALE_DATA', '지연', '최근 데이터 수집이 지연되고 있습니다.'],
    [
      'PARTIAL',
      'RUN_INCOMPLETE',
      '부분 진행',
      '일부 저장소의 수집이 아직 완료되지 않았습니다.',
    ],
    [
      'FAILED',
      'UPSTREAM_RATE_LIMITED',
      '실패',
      '재시도 대기 중인 stream이 있습니다.',
    ],
  ] as const)(
    '%s 상태는 안전한 사유만 표시한다',
    (health, safeReason, label, copy) => {
      const html = render({
        kind: 'success',
        status: { ...normal, health, safeReason },
      });
      expect(html).toContain(label);
      expect(html).toContain(copy);
      expect(html).not.toContain('token');
      expect(html).not.toContain('githubId');
    },
  );

  it('재시도 대기 checkpoint가 있으면 표시하고 없으면 생략한다', () => {
    const withRetry = render({
      kind: 'success',
      status: {
        ...normal,
        health: 'FAILED',
        safeReason: 'UPSTREAM_RATE_LIMITED',
        retryPendingStreamCount: 1,
        oldestRetryPendingAt: '2026-07-24T00:00:00.000Z',
      },
    });
    expect(withRetry).toContain('가장 오래된 재시도 대기');

    const withoutRetry = render({ kind: 'success', status: normal });
    expect(withoutRetry).not.toContain('가장 오래된 재시도 대기');
  });

  it('error 상태의 재시도 버튼이 전달된 handler를 호출한다', () => {
    const onRetry = vi.fn();
    const outer = SystemStatusView({
      state: { kind: 'error' },
      onRetry,
    }) as ReactElement;
    const rendered = (outer.type as (props: typeof outer.props) => ReactNode)(
      outer.props,
    );
    const retry = findRetry(rendered);
    expect(retry).toBe(onRetry);
    retry?.();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
