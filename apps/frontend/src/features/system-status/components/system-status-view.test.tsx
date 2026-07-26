import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { SystemStatus, SystemStatusViewState } from '../types';
import { SystemStatusView } from './system-status-view';

const normal: SystemStatus = {
  health: 'NORMAL',
  lastCompleteSuccessAt: '2026-07-25T11:00:00.000Z',
  dataAsOf: '2026-07-25T11:00:00.000Z',
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

  it('완료 데이터가 없는 응답은 빈 상태로 표시한다', () => {
    const html = render({
      kind: 'success',
      status: {
        ...normal,
        health: 'FAILED',
        lastCompleteSuccessAt: null,
        dataAsOf: null,
        safeReason: 'NO_COMPLETE_DATA',
      },
    });
    expect(html).toContain('아직 수집 이력이 없습니다');
    expect(html).toContain('완료된 수집 이력이 없습니다.');
    expect(html).not.toContain('시스템 상태 요약');
  });

  it('transport error는 내부 오류를 노출하지 않고 재시도를 표시한다', () => {
    const html = render({ kind: 'error' });
    expect(html).toContain('시스템 상태를 불러오지 못했습니다');
    expect(html).toContain('잠시 후 다시 시도해 주세요.');
    expect(html).toContain('다시 시도');
    expect(html).not.toContain('synthetic transport failure');
  });

  it('정상 응답의 상태, 현재 작업, 시각을 표시한다', () => {
    const html = render({ kind: 'success', status: normal });
    expect(html).toContain('정상');
    expect(html).toContain('대기 중');
    expect(html).toContain('데이터 수집이 정상적으로 운영되고 있습니다.');
    expect(html).toContain('2026');
  });

  it.each([
    ['DELAYED', 'STALE_DATA', '지연', '최근 데이터 수집이 지연되고 있습니다.'],
    ['FAILED', 'PERMISSION_INVALID', '실패', '수집 권한 상태를 확인해 주세요.'],
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
