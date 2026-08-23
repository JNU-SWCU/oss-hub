// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

/**
 * 결정 직후의 화면 갱신 경로를 controller 수준에서 고정한다.
 *
 * 백엔드 `AdminAccessService.requireVisibleTarget`은 관리자가 아닌 STAFF에게
 * "대기 요청이 살아 있는 대상"만 보여준다. 승인·반려로 그 요청이 사라진
 * 직후 가입 신청(queue) 화면이 상세를 다시 읽으면 404가 정답이다. 그래서
 * queue는 PATCH 응답(권위 있는 projection)으로 화면을 갱신하고 재조회하지
 * 않는다. 관리자 명부(directory)는 재조회해 canonical 권한 플래그와 서버가
 * 채운 감사 필드를 새로 읽는다.
 */

const loadAdminAccessDetail = vi.hoisted(() => vi.fn());
const executeAdminAccessMutation = vi.hoisted(() => vi.fn());

vi.mock('./admin-access-detail-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./admin-access-detail-api')>()),
  loadAdminAccessDetail,
}));

vi.mock('./admin-access-mutation-execution', () => ({
  executeAdminAccessMutation,
}));

import type { AdminAccessHistory } from './admin-access-api';
import type { AccessWorkspace } from './admin-access-list-query';
import { AdminAccessDetailNotFoundError } from './admin-access-detail-api';
import { adminDetail } from './admin-access-detail-test-fixture';
import { AdminAccessDetailView } from './components/admin-access-detail-view';
import {
  PENDING_DETAIL,
  PENDING_HISTORY,
  approvedResponse,
  clickButton,
  decidedHistory,
  findButton,
  flush,
  rejectedResponse,
  typeRejectReason,
} from './admin-access-detail-post-decision-fixture';

let container: HTMLDivElement;
let root: Root;

// `clearAllMocks`는 호출 기록만 지우고 `mockResolvedValueOnce`로 쌓인 큐는 남긴다.
// 앞 테스트가 쓰지 않고 남긴 Once 값이 다음 테스트의 기본 구현(`mockRejectedValue` 등)을
// 가로채 엉뚱한 화면을 그리므로, 구현까지 되돌리는 `resetAllMocks`로 격리한다.
// 되돌린 뒤에는 기본 구현이 없으므로 각 테스트가 필요한 응답을 직접 세운다.
beforeEach(() => {
  vi.resetAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function mount(workspace: AccessWorkspace): Promise<void> {
  await act(async () => {
    root.render(
      <AdminAccessDetailView userId="target" workspace={workspace} />,
    );
    await flush();
  });
}

async function approve(): Promise<void> {
  await act(async () => {
    clickButton(container, '승인');
    await flush();
  });
  await act(async () => {
    clickButton(container, '승인 확정');
    await flush();
  });
}

describe('가입 신청(queue) 결정 — 권위 있는 응답으로만 갱신한다', () => {
  it('승인하면 상세를 다시 읽지 않고 대기 카드가 사라지고 이력이 승인으로 바뀐다', async () => {
    // Given: 대기 요청이 하나 있는 가입 신청 상세.
    loadAdminAccessDetail.mockResolvedValue({
      detail: PENDING_DETAIL,
      history: PENDING_HISTORY,
    });
    executeAdminAccessMutation.mockResolvedValue(approvedResponse());
    await mount('queue');
    expect(container.textContent).toContain('대기 중인 요청');

    // When: 승인을 확정한다.
    await approve();

    // Then: 최초 1회 외에는 상세를 읽지 않는다(결정 후 GET은 백엔드가 404로 막는다).
    expect(loadAdminAccessDetail).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain('대기 중인 요청');
    expect(findButton(container, '승인')).toBeUndefined();
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      '요청 승인 처리를 완료했습니다',
    );
    const historySection = container.querySelector(
      'section[aria-labelledby="admin-access-role-request-history"]',
    );
    expect(historySection?.textContent).toContain('승인');
    expect(historySection?.textContent).not.toContain('대기');
  });

  it('반려해도 상세를 다시 읽지 않고 이력이 반려로 바뀐다', async () => {
    // Given
    loadAdminAccessDetail.mockResolvedValue({
      detail: PENDING_DETAIL,
      history: PENDING_HISTORY,
    });
    executeAdminAccessMutation.mockResolvedValue(rejectedResponse());
    await mount('queue');

    // When
    await act(async () => {
      clickButton(container, '반려');
      await flush();
    });
    await act(async () => {
      typeRejectReason(container, '합성 반려 사유 — 소속 확인이 필요합니다.');
      await flush();
    });
    await act(async () => {
      clickButton(container, '반려 확정');
      await flush();
    });

    // Then
    expect(loadAdminAccessDetail).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain('대기 중인 요청');
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      '요청 반려 처리를 완료했습니다',
    );
    const historySection = container.querySelector(
      'section[aria-labelledby="admin-access-role-request-history"]',
    );
    expect(historySection?.textContent).toContain('반려');
  });
});

describe('관리자 명부(directory) 결정 — 재조회로 최신 감사 필드를 읽는다', () => {
  it('승인하면 상세를 한 번 더 읽고 두 번째 응답을 그린다', async () => {
    // Given: 관리자는 결정 뒤에도 대상을 볼 수 있어 재조회가 정답이다.
    const secondHistory: AdminAccessHistory = decidedHistory(
      'APPROVED',
      '2026-08-22T00:00:00.000Z',
      'seed-auth-admin',
    );
    loadAdminAccessDetail
      .mockResolvedValueOnce({
        detail: PENDING_DETAIL,
        history: PENDING_HISTORY,
      })
      .mockResolvedValueOnce({
        detail: adminDetail({ pendingRequest: null, name: '재조회된 사용자' }),
        history: secondHistory,
      });
    executeAdminAccessMutation.mockResolvedValue(approvedResponse());
    await mount('directory');

    // When
    await approve();

    // Then: 두 번째 조회 결과(서버가 채운 감사 필드 포함)가 화면에 뜬다.
    expect(loadAdminAccessDetail).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('재조회된 사용자');
    expect(container.textContent).toContain('seed-auth-admin');
    expect(container.textContent).not.toContain('대기 중인 요청');
  });
});

describe('초기 404 — 결정과 무관한 not-found 경로는 그대로다', () => {
  it('처음부터 볼 수 없는 대상은 가입 신청 목록으로 돌아가는 안내를 그린다', async () => {
    // Given / When
    loadAdminAccessDetail.mockRejectedValue(
      new AdminAccessDetailNotFoundError(),
    );
    await mount('queue');

    // Then
    expect(container.textContent).toContain('사용자를 찾을 수 없습니다');
    expect(
      container.querySelector('a[href="/dashboard/applicants"]'),
    ).not.toBeNull();
  });
});
