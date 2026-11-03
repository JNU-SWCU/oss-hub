import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

import type { CanonicalAdminAccessDetail } from './independent-authority-api';
import {
  AdminAccessMutationActions,
  AdminAccessPendingRequestCard,
} from './components/admin-access-mutation-actions';

function detail(
  overrides: Partial<CanonicalAdminAccessDetail> = {},
): CanonicalAdminAccessDetail {
  return {
    id: 'target',
    githubLogin: 'octocat',
    name: '합성 사용자',
    role: 'STAFF',
    memberKind: 'STAFF',
    hasStaffAccess: true,
    hasAdminAccess: false,
    approvalStatus: 'APPROVED',
    approvalRequestId: null,
    accountStatus: 'ACTIVE',
    isSelf: false,
    isProfileComplete: true,
    createdAt: '2026-07-29T00:00:00.000Z',
    pendingRequest: null,
    lastLoginAt: null,
    profile: {
      name: '합성 사용자',
      studentId: '202601',
      department: '인공지능학부',
      staffNumber: null,
      isComplete: true,
    },
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function control(id: string): HTMLButtonElement {
  const found = container.querySelector(`#${id}`);
  if (
    !(found instanceof HTMLButtonElement) ||
    found.getAttribute('role') !== 'combobox'
  ) {
    throw new TypeError(`드롭다운을 찾지 못했습니다: ${id}`);
  }
  return found;
}

function openControl(
  id: string,
  method: 'pointer' | 'keyboard' = 'pointer',
): HTMLElement {
  const trigger = control(id);
  act(() => {
    if (method === 'keyboard') {
      trigger.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          bubbles: true,
          cancelable: true,
        }),
      );
    } else {
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
    }
  });

  const listboxId = trigger.getAttribute('aria-controls');
  const listbox = listboxId
    ? document.getElementById(listboxId)
    : document.querySelector<HTMLElement>(
        '[role="listbox"][data-state="open"]',
      );
  if (!listbox) {
    throw new TypeError(`목록을 열지 못했습니다: ${id}`);
  }
  if (listbox.getAttribute('data-state') !== 'open') {
    throw new TypeError(`목록을 열지 못했습니다: ${id}`);
  }
  return listbox;
}

function optionsOf(id: string): readonly (readonly [string, boolean])[] {
  return Array.from(openControl(id).querySelectorAll('[role="option"]')).map(
    (option) =>
      [
        option.textContent?.trim() ?? '',
        option.getAttribute('aria-disabled') === 'true' ||
          option.hasAttribute('data-disabled'),
      ] as const,
  );
}

function choose(id: string, value: string) {
  const listbox = openControl(id);
  const labels: Record<string, string> = {
    UNCONFIRMED: '미지정',
    STUDENT: '학생',
    STAFF: '교직원',
    NONE: '비허용',
    GRANTED: '허용',
    ACTIVE: '활성',
    DEACTIVATED: '비활성',
  };
  const option = Array.from(
    listbox.querySelectorAll<HTMLElement>('[role="option"]'),
  ).find((candidate) => candidate.textContent?.trim() === labels[value]);
  if (!option) {
    throw new TypeError(`선택지를 찾지 못했습니다: ${id}=${value}`);
  }
  act(() => {
    option.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

const ADMIN = 'admin-admin-access-control';
const STATUS = 'admin-access-status-control';

describe('AdminAccessMutationActions — 관리자 접근과 계정 상태', () => {
  it('본인 계정의 비활성화 안내는 트리거에 포커스할 때만 뜬다', () => {
    act(() => {
      root.render(
        <AdminAccessMutationActions
          detail={detail({ isSelf: true, accountStatus: 'ACTIVE' })}
          processingAction={null}
          onRequestAction={() => {}}
        />,
      );
    });

    expect(container.textContent).not.toContain(
      '자기 계정은 비활성화할 수 없습니다.',
    );
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    act(() => control(STATUS).focus());
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
      '자기 계정은 비활성화할 수 없습니다.',
    );
    act(() => control(STATUS).blur());
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    expect(optionsOf(STATUS)).toEqual([
      ['활성', false],
      ['비활성', true],
    ]);
  });

  it('본인 계정이어도 이미 비활성이면 그 값이 지금 값이라 가드 문장이 뜨지 않는다', () => {
    act(() => {
      root.render(
        <AdminAccessMutationActions
          detail={detail({ isSelf: true, accountStatus: 'DEACTIVATED' })}
          processingAction={null}
          onRequestAction={() => {}}
        />,
      );
    });

    expect(optionsOf(STATUS)).toEqual([
      ['활성', false],
      ['비활성', false],
    ]);
    expect(container.textContent).not.toContain(
      '자기 계정은 비활성화할 수 없습니다.',
    );
  });

  it('본인 관리자 접근은 비허용을 막고 포커스 툴팁으로 이유를 알린다', () => {
    act(() => {
      root.render(
        <AdminAccessMutationActions
          detail={detail({ isSelf: true, hasAdminAccess: true })}
          processingAction={null}
          onRequestAction={() => {}}
        />,
      );
    });

    expect(container.textContent).not.toContain(
      '자기 계정의 관리자 접근은 회수할 수 없습니다.',
    );
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    act(() => control(ADMIN).focus());
    const reason = document.querySelector('[role="tooltip"]');
    expect(reason?.textContent).toContain(
      '자기 계정의 관리자 접근은 회수할 수 없습니다.',
    );
    expect(control(ADMIN).getAttribute('aria-describedby')).toBe(reason?.id);
    act(() => control(ADMIN).blur());
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    expect(optionsOf(ADMIN)).toEqual([
      ['비허용', true],
      ['허용', false],
    ]);
  });

  it('남의 계정이면 관리자 접근 「비허용」을 그대로 고를 수 있고 이유 문장도 없다', () => {
    const onRequestAction = vi.fn();
    act(() => {
      root.render(
        <AdminAccessMutationActions
          detail={detail({ isSelf: false, hasAdminAccess: true })}
          processingAction={null}
          onRequestAction={onRequestAction}
        />,
      );
    });

    expect(optionsOf(ADMIN)).toEqual([
      ['비허용', false],
      ['허용', false],
    ]);
    choose(ADMIN, 'NONE');
    expect(onRequestAction).toHaveBeenCalledWith('REVOKE_ADMIN_ACCESS');
    expect(container.textContent).not.toContain(
      '자기 계정의 관리자 접근은 회수할 수 없습니다.',
    );
  });

  it('본인 계정이어도 관리자 접근이 없으면 「허용」이 열려 있고 이유 문장도 없다', () => {
    act(() => {
      root.render(
        <AdminAccessMutationActions
          detail={detail({ isSelf: true, hasAdminAccess: false })}
          processingAction={null}
          onRequestAction={() => {}}
        />,
      );
    });

    expect(optionsOf(ADMIN)).toEqual([
      ['비허용', false],
      ['허용', false],
    ]);
    expect(container.textContent).not.toContain(
      '자기 계정의 관리자 접근은 회수할 수 없습니다.',
    );
  });

  it('막힌 컨트롤이 없을 때는 대기 요청 안내문을 보여주지 않는다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessMutationActions
        detail={detail()}
        processingAction={null}
        onRequestAction={() => {}}
      />,
    );

    expect(html).not.toContain('대기 중인 요청을 먼저 처리해 주세요.');
  });
});

describe('AdminAccessPendingRequestCard — 대기 요청 결정 카드', () => {
  it('대기 중인 요청이 없으면 아무것도 렌더링하지 않는다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessPendingRequestCard
        detail={detail({ pendingRequest: null })}
        processingAction={null}
        onRequestAction={() => {}}
      />,
    );

    expect(html).toBe('');
  });

  it('대기 중인 요청이 있으면 신청 시각과 승인/반려 버튼을 렌더링한다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessPendingRequestCard
        detail={detail({
          pendingRequest: {
            id: 'req-1',
            status: 'PENDING',
            createdAt: '2026-07-30T00:00:00.000Z',
          },
        })}
        processingAction={null}
        onRequestAction={() => {}}
      />,
    );

    expect(html).toContain('대기 중인 요청');
    expect(html).toContain('신청됨');
    expect(html).toContain('승인');
    expect(html).toContain('반려');
  });

  it('승인 버튼 클릭은 onRequestAction을 APPROVE로 호출한다', () => {
    const onRequestAction = vi.fn();
    act(() => {
      root.render(
        <AdminAccessPendingRequestCard
          detail={detail({
            pendingRequest: {
              id: 'req-1',
              status: 'PENDING',
              createdAt: '2026-07-30T00:00:00.000Z',
            },
          })}
          processingAction={null}
          onRequestAction={onRequestAction}
        />,
      );
    });

    const approveButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '승인',
    );
    expect(approveButton).toBeDefined();
    act(() => {
      approveButton?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });

    expect(onRequestAction).toHaveBeenCalledWith('APPROVE');
  });

  it('반려 버튼 클릭은 onRequestAction을 REJECT로 호출한다', () => {
    const onRequestAction = vi.fn();
    act(() => {
      root.render(
        <AdminAccessPendingRequestCard
          detail={detail({
            pendingRequest: {
              id: 'req-1',
              status: 'PENDING',
              createdAt: '2026-07-30T00:00:00.000Z',
            },
          })}
          processingAction={null}
          onRequestAction={onRequestAction}
        />,
      );
    });

    const rejectButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '반려',
    );
    expect(rejectButton).toBeDefined();
    act(() => {
      rejectButton?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });

    expect(onRequestAction).toHaveBeenCalledWith('REJECT');
  });

  it('비활성 계정이면 [승인]만 꺼지고 왜 막혔는지와 다음 걸음이 뜬다', () => {
    act(() => {
      root.render(
        <AdminAccessPendingRequestCard
          detail={detail({
            role: 'STUDENT',
            memberKind: 'STUDENT',
            hasStaffAccess: false,
            accountStatus: 'DEACTIVATED',
            pendingRequest: {
              id: 'req-1',
              status: 'PENDING',
              createdAt: '2026-07-30T00:00:00.000Z',
            },
          })}
          processingAction={null}
          onRequestAction={() => {}}
        />,
      );
    });

    expect(
      Array.from(container.querySelectorAll('button')).map((button) => [
        button.textContent,
        button.disabled,
      ]),
    ).toEqual([
      ['승인', true],
      ['반려', false],
    ]);
    expect(container.textContent).toContain(
      '비활성 계정은 승인할 수 없습니다. 계정이 다시 활성화된 뒤에 처리할 수 있습니다.',
    );
  });

  it('비활성 계정에서도 [반려]는 눌려 REJECT를 그대로 보낸다', () => {
    const onRequestAction = vi.fn();
    act(() => {
      root.render(
        <AdminAccessPendingRequestCard
          detail={detail({
            role: 'STUDENT',
            memberKind: 'STUDENT',
            hasStaffAccess: false,
            accountStatus: 'DEACTIVATED',
            pendingRequest: {
              id: 'req-1',
              status: 'PENDING',
              createdAt: '2026-07-30T00:00:00.000Z',
            },
          })}
          processingAction={null}
          onRequestAction={onRequestAction}
        />,
      );
    });

    for (const button of Array.from(container.querySelectorAll('button'))) {
      act(() => {
        button.dispatchEvent(
          new MouseEvent('click', { bubbles: true, cancelable: true }),
        );
      });
    }

    expect(onRequestAction.mock.calls.flat()).toEqual(['REJECT']);
  });

  it('활성 계정이면 [승인]은 그대로 눌리고 가드 문장도 뜨지 않는다', () => {
    act(() => {
      root.render(
        <AdminAccessPendingRequestCard
          detail={detail({
            role: 'STUDENT',
            memberKind: 'STUDENT',
            hasStaffAccess: false,
            accountStatus: 'ACTIVE',
            pendingRequest: {
              id: 'req-1',
              status: 'PENDING',
              createdAt: '2026-07-30T00:00:00.000Z',
            },
          })}
          processingAction={null}
          onRequestAction={() => {}}
        />,
      );
    });

    expect(
      Array.from(container.querySelectorAll('button')).map(
        (button) => button.disabled,
      ),
    ).toEqual([false, false]);
    expect(container.textContent).not.toContain('비활성 계정은 승인할 수');
  });

  it('처리 중(processingAction이 있음)이면 승인/반려 버튼이 모두 비활성화된다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessPendingRequestCard
        detail={detail({
          pendingRequest: {
            id: 'req-1',
            status: 'PENDING',
            createdAt: '2026-07-30T00:00:00.000Z',
          },
        })}
        processingAction="APPROVE"
        onRequestAction={() => {}}
      />,
    );

    const disabledCount = html.match(/disabled=""/g)?.length ?? 0;
    expect(disabledCount).toBe(2);
  });
});
