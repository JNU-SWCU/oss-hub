// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

import type { AdminAccessDetail } from './admin-access-api';
import {
  AdminAccessMutationActions,
  AdminAccessPendingRequestCard,
} from './components/admin-access-mutation-actions';

/**
 * PR04G 재설계 — 드롭다운 하나였던 "접근 변경"이 역할/계정 상태 각각의
 * 세그먼트 버튼 그룹(`role="radiogroup"`)과, 대기 요청이 있을 때만 뜨는
 * 별도 결정 카드로 갈라졌다. 옛 `TWO_STEP_ADMIN_PROMOTION_HINT` 관련 테스트는
 * 그 힌트 자체가 삭제되어 전부 걷어낸다. 클릭 상호작용은
 * `admin-access-overlay.test.tsx`와 같은 happy-dom + createRoot/act 패턴을 쓴다.
 */

function detail(overrides: Partial<AdminAccessDetail> = {}): AdminAccessDetail {
  return {
    id: 'target',
    githubLogin: 'octocat',
    name: '합성 사용자',
    role: 'STAFF',
    accountStatus: 'ACTIVE',
    isSelf: false,
    isProfileComplete: true,
    pendingRequest: null,
    lastLoginAt: null,
    profile: {
      name: '합성 사용자',
      studentId: '202601',
      department: '인공지능학부',
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

describe('AdminAccessMutationActions — 역할/계정 상태 세그먼트 컨트롤', () => {
  it('역할 라디오그룹이 STUDENT/STAFF/ADMIN 세 버튼을 렌더링하고 현재 값에 "(현재)"를 붙인다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessMutationActions
        detail={detail({ role: 'STAFF' })}
        processingAction={null}
        onRequestAction={() => {}}
      />,
    );

    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('학생');
    expect(html).toContain('교직원');
    expect(html).toContain('관리자');
    expect(html).toContain('(현재)');
  });

  it('현재 역할·상태 버튼은 aria-checked="true"이고 나머지는 false다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessMutationActions
        detail={detail({ role: 'STUDENT' })}
        processingAction={null}
        onRequestAction={() => {}}
      />,
    );

    const trueCount = html.match(/aria-checked="true"/g)?.length ?? 0;
    // 역할 라디오그룹 + 계정 상태 라디오그룹 각각 현재 값 하나씩, 총 2개.
    expect(trueCount).toBe(2);
  });

  it('다른 역할 버튼을 클릭하면 onRequestAction이 해당 SET_ROLE_* 액션으로 호출된다', () => {
    const onRequestAction = vi.fn();
    act(() => {
      root.render(
        <AdminAccessMutationActions
          detail={detail({ role: 'STUDENT' })}
          processingAction={null}
          onRequestAction={onRequestAction}
        />,
      );
    });

    const adminButton = Array.from(
      container.querySelectorAll('button[role="radio"]'),
    ).find((button) => button.textContent?.includes('관리자'));
    expect(adminButton).toBeDefined();
    act(() => {
      adminButton?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });

    expect(onRequestAction).toHaveBeenCalledWith('SET_ROLE_ADMIN');
  });

  it('계정 상태 버튼을 클릭하면 onRequestAction이 SET_STATUS_* 액션으로 호출된다', () => {
    const onRequestAction = vi.fn();
    act(() => {
      root.render(
        <AdminAccessMutationActions
          detail={detail({ accountStatus: 'ACTIVE' })}
          processingAction={null}
          onRequestAction={onRequestAction}
        />,
      );
    });

    const deactivateButton = Array.from(
      container.querySelectorAll('button[role="radio"]'),
    ).find((button) => button.textContent?.includes('비활성'));
    expect(deactivateButton).toBeDefined();
    act(() => {
      deactivateButton?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });

    expect(onRequestAction).toHaveBeenCalledWith('SET_STATUS_DEACTIVATED');
  });

  it('현재 값 버튼은 클릭해도 onRequestAction이 호출되지 않는다(disabled)', () => {
    const onRequestAction = vi.fn();
    act(() => {
      root.render(
        <AdminAccessMutationActions
          detail={detail({ role: 'STAFF' })}
          processingAction={null}
          onRequestAction={onRequestAction}
        />,
      );
    });

    const currentButton = Array.from(
      container.querySelectorAll('button[role="radio"][aria-checked="true"]'),
    )[0] as HTMLButtonElement;
    expect(currentButton.disabled).toBe(true);
    act(() => {
      currentButton.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });

    expect(onRequestAction).not.toHaveBeenCalled();
  });

  it('대기 중인 요청이 있으면 전체 컨트롤이 비활성화되고 안내문이 뜬다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessMutationActions
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

    expect(html).toContain('대기 중인 요청을 먼저 처리해 주세요.');
    const buttonCount = html.match(/<button/g)?.length ?? 0;
    const disabledCount = html.match(/disabled=""/g)?.length ?? 0;
    expect(disabledCount).toBe(buttonCount);
  });

  it('프로필이 미완료면 교직원·관리자 버튼만 막히고 안내문이 뜬다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessMutationActions
        detail={detail({
          role: 'STUDENT',
          profile: {
            name: null,
            studentId: null,
            department: null,
            isComplete: false,
          },
        })}
        processingAction={null}
        onRequestAction={() => {}}
      />,
    );

    expect(html).toContain(
      '프로필(이름·학번·학과) 완성 전에는 부여할 수 없습니다.',
    );
  });

  it('본인 계정이면 비활성화 버튼만 막히고 안내문이 뜬다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessMutationActions
        detail={detail({ isSelf: true, accountStatus: 'ACTIVE' })}
        processingAction={null}
        onRequestAction={() => {}}
      />,
    );

    expect(html).toContain('자기 계정은 비활성화할 수 없습니다.');
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

    const approveButton = Array.from(
      container.querySelectorAll('button'),
    ).find((button) => button.textContent === '승인');
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
