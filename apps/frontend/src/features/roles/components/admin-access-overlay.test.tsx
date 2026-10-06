import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const router = vi.hoisted(() => ({ back: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => router,
}));

vi.mock('./admin-access-detail-view', () => ({
  AdminAccessDetailView: () => null,
}));

import {
  AdminAccessOverlay,
  readProductShellScrollTop,
  writeProductShellScrollTop,
} from './admin-access-overlay';

const USER_ID = 'synthetic-admin-target';

let container: HTMLDivElement;
let root: Root;

let triggerRow: HTMLAnchorElement;

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.append(container);

  triggerRow = document.createElement('a');
  triggerRow.href = `/dashboard/users/${USER_ID}`;
  triggerRow.textContent = '합성 교직원 후보';
  document.body.append(triggerRow);
  triggerRow.focus();

  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  triggerRow.remove();
  vi.clearAllTimers();
  vi.useRealTimers();
  router.back.mockReset();
});

function mountOverlay() {
  act(() => {
    root.render(<AdminAccessOverlay userId={USER_ID} workspace="directory" />);
  });
}

describe('AdminAccessOverlay — 닫을 때 초점 복원', () => {
  it('오버레이가 열리면 초점이 트리거 행에서 다이얼로그 안으로 옮겨간다', () => {
    mountOverlay();

    expect(document.activeElement).not.toBe(triggerRow);
  });

  it('오버레이가 언마운트되면 초점이 원래 사용자 행으로 돌아온다', () => {
    mountOverlay();

    act(() => {
      root.render(null);
    });

    expect(document.activeElement).toBe(triggerRow);
  });

  it('목록이 재요청 중이라 행이 아직 없으면, 행이 다시 붙은 뒤에 초점을 되돌린다', () => {
    mountOverlay();

    triggerRow.remove();

    act(() => {
      root.render(null);
    });
    expect(document.activeElement).not.toBe(triggerRow);

    document.body.append(triggerRow);
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(document.activeElement).toBe(triggerRow);
  });
});

describe('AdminAccessOverlay — 회원 셸 스크롤 복원', () => {
  it('#main-content가 있으면 그 칸의 scrollTop을 읽고 되돌린다', () => {
    const scroller = document.createElement('div');
    scroller.id = 'main-content';
    Object.defineProperty(scroller, 'scrollTop', {
      configurable: true,
      writable: true,
      value: 240,
    });
    document.body.append(scroller);

    expect(readProductShellScrollTop()).toBe(240);
    writeProductShellScrollTop(80);
    expect(scroller.scrollTop).toBe(80);

    scroller.remove();
  });

  it('오버레이를 닫으면 #main-content 스크롤을 열릴 때 값으로 되돌린다', () => {
    const scroller = document.createElement('div');
    scroller.id = 'main-content';
    Object.defineProperty(scroller, 'scrollTop', {
      configurable: true,
      writable: true,
      value: 180,
    });
    document.body.append(scroller);

    mountOverlay();
    scroller.scrollTop = 0;

    act(() => {
      root.render(null);
    });

    expect(scroller.scrollTop).toBe(180);
    scroller.remove();
  });
});
