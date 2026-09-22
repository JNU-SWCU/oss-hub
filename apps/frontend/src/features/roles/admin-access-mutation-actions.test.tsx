// @vitest-environment happy-dom

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

/**
 * PR04G 재설계 — 드롭다운 하나였던 "접근 변경"이 교직원 접근·관리자 접근·계정
 * 상태 세 묶음과, 대기 요청이 있을 때만 뜨는 별도 결정 카드로 갈라졌다. #1365가
 * 다시 묶음 안의 세그먼트 버튼 그룹(`role="radiogroup"`)을 걷어내고 「지금 값은
 * 글자, 버튼은 행동 하나」로 바꿨다 — 지금 값이 채운 `disabled` 버튼이던 옛 모양이
 * R-31 검출 신호였다. 클릭 상호작용은 `admin-access-overlay.test.tsx`와 같은
 * happy-dom + createRoot/act 패턴을 쓴다.
 */

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

describe('AdminAccessMutationActions — 독립 접근/계정 상태 세그먼트 컨트롤', () => {
  it('묶음마다 버튼은 하나뿐이고, 지금 값과 같은 쓰기 요청은 어느 버튼에서도 나가지 않는다', () => {
    const onRequestAction = vi.fn();
    act(() => {
      root.render(
        <AdminAccessMutationActions
          // 교직원 접근 있음 / 관리자 접근 없음 / 활성 — 세 묶음이 서로 다른 방향이다.
          detail={detail({
            hasStaffAccess: true,
            hasAdminAccess: false,
            accountStatus: 'ACTIVE',
          })}
          processingAction={null}
          onRequestAction={onRequestAction}
        />,
      );
    });

    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons).toHaveLength(3);
    for (const button of buttons) {
      expect(button.disabled).toBe(false);
      act(() => {
        button.dispatchEvent(
          new MouseEvent('click', { bubbles: true, cancelable: true }),
        );
      });
    }

    // 세 버튼 모두 지금 값의 반대로만 간다 — 지금 값을 다시 쓰는 명령은 화면에 없다.
    expect(onRequestAction.mock.calls.flat()).toEqual([
      'REVOKE_STAFF_ACCESS',
      'GRANT_ADMIN_ACCESS',
      'SET_STATUS_DEACTIVATED',
    ]);
  });

  it('지금 값은 글자로 읽히고, 카드에 채운 주 행동 색 버튼이 남지 않는다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessMutationActions
        detail={detail({
          hasStaffAccess: true,
          hasAdminAccess: false,
          accountStatus: 'ACTIVE',
        })}
        processingAction={null}
        onRequestAction={() => {}}
      />,
    );

    expect(html).toContain('허용됨');
    expect(html).toContain('없음');
    expect(html).toContain('활성');
    // R-31 검출 신호 — 상태 문자열을 담은 disabled 버튼이 없다.
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain('data-variant="default"');
  });

  it('버튼 이름은 묶음 이름과 행동이 띄어쓰기로 이어진다(낭독기·e2e 계약)', () => {
    act(() => {
      root.render(
        <AdminAccessMutationActions
          detail={detail({
            hasStaffAccess: true,
            hasAdminAccess: false,
            accountStatus: 'ACTIVE',
          })}
          processingAction={null}
          onRequestAction={() => {}}
        />,
      );
    });

    expect(
      Array.from(container.querySelectorAll('button')).map(
        (button) => button.textContent,
      ),
    ).toEqual(['교직원 접근 회수', '관리자 접근 허용', '계정 상태 비활성화']);
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

  it('프로필이 미완료면 authority grant를 막고 이유를 설명한다', () => {
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
    expect(html).not.toContain('canonical 관리 API');
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
