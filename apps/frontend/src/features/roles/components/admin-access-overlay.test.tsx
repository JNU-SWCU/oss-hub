// @vitest-environment happy-dom

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

// 상세 본문은 이 파일의 관심사가 아니다 — 오버레이가 닫힐 때 목록 행으로
// 초점을 되돌리는지만 본다. 실제 뷰는 마운트되자마자 fetch를 걸어 이 테스트를
// 네트워크에 묶어 버리므로 자리 표시자로 바꾼다.
vi.mock('./admin-access-detail-view', () => ({
  AdminAccessDetailView: () => null,
}));

import { AdminAccessOverlay } from './admin-access-overlay';

const USER_ID = 'synthetic-admin-target';

let container: HTMLDivElement;
let root: Root;
/** 오버레이를 연 트리거 — 목록의 사용자 행 링크와 같은 모양이다. */
let triggerRow: HTMLAnchorElement;

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.append(container);

  triggerRow = document.createElement('a');
  triggerRow.href = `/admin/access/users/${USER_ID}`;
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

    // 닫히는 순간 목록은 searchParams를 다시 읽어 재요청·재렌더한다 — 그
    // 사이에는 트리거 행이 DOM에서 잠깐 사라진다.
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
