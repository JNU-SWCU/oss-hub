import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import type { ProgramMailTeam } from './program-mail-dto';
import {
  ProgramMailRecipientTree,
  selectedTeamState,
  toggleTeamSelection,
} from './program-mail-recipient-tree';

const team: ProgramMailTeam = {
  id: 'team-1',
  name: '프론트 1팀',
  status: 'SUBMITTED',
  deadlineEligible: true,
  applicants: [
    {
      id: 'student-1',
      displayName: '학생 하나',
      nickname: 'student-1',
      mailAvailable: true,
    },
    {
      id: 'student-2',
      displayName: '학생 둘',
      nickname: 'student-2',
      mailAvailable: true,
    },
    {
      id: 'student-3',
      displayName: '학생 셋',
      nickname: 'student-3',
      mailAvailable: false,
    },
  ],
};

describe('program mail recipient tree selection', () => {
  it('moves the team checkbox through unchecked, mixed, and checked states', () => {
    expect(selectedTeamState(team, new Set())).toBe(false);
    expect(selectedTeamState(team, new Set(['student-1']))).toBe('mixed');
    expect(selectedTeamState(team, new Set(['student-1', 'student-2']))).toBe(
      true,
    );
  });

  it('selects only mail-available applicants and clears the same group', () => {
    const selected = toggleTeamSelection(team, new Set());
    const cleared = toggleTeamSelection(team, selected);

    expect([...selected]).toEqual(['student-1', 'student-2']);
    expect([...cleared]).toEqual([]);
  });
});

describe('ProgramMailRecipientTree', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
      value: true,
      configurable: true,
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('exposes mixed state and changes the whole team from the native checkbox', async () => {
    let selected: ReadonlySet<string> = new Set(['student-1']);
    const render = () =>
      root.render(
        <ProgramMailRecipientTree
          teams={[team]}
          selectedIds={selected}
          onSelectionChange={(next) => {
            selected = next;
            render();
          }}
        />,
      );
    await act(async () => render());
    const checkbox = container.querySelector<HTMLInputElement>(
      'section > div input[type="checkbox"]',
    );
    if (checkbox === null) throw new TypeError('Missing team checkbox');

    expect(checkbox.indeterminate).toBe(true);
    expect(checkbox.getAttribute('aria-checked')).toBe('mixed');
    await act(async () => checkbox.click());
    expect([...selected]).toEqual(['student-1', 'student-2']);
    expect(container.textContent).toContain('프론트 1팀');
    expect(container.textContent).toContain('검토 대기');
    expect(container.querySelector('.lucide-clock-3')).not.toBeNull();
    expect(container.querySelector('[data-slot="status-badge"]')).toBeNull();
    expect(container.textContent).toContain('메일 수신 불가');
  });
});
