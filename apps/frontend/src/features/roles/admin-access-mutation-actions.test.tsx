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
 * PR04G 재설계 — "접근 변경"이 교직원 접근·관리자 접근·계정 상태 세 묶음과, 대기
 * 요청이 있을 때만 뜨는 별도 결정 카드로 갈라졌다. 묶음의 모양은 두 번 바뀌었다:
 * 세그먼트 버튼 그룹(`role="radiogroup"`)→「지금 값은 글자, 버튼은 행동 하나」
 * (#1365, 지금 값이 채운 `disabled` 버튼이던 옛 모양이 R-31 검출 신호였다)→
 * 지금 값이 선택된 드롭다운. 마지막 한 걸음이 되돌린 것은 R-31이 아니라 **후행
 * 상태의 보이지 않음**이다 — 버튼 하나는 지금 고를 수 있는 행동만 말하고, 그 값이
 * 애초에 몇 가지이며 고르면 어느 상태가 되는지는 말하지 않았다.
 *
 * 상호작용은 `admin-access-overlay.test.tsx`와 같은 happy-dom + createRoot/act
 * 패턴을 쓴다.
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

function control(id: string): HTMLSelectElement {
  const found = container.querySelector(`#${id}`);
  if (!(found instanceof HTMLSelectElement)) {
    throw new TypeError(`드롭다운을 찾지 못했습니다: ${id}`);
  }
  return found;
}

/** 목록에 선 값과, 그중 고를 수 없는 값. */
function optionsOf(id: string): readonly (readonly [string, boolean])[] {
  return Array.from(control(id).options).map(
    (option) => [option.textContent ?? '', option.disabled] as const,
  );
}

function choose(id: string, value: string) {
  const select = control(id);
  const setter = Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    'value',
  )?.set;
  act(() => {
    setter?.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

const STAFF = 'admin-staff-access-control';
const ADMIN = 'admin-admin-access-control';
const STATUS = 'admin-access-status-control';

describe('AdminAccessMutationActions — 독립 접근/계정 상태 드롭다운', () => {
  it('묶음마다 드롭다운 하나가 서고, 고른 값이 지금 값이다', () => {
    act(() => {
      root.render(
        <AdminAccessMutationActions
          // 교직원 접근 있음 / 관리자 접근 없음 / 활성 — 세 묶음이 서로 다른 값이다.
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

    expect(container.querySelectorAll('select')).toHaveLength(3);
    expect([
      control(STAFF).value,
      control(ADMIN).value,
      control(STATUS).value,
    ]).toEqual(['GRANTED', 'NONE', 'ACTIVE']);
  });

  /**
   * 이 화면을 드롭다운으로 바꾼 이유가 이 단언이다. 버튼 하나(「허용」)만 서 있으면
   * 그 값이 애초에 몇 가지인지, 누르면 어느 상태가 되는지가 문구에서만 유추된다.
   * 목록은 후행 상태를 **이름으로** 보여준다.
   */
  it('선택지는 그 값이 가질 수 있는 상태 전부다 — 후행 상태가 목록에 이름으로 선다', () => {
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

    expect(optionsOf(STAFF)).toEqual([
      ['없음', false],
      ['허용됨', false],
    ]);
    expect(optionsOf(ADMIN)).toEqual([
      ['없음', false],
      ['허용됨', false],
    ]);
    expect(optionsOf(STATUS)).toEqual([
      ['활성', false],
      ['비활성', false],
    ]);
  });

  it('다른 값을 고르면 그 값으로 가는 명령 하나가 나간다', () => {
    const onRequestAction = vi.fn();
    act(() => {
      root.render(
        <AdminAccessMutationActions
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

    choose(STAFF, 'NONE');
    choose(ADMIN, 'GRANTED');
    choose(STATUS, 'DEACTIVATED');

    expect(onRequestAction.mock.calls.flat()).toEqual([
      'REVOKE_STAFF_ACCESS',
      'GRANT_ADMIN_ACCESS',
      'SET_STATUS_DEACTIVATED',
    ]);
  });

  it('지금 값을 다시 골라도 쓰기 요청은 나가지 않는다', () => {
    const onRequestAction = vi.fn();
    act(() => {
      root.render(
        <AdminAccessMutationActions
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

    choose(STAFF, 'GRANTED');
    choose(ADMIN, 'NONE');
    choose(STATUS, 'ACTIVE');

    expect(onRequestAction).not.toHaveBeenCalled();
  });

  it('상태는 고르는 것이지 누르는 것이 아니다 — 이 카드에 버튼은 남지 않는다', () => {
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
    // R-31 검출 신호 — 상태 문자열을 담은 `disabled` 버튼이 애초에 생기지 않는다.
    expect(html).not.toContain('<button');
    expect(html).not.toContain('data-variant="default"');
  });

  it('드롭다운마다 제 이름표가 `htmlFor`로 묶여 읽힌다', () => {
    act(() => {
      root.render(
        <AdminAccessMutationActions
          detail={detail()}
          processingAction={null}
          onRequestAction={() => {}}
        />,
      );
    });

    expect(
      Array.from(container.querySelectorAll('label')).map((label) => [
        label.getAttribute('for'),
        label.textContent,
      ]),
    ).toEqual([
      [STAFF, '교직원 접근'],
      [ADMIN, '관리자 접근'],
      [STATUS, '계정 상태'],
    ]);
  });

  it('대기 중인 요청이 있으면 세 드롭다운이 모두 잠기고 안내문이 뜬다', () => {
    act(() => {
      root.render(
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
    });

    expect(container.textContent).toContain(
      '대기 중인 요청을 먼저 처리해 주세요.',
    );
    expect(
      Array.from(container.querySelectorAll('select')).map(
        (select) => select.disabled,
      ),
    ).toEqual([true, true, true]);
  });

  it('프로필이 미완료면 「허용됨」 선택지만 막고 이유를 한 번 설명한다', () => {
    act(() => {
      root.render(
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
    });

    expect(container.textContent).toContain(
      '프로필(이름·학번·학과) 완성 전에는 부여할 수 없습니다.',
    );
    // 교직원은 이미 「허용됨」이라 그 값이 지금 값이므로 막히지 않는다 —
    // 아직 받지 않은 관리자 접근의 「허용됨」 하나만 고를 수 없다.
    expect(optionsOf(STAFF)).toEqual([
      ['없음', false],
      ['허용됨', false],
    ]);
    expect(optionsOf(ADMIN)).toEqual([
      ['없음', false],
      ['허용됨', true],
    ]);
  });

  it('두 접근이 이미 허용됐으면 프로필 미완료여도 막힌 선택지도 이유 문장도 없다', () => {
    // 시드로 만든 첫 관리자 계정이 프로필을 채우기 전까지 정확히 이 상태다
    // (`apps/backend/src/auth/auth.repository.ts`가 profile 없는 계정에 권한을 켠다).
    act(() => {
      root.render(
        <AdminAccessMutationActions
          detail={detail({
            hasStaffAccess: true,
            hasAdminAccess: true,
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
    });

    expect(container.textContent).not.toContain('부여할 수 없습니다');
    expect(
      Array.from(container.querySelectorAll('option')).some(
        (option) => option.disabled,
      ),
    ).toBe(false);
  });

  it('본인 계정이면 「비활성」 선택지만 막히고 안내문이 뜬다', () => {
    act(() => {
      root.render(
        <AdminAccessMutationActions
          detail={detail({ isSelf: true, accountStatus: 'ACTIVE' })}
          processingAction={null}
          onRequestAction={() => {}}
        />,
      );
    });

    expect(container.textContent).toContain(
      '자기 계정은 비활성화할 수 없습니다.',
    );
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

    // ROL_017은 비활성화 방향에만 걸린다 — 「활성」으로 돌아가는 길은 열려 있다.
    expect(optionsOf(STATUS)).toEqual([
      ['활성', false],
      ['비활성', false],
    ]);
    expect(container.textContent).not.toContain(
      '자기 계정은 비활성화할 수 없습니다.',
    );
  });

  it('본인 계정의 관리자 접근 회수는 「없음」 선택지가 막히고 같은 묶음에 이유가 붙는다', () => {
    // #1382 — 성공하면 누른 사람이 이 화면을 읽을 권한을 잃어 결과를 확인할 수
    // 없다. 서버도 `ROL_022`로 거절한다.
    act(() => {
      root.render(
        <AdminAccessMutationActions
          detail={detail({ isSelf: true, hasAdminAccess: true })}
          processingAction={null}
          onRequestAction={() => {}}
        />,
      );
    });

    expect(optionsOf(ADMIN)).toEqual([
      ['없음', true],
      ['허용됨', false],
    ]);
    // 계정 상태 쪽 가드 문장과 같은 자리·같은 모양이다.
    const reason = control(ADMIN).parentElement?.querySelector(
      'p.text-sm.text-muted-foreground',
    );
    expect(reason?.textContent).toBe(
      '자기 계정의 관리자 접근은 회수할 수 없습니다.',
    );
  });

  it('남의 계정이면 관리자 접근 「없음」을 그대로 고를 수 있고 이유 문장도 없다', () => {
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
      ['없음', false],
      ['허용됨', false],
    ]);
    choose(ADMIN, 'NONE');
    expect(onRequestAction).toHaveBeenCalledWith('REVOKE_ADMIN_ACCESS');
    expect(container.textContent).not.toContain(
      '자기 계정의 관리자 접근은 회수할 수 없습니다.',
    );
  });

  it('본인 계정이어도 관리자 접근이 없으면 「허용됨」이 열려 있고 이유 문장도 없다', () => {
    act(() => {
      root.render(
        <AdminAccessMutationActions
          detail={detail({ isSelf: true, hasAdminAccess: false })}
          processingAction={null}
          onRequestAction={() => {}}
        />,
      );
    });

    // 회수 가드는 회수 방향에만 걸린다 — 계정 상태의 「활성」과 같은 규칙이다.
    expect(optionsOf(ADMIN)).toEqual([
      ['없음', false],
      ['허용됨', false],
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
    // #1381 — 비활성 계정에 [승인]을 보내면 서버가 반드시 거절한다(큐의 교직원
    // 승인자는 403 `ROL_004`, 관리자는 409 `ROL_014`). 누르기 전에 막는다.
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
