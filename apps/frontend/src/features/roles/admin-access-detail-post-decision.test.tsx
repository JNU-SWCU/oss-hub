import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const loadAdminAccessDetail = vi.hoisted(() => vi.fn());
const executeAdminAccessMutation = vi.hoisted(() => vi.fn());

vi.mock('./admin-access-detail-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./admin-access-detail-api')>()),
  loadAdminAccessDetail,
}));

vi.mock('./admin-access-mutation-execution', () => ({
  executeAdminAccessMutation,
}));

import { ApiError, type ProblemDetail } from '@/lib/api-client';
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

function chooseRoleOption(id: string, label: string): void {
  const trigger = container.querySelector(`#${id}`);
  if (
    !(trigger instanceof HTMLButtonElement) ||
    trigger.getAttribute('role') !== 'combobox'
  ) {
    throw new TypeError(`드롭다운을 찾지 못했습니다: ${id}`);
  }

  act(() => {
    trigger.dispatchEvent(
      new PointerEvent('pointerdown', {
        button: 0,
        bubbles: true,
        cancelable: true,
        pointerType: 'mouse',
      }),
    );
    trigger.dispatchEvent(
      new PointerEvent('pointerup', {
        button: 0,
        bubbles: true,
        cancelable: true,
        pointerType: 'mouse',
      }),
    );
    trigger.click();
  });

  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  const listboxId = trigger.getAttribute('aria-controls');
  const listbox = listboxId
    ? document.getElementById(listboxId)
    : document.querySelector<HTMLElement>(
        '[role="listbox"][data-state="open"]',
      );
  if (
    !listbox ||
    listbox.getAttribute('role') !== 'listbox' ||
    listbox.getAttribute('data-state') !== 'open'
  ) {
    throw new TypeError(`목록을 열지 못했습니다: ${id}`);
  }

  const option = Array.from(
    listbox.querySelectorAll<HTMLElement>('[role="option"]'),
  ).find((candidate) => candidate.textContent?.trim() === label);
  if (!option) {
    throw new TypeError(`선택지를 찾지 못했습니다: ${label}`);
  }

  act(() => {
    option.dispatchEvent(
      new PointerEvent('pointerdown', {
        button: 0,
        bubbles: true,
        cancelable: true,
        pointerType: 'mouse',
      }),
    );
    option.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        cancelable: true,
        pointerType: 'mouse',
        clientX: 100,
        clientY: 100,
      }),
    );
    option.dispatchEvent(
      new PointerEvent('pointerup', {
        button: 0,
        bubbles: true,
        cancelable: true,
        pointerType: 'mouse',
      }),
    );
    option.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        bubbles: true,
        cancelable: true,
      }),
    );
    option.click();
  });
}

async function approve(): Promise<void> {
  await act(async () => {
    clickButton(container, '승인');
    await flush();
  });
  await act(async () => {
    clickButton(document.body, '승인 확정');
    await flush();
  });
}

describe('가입 신청(queue) 결정 — 권위 있는 응답으로만 갱신한다', () => {
  it('승인하면 상세를 다시 읽지 않고 대기 카드가 사라지고 이력이 승인으로 바뀐다', async () => {
    loadAdminAccessDetail.mockResolvedValue({
      detail: PENDING_DETAIL,
      history: PENDING_HISTORY,
    });
    executeAdminAccessMutation.mockResolvedValue(approvedResponse());
    await mount('queue');
    expect(container.textContent).toContain('대기 중인 요청');

    await approve();

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
    loadAdminAccessDetail.mockResolvedValue({
      detail: PENDING_DETAIL,
      history: PENDING_HISTORY,
    });
    executeAdminAccessMutation.mockResolvedValue(rejectedResponse());
    await mount('queue');

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

    await approve();

    expect(loadAdminAccessDetail).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('재조회된 사용자');
    expect(container.textContent).toContain('seed-auth-admin');
    expect(container.textContent).not.toContain('대기 중인 요청');
  });
});

describe('회원 유형 — 낡은 화면에서 이미 변경된 값을 고르면', () => {
  it('확인한 입력을 보내고 성공을 말하지 않은 채 최신 상세를 다시 읽는다', async () => {
    const history = decidedHistory(
      'APPROVED',
      '2026-08-22T00:00:00.000Z',
      'seed-auth-admin',
    );
    const staleDetail = adminDetail({
      memberKind: 'STAFF',
      hasStaffAccess: true,
      pendingRequest: null,
      profile: {
        name: '홍길동',
        studentId: '202601',
        department: '인공지능학부',
        staffNumber: 'STAFF-1',
        isComplete: true,
      },
    });
    loadAdminAccessDetail
      .mockResolvedValueOnce({
        detail: staleDetail,
        history,
      })
      .mockResolvedValueOnce({
        detail: adminDetail({
          memberKind: 'STUDENT',
          hasStaffAccess: false,
          pendingRequest: null,
          profile: {
            name: '홍길동',
            studentId: '202601',
            department: '인공지능학부',
            staffNumber: null,
            isComplete: true,
          },
        }),
        history,
      });
    const conflict: ProblemDetail & { readonly currentAccess: unknown } = {
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
      detail: '접근 상태가 변경되었습니다.',
      instance: '/users/target/member-kind',
      code: 'ROL_013',
      currentAccess: {
        id: 'target',
        role: 'STUDENT',
        accountStatus: 'ACTIVE',
        pendingRequest: null,
      },
    };
    executeAdminAccessMutation.mockRejectedValue(new ApiError(conflict));
    await mount('directory');

    chooseRoleOption('admin-member-kind-control', '학생');
    expect(document.querySelector('#admin-member-kind-student-id')).toBeNull();
    expect(document.querySelector('#admin-member-kind-department')).toBeNull();
    await act(async () => {
      const dialog = document.querySelector('[role="dialog"]');
      if (!(dialog instanceof HTMLElement)) {
        throw new TypeError('회원 유형 확인 다이얼로그를 찾지 못했습니다.');
      }
      const buttons = Array.from(dialog.querySelectorAll('button'));
      const confirmButton = buttons.at(-1);
      if (!(confirmButton instanceof HTMLButtonElement)) {
        throw new TypeError('회원 유형 확정 버튼을 찾지 못했습니다.');
      }
      confirmButton.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
      await flush();
    });

    expect(executeAdminAccessMutation).toHaveBeenCalledTimes(1);
    expect(executeAdminAccessMutation).toHaveBeenCalledWith(
      'target',
      'SET_MEMBER_STUDENT',
      staleDetail,
      '',
      { department: '인공지능학부' },
    );
    expect(loadAdminAccessDetail).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain(
      '다른 처리자가 먼저 변경했습니다',
    );
    expect(document.body.textContent).not.toContain('처리를 완료했습니다');
    const refreshed = container.querySelector('#admin-member-kind-control');
    expect(refreshed).toBeInstanceOf(HTMLButtonElement);
    expect(refreshed?.getAttribute('role')).toBe('combobox');
    expect(refreshed?.textContent).toContain('학생');
  });
});

describe('초기 404 — 결정과 무관한 not-found 경로는 그대로다', () => {
  it('처음부터 볼 수 없는 대상은 가입 신청 목록으로 돌아가는 안내를 그린다', async () => {
    loadAdminAccessDetail.mockRejectedValue(
      new AdminAccessDetailNotFoundError(),
    );
    await mount('queue');

    expect(container.textContent).toContain('가입 신청을 찾을 수 없습니다');
    expect(
      container.querySelector('a[href="/dashboard/applicants"]'),
    ).not.toBeNull();
  });
});
