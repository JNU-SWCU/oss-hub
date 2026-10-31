import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

import { deriveAdminAccessGuards } from '../admin-access-detail-api';
import type { AdminAccessDirectoryItem } from '../independent-authority-api';
import {
  AccountStatusAccessControl,
  AdminAccessStateControl,
  MemberKindAccessControl,
} from './admin-access-controls';

const PENDING_REQUEST = {
  id: 'req-1',
  status: 'PENDING',
  createdAt: '2026-07-30T00:00:00.000Z',
} as const;

function item(
  overrides: Partial<AdminAccessDirectoryItem> = {},
): AdminAccessDirectoryItem {
  return {
    id: 'row-1',
    githubLogin: 'octocat',
    name: '합성 사용자',
    role: 'STUDENT',
    memberKind: 'STUDENT',
    hasStaffAccess: false,
    hasAdminAccess: false,
    accountStatus: 'ACTIVE',
    isSelf: false,
    isProfileComplete: true,
    createdAt: '2026-07-29T00:00:00.000Z',
    pendingRequest: null,
    lastLoginAt: null,
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

function renderAll(
  target: AdminAccessDirectoryItem,
  layout: 'field' | 'cell' | 'stacked',
  onRequestAction = vi.fn(),
  disabled = false,
) {
  const common = {
    target,
    disabled,
    onRequestAction,
    layout,
    idPrefix: 'row-1',
  } as const;
  act(() => {
    root.render(
      <div>
        <MemberKindAccessControl {...common} />
        <AdminAccessStateControl {...common} />
        <AccountStatusAccessControl {...common} />
      </div>,
    );
  });
  return onRequestAction;
}

function trigger(name: string): HTMLButtonElement {
  const found = container.querySelector(`[aria-label="${name}"]`);
  if (!(found instanceof HTMLButtonElement)) {
    throw new TypeError(`접근성 이름으로 컨트롤을 찾지 못했습니다: ${name}`);
  }
  return found;
}

function open(element: HTMLButtonElement): HTMLElement {
  act(() => {
    element.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  const listbox = document.getElementById(
    element.getAttribute('aria-controls') ?? '',
  );
  if (!listbox) throw new TypeError('목록을 열지 못했습니다.');
  return listbox;
}

function option(listbox: HTMLElement, label: string): HTMLElement {
  const found = Array.from(
    listbox.querySelectorAll<HTMLElement>('[role="option"]'),
  ).find((candidate) => candidate.textContent?.trim() === label);
  if (!found) throw new TypeError(`선택지를 찾지 못했습니다: ${label}`);
  return found;
}

function isDisabled(element: HTMLElement): boolean {
  return (
    element.getAttribute('aria-disabled') === 'true' ||
    element.hasAttribute('data-disabled')
  );
}

function memberKindTrigger(layout: 'cell' | 'stacked'): HTMLButtonElement {
  return layout === 'cell'
    ? trigger('합성 사용자 회원 유형')
    : (container.querySelector(
        '#row-1-member-kind-control',
      ) as HTMLButtonElement);
}

function blockedReasonTooltip(element: HTMLElement): string | null {
  const wrapper = element.closest<HTMLElement>('[data-slot="tooltip-trigger"]');
  if (!wrapper) return null;
  act(() => wrapper.focus());
  return document.querySelector('[role="tooltip"]')?.textContent ?? null;
}

function fieldMemberKindReason(target: AdminAccessDirectoryItem): string {
  act(() => {
    root.render(
      <MemberKindAccessControl
        target={target}
        disabled={false}
        onRequestAction={vi.fn()}
        layout="field"
        idPrefix="row-1"
      />,
    );
  });
  const paragraph = container.querySelector('p')?.textContent;
  if (!paragraph) throw new TypeError('field 레이아웃에 막힘 사유 문단이 없습니다.');
  return paragraph;
}

function expectMemberKindReasonTooltips(layout: 'cell' | 'stacked') {
  const pending = item({ pendingRequest: PENDING_REQUEST });
  renderAll(pending, layout);
  expect(memberKindTrigger(layout).disabled).toBe(true);
  expect(blockedReasonTooltip(memberKindTrigger(layout))).toBe(
    deriveAdminAccessGuards(pending).controlBlockedReason,
  );

  const incomplete = item({ isProfileComplete: false });
  const fieldReason = fieldMemberKindReason(incomplete);
  renderAll(incomplete, layout);
  expect(blockedReasonTooltip(memberKindTrigger(layout))).toBe(fieldReason);

  renderAll(item({ memberKind: null }), layout);
  expect(memberKindTrigger(layout).disabled).toBe(true);
  expect(
    memberKindTrigger(layout).closest('[data-slot="tooltip-trigger"]'),
  ).toBeNull();
}

describe('cell 레이아웃', () => {
  it('보이는 라벨 없이 표시이름이 들어간 접근성 이름을 쓰고 h-9 w-28이다', () => {
    renderAll(item(), 'cell');

    expect(container.querySelectorAll('label')).toHaveLength(0);
    for (const name of [
      '합성 사용자 회원 유형',
      '합성 사용자 관리자 접근',
      '합성 사용자 계정 상태',
    ]) {
      const element = trigger(name);
      expect(element.getAttribute('role')).toBe('combobox');
      expect(element.className).toContain('h-9');
      expect(element.className).toContain('w-28');
    }
  });

  it('이름이 없으면 GitHub 로그인을 표시이름으로 쓴다', () => {
    renderAll(item({ name: null }), 'cell');

    expect(trigger('octocat 회원 유형')).toBeInstanceOf(HTMLButtonElement);
  });

  it('학생 행이 교직원을 고르면 SET_MEMBER_STAFF를 요청한다', () => {
    const onRequestAction = renderAll(item(), 'cell');

    const listbox = open(trigger('합성 사용자 회원 유형'));
    act(() => {
      option(listbox, '교직원').dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(onRequestAction.mock.calls).toEqual([
      ['SET_MEMBER_STAFF', trigger('합성 사용자 회원 유형')],
    ]);
  });

  it('프로필 미완료 행은 허용 항목이 비활성이고 툴팁이 같은 사유를 보인다', () => {
    renderAll(item({ isProfileComplete: false }), 'cell');
    const reason = '프로필(이름·학번·학과) 완성 전에는 부여할 수 없습니다.';

    const adminTrigger = trigger('합성 사용자 관리자 접근');
    act(() => adminTrigger.focus());
    expect(document.body.textContent).toContain(reason);

    const listbox = open(adminTrigger);
    expect(isDisabled(option(listbox, '허용'))).toBe(true);
    expect(isDisabled(option(listbox, '비허용'))).toBe(false);
  });

  it('isSelf 행은 비활성화와 관리자 회수 항목이 비활성이다', () => {
    renderAll(item({ isSelf: true, hasAdminAccess: true }), 'cell');

    expect(
      isDisabled(option(open(trigger('합성 사용자 관리자 접근')), '비허용')),
    ).toBe(true);
    expect(
      isDisabled(option(open(trigger('합성 사용자 계정 상태')), '비활성')),
    ).toBe(true);
  });

  it('대기 요청과 프로필 미완료 행의 회원 유형 사유는 툴팁으로 읽을 수 있고 memberKind null은 설명이 없다', () => {
    expectMemberKindReasonTooltips('cell');
  });

  it('대기 요청, 프로필 미완료, memberKind null이면 회원 유형이 비활성이다', () => {
    const cases: Partial<AdminAccessDirectoryItem>[] = [
      { pendingRequest: PENDING_REQUEST },
      { isProfileComplete: false },
      { memberKind: null },
    ];
    for (const overrides of cases) {
      renderAll(item(overrides), 'cell');
      expect(trigger('합성 사용자 회원 유형').disabled).toBe(true);
    }
    renderAll(item(), 'cell');
    expect(trigger('합성 사용자 회원 유형').disabled).toBe(false);
  });

  it('disabled prop이면 세 컨트롤이 모두 잠긴다', () => {
    renderAll(item(), 'cell', vi.fn(), true);

    for (const name of [
      '합성 사용자 회원 유형',
      '합성 사용자 관리자 접근',
      '합성 사용자 계정 상태',
    ]) {
      expect(trigger(name).disabled).toBe(true);
    }
  });
});

describe('stacked 레이아웃', () => {
  it('보이는 라벨이 htmlFor로 묶이고 h-11이다', () => {
    renderAll(item(), 'stacked');

    expect(
      Array.from(container.querySelectorAll('label')).map((label) => [
        label.getAttribute('for'),
        label.textContent,
      ]),
    ).toEqual([
      ['row-1-member-kind-control', '회원 유형'],
      ['row-1-admin-access-control', '관리자 접근'],
      ['row-1-access-status-control', '계정 상태'],
    ]);
    expect(
      container.querySelector('#row-1-member-kind-control')?.className,
    ).toContain('h-11');
  });

  it('대기 요청과 프로필 미완료 행의 회원 유형 사유는 툴팁으로 읽을 수 있고 memberKind null은 설명이 없다', () => {
    expectMemberKindReasonTooltips('stacked');
    expect(container.querySelectorAll('p')).toHaveLength(0);
  });

  it('프로필 미완료 행의 허용 항목 사유는 툴팁으로만 전달된다', () => {
    renderAll(item({ isProfileComplete: false }), 'stacked');

    expect(container.querySelectorAll('p')).toHaveLength(0);
    expect(
      isDisabled(
        option(
          open(
            container.querySelector(
              '#row-1-admin-access-control',
            ) as HTMLButtonElement,
          ),
          '허용',
        ),
      ),
    ).toBe(true);
  });
});
