// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TeamInvitePanel,
  type TeamInvitePanelProps,
} from './team-invite-panel';
import type { InvitationCandidate } from './team-invitation-api';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const candidates: InvitationCandidate[] = [
  { id: 'user-1', nickname: 'octo1', name: '검색결과1', avatarUrl: null },
  { id: 'user-2', nickname: 'octo2', name: null, avatarUrl: null },
];

const noOp = () => undefined;

const baseProps: TeamInvitePanelProps = {
  query: 'oc',
  candidates,
  searching: false,
  searchError: null,
  sentInvitations: [],
  invitationCandidateNames: {},
  invitingUserId: null,
  cancelingInvitationId: null,
  actionError: null,
  onQueryChange: noOp,
  onSearch: noOp,
  onInvite: noOp,
  onCancel: noOp,
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderPanel(overrides: Partial<TeamInvitePanelProps> = {}): void {
  act(() => {
    root.render(<TeamInvitePanel {...baseProps} {...overrides} />);
  });
}

function getInput(): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('#invite-search');
  if (!input) throw new Error('검색 입력을 찾지 못했다.');
  return input;
}

/** 실제 키 입력처럼 cancelable keydown을 흘려보내고, 핸들러가 막았는지 함께 돌려준다. */
function pressKey(target: Element, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

describe('TeamInvitePanel — combobox 접근성 속성', () => {
  it('입력에 combobox 역할과 결과 목록 연결을 부여한다', () => {
    renderPanel();
    const input = getInput();

    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-autocomplete')).toBe('list');
    expect(input.getAttribute('aria-expanded')).toBe('true');

    const listbox = container.querySelector('[role="listbox"]');
    expect(listbox).not.toBeNull();
    expect(input.getAttribute('aria-controls')).toBe(
      listbox?.getAttribute('id'),
    );

    const options = container.querySelectorAll('[role="option"]');
    expect(options).toHaveLength(2);
    expect(options[0]?.getAttribute('aria-selected')).toBe('false');
    expect(options[1]?.getAttribute('aria-selected')).toBe('false');
  });

  it('검색 중이면 목록에 로딩 상태를 보여준다', () => {
    renderPanel({ candidates: [], searching: true });
    const listbox = container.querySelector('[role="listbox"]');
    expect(listbox?.textContent).toContain('검색 중…');
  });

  it('2자 이상인데 결과가 없으면 결과 없음 상태를 보여준다', () => {
    renderPanel({ candidates: [], query: 'zz' });
    const listbox = container.querySelector('[role="listbox"]');
    expect(listbox?.textContent).toContain('검색 결과가 없습니다');
  });

  it('2자 미만이면 목록에 결과 대신 최소 글자 수 힌트를 보여준다(옵션은 없음)', () => {
    renderPanel({ candidates: [], query: 'o' });
    const input = getInput();
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(0);
    expect(container.querySelector('[role="listbox"]')?.textContent).toContain(
      '이상 입력하면',
    );
  });

  it('빈 입력이면 목록을 아예 확장하지 않는다', () => {
    renderPanel({ candidates: [], query: '' });
    const input = getInput();
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });

  it('검색 실패 시 목록을 확장하지 않는다 — 실패는 별도 alert가 표면화한다', () => {
    renderPanel({ candidates: [], searchError: '검색하지 못했습니다.' });
    const input = getInput();
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      '검색하지 못했습니다.',
    );
  });
});

describe('TeamInvitePanel — 키보드 내비게이션', () => {
  it('ArrowDown은 첫 옵션을 강조하고 aria-activedescendant를 그 옵션으로 옮긴다', () => {
    renderPanel();
    const input = getInput();
    const event = pressKey(input, 'ArrowDown');

    const firstOption = container.querySelectorAll('[role="option"]')[0];
    expect(event.defaultPrevented).toBe(true);
    expect(firstOption?.getAttribute('aria-selected')).toBe('true');
    expect(input.getAttribute('aria-activedescendant')).toBe(
      firstOption?.getAttribute('id'),
    );
  });

  it('ArrowDown을 반복하면 다음 옵션으로 넘어간다', () => {
    renderPanel();
    const input = getInput();
    pressKey(input, 'ArrowDown');
    pressKey(input, 'ArrowDown');

    const options = container.querySelectorAll('[role="option"]');
    expect(options[0]?.getAttribute('aria-selected')).toBe('false');
    expect(options[1]?.getAttribute('aria-selected')).toBe('true');
  });

  it('ArrowUp은 이전 옵션으로 되돌아간다', () => {
    renderPanel();
    const input = getInput();
    pressKey(input, 'ArrowDown');
    pressKey(input, 'ArrowDown');
    pressKey(input, 'ArrowUp');

    const options = container.querySelectorAll('[role="option"]');
    expect(options[0]?.getAttribute('aria-selected')).toBe('true');
    expect(options[1]?.getAttribute('aria-selected')).toBe('false');
  });

  it('강조된 옵션에서 Enter를 누르면 그 후보를 초대하고 기본 동작(제출)을 막는다', () => {
    const onInvite = vi.fn();
    const onSearch = vi.fn();
    renderPanel({ onInvite, onSearch });
    const input = getInput();
    pressKey(input, 'ArrowDown');
    const event = pressKey(input, 'Enter');

    expect(onInvite).toHaveBeenCalledWith(candidates[0]);
    expect(onSearch).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('강조된 옵션이 없으면 Enter의 기본 동작(폼 제출)을 막지 않는다 — 기존 수동 검색 유지', () => {
    const onInvite = vi.fn();
    renderPanel({ onInvite });
    const input = getInput();
    const event = pressKey(input, 'Enter');

    expect(onInvite).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('Escape는 목록을 닫고 강조를 해제한다', () => {
    renderPanel();
    const input = getInput();
    pressKey(input, 'ArrowDown');
    expect(input.getAttribute('aria-expanded')).toBe('true');

    const event = pressKey(input, 'Escape');

    expect(event.defaultPrevented).toBe(true);
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });

  it('Escape로 닫은 뒤 다시 타이핑하면(query 변경) 목록이 다시 열린다', () => {
    renderPanel({ query: 'oc' });
    const input = getInput();
    pressKey(input, 'Escape');
    expect(input.getAttribute('aria-expanded')).toBe('false');

    renderPanel({ query: 'oct' });
    expect(getInput().getAttribute('aria-expanded')).toBe('true');
  });
});

describe('TeamInvitePanel — 마우스 클릭', () => {
  it('옵션의 초대 버튼을 클릭하면 onInvite가 그 후보로 호출된다', () => {
    const onInvite = vi.fn();
    renderPanel({ onInvite });

    const buttons = container.querySelectorAll('[role="option"] button');
    expect(buttons).toHaveLength(2);
    act(() => {
      buttons[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onInvite).toHaveBeenCalledWith(candidates[1]);
  });
});
