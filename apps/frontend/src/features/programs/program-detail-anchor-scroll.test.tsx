// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProgramDetail } from './types';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

vi.mock('./components/activity-graph-panel', () => ({
  ActivityGraphPanel: () => null,
}));

vi.mock('./milestone-document-list', () => ({
  MilestoneDocumentSection: () => null,
}));

import { ProgramDetailReadyState } from './program-detail-view';

const program = {
  id: 'program-anchor-review',
  name: '활동 위치 확인 프로그램',
  organizer: '운영기관',
  trackType: 'EXTRACURRICULAR',

  applicationTemplateKey: 'basic',
  lifecycle: 'PUBLISHED',
  description: '합성 프로그램',
  repositoryProvisioningEnabled: true,
  applicationPeriod: {
    startsAt: '2026-08-01T00:00:00+09:00',
    endsAt: '2026-09-30T23:59:59+09:00',
  },
  viewer: { role: 'STAFF', applicationStatus: null },
  milestones: [],
} satisfies ProgramDetail;

let container: HTMLDivElement;
let root: Root;
let resizeCallback: ResizeObserverCallback | undefined;
let resizeObserver: FakeResizeObserver | undefined;
const scrollIntoView = vi.fn();

class FakeResizeObserver implements ResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeCallback = callback;
    resizeObserver = this;
  }

  readonly disconnect = vi.fn();
  readonly observe = vi.fn();
  readonly unobserve = vi.fn();
}

beforeEach(() => {
  vi.useFakeTimers();
  resizeCallback = undefined;
  resizeObserver = undefined;
  scrollIntoView.mockReset();
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: scrollIntoView,
  });
  window.location.hash = '#activity';
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.location.hash = '';
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
});

describe('프로그램 활동 딥링크 위치 유지', () => {
  it('2초보다 늦게 레이아웃이 바뀌어도 활동 영역을 다시 맞춘다', () => {
    act(() => {
      root.render(<ProgramDetailReadyState program={program} />);
    });
    expect(scrollIntoView).toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    const callsBeforeLateLayout = scrollIntoView.mock.calls.length;

    const lateLayoutCallback = resizeCallback;
    if (lateLayoutCallback === undefined) {
      throw new TypeError('프로그램 레이아웃 관찰자가 등록되지 않았습니다.');
    }
    const observer = resizeObserver;
    if (observer === undefined) {
      throw new TypeError('프로그램 레이아웃 관찰자 인스턴스가 없습니다.');
    }
    act(() => {
      lateLayoutCallback([], observer);
    });

    expect(scrollIntoView.mock.calls.length).toBeGreaterThan(
      callsBeforeLateLayout,
    );
  });

  it('사용자가 스크롤을 시작하면 레이아웃 관찰을 중단한다', () => {
    act(() => {
      root.render(<ProgramDetailReadyState program={program} />);
    });
    if (resizeObserver === undefined) {
      throw new TypeError('프로그램 레이아웃 관찰자 인스턴스가 없습니다.');
    }

    act(() => window.dispatchEvent(new WheelEvent('wheel')));

    expect(resizeObserver.disconnect).toHaveBeenCalledOnce();
  });

  it('활동 해시가 없으면 위치를 강제로 바꾸지 않는다', () => {
    window.location.hash = '';

    act(() => {
      root.render(<ProgramDetailReadyState program={program} />);
    });

    expect(resizeObserver).toBeUndefined();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
