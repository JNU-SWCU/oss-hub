// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditableMilestone, EditableProgram } from './api';
import { UNSAVED_PROGRAM_MESSAGE } from './program-creation-flow';
import { ProgramEditPage } from './program-edit-page';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
}));
const getEditableProgramMock = vi.hoisted(() => vi.fn());
const updateMilestoneMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

vi.mock('./api', () => ({
  getEditableProgram: getEditableProgramMock,
  updateMilestone: updateMilestoneMock,
  createMilestone: vi.fn(),
  deleteMilestone: vi.fn(),
  updateProgram: vi.fn(),
  updateProgramLifecycle: vi.fn(),
}));

const milestone: EditableMilestone = {
  id: 'milestone-1',
  name: '기획서',
  startAt: '2026-08-16T09:30:59.000Z',
  dueAt: '2026-08-20T09:30:59.000Z',
  submissionType: null,
  instructions: null,
};

const secondMilestone: EditableMilestone = {
  ...milestone,
  id: 'milestone-2',
  name: '발표',
  startAt: '2026-08-22T09:30:59.000Z',
  dueAt: '2026-08-25T09:30:59.000Z',
};

const program: EditableProgram = {
  id: 'program-1',
  name: 'OSS',
  organizer: 'Center',
  category: 'OSS_CONTEST',
  lifecycle: 'PUBLISHED',
  applicationTemplateKey: 'oss-contest',
  applicationTemplateVersion: 1,
  applicationCount: 0,
  categoryLocked: {
    locked: false,
    byApplications: false,
    byTeams: false,
    applicationCount: 0,
    teamCount: 0,
  },
  applicationStartAt: '2026-08-01T09:30:59.000Z',
  applicationEndAt: '2026-08-15T09:30:59.000Z',
  startAt: '2026-08-16T09:30:59.000Z',
  endAt: '2026-08-31T09:30:59.000Z',
  repositoryProvisioningEnabled: false,
  notifyOnDeadline: false,
  description: 'overview',
  teamMinSize: 2,
  teamMaxSize: 4,
  milestones: [milestone, secondMilestone],
};

describe('마일스톤 스냅샷 저장 상태', () => {
  let container: HTMLDivElement;
  let root: Root;
  let confirmMock: ReturnType<typeof vi.fn>;
  let originalConfirm: typeof window.confirm;

  beforeEach(async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    getEditableProgramMock.mockReset().mockResolvedValue(program);
    updateMilestoneMock.mockReset();
    routerMock.push.mockReset();
    originalConfirm = window.confirm;
    confirmMock = vi.fn().mockReturnValue(false);
    window.confirm = confirmMock;
    await act(async () => {
      root.render(<ProgramEditPage programId="program-1" isAdmin={false} />);
      await Promise.resolve();
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    window.confirm = originalConfirm;
  });

  function button(name: string): HTMLButtonElement {
    const result = buttons(name)[0];
    if (result === undefined) throw new TypeError(`Button not found: ${name}`);
    return result;
  }

  function buttons(name: string): readonly HTMLButtonElement[] {
    return Array.from(document.querySelectorAll('button')).filter(
      (candidate) => candidate.textContent?.trim() === name,
    );
  }

  function nameInput(): HTMLInputElement {
    const input = document.querySelector<HTMLInputElement>('#milestone-name');
    if (input === null) throw new TypeError('Missing milestone name input.');
    return input;
  }

  async function editName(value: string): Promise<void> {
    await act(async () => button('수정').click());
    await setName(value);
  }

  async function setName(value: string): Promise<void> {
    const input = nameInput();
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set;
    await act(async () => {
      setter?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  function isBeforeUnloadGuarded(): boolean {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }

  async function assertExitGuarded(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
    });
    const exitLink = Array.from(container.querySelectorAll('a')).find(
      (candidate) => candidate.textContent?.trim() === '← 프로그램 개요',
    );
    if (exitLink === undefined) throw new TypeError('Missing exit link.');
    await act(async () => exitLink.click());
    expect(confirmMock).toHaveBeenCalledWith(UNSAVED_PROGRAM_MESSAGE);
    expect(routerMock.push).not.toHaveBeenCalled();
  }

  it('검증 실패후에도 폼과 초기 스냅샷의 dirty 판정을 유지한다', async () => {
    // Given / When
    await editName('');
    await act(async () => button('저장').click());

    // Then
    expect(nameInput().value).toBe('');
    expect(document.body.textContent).toContain(
      '마일스톤 이름을 입력해 주세요.',
    );
    await assertExitGuarded();
  });

  it('API 저장 실패 후에도 현재 폼과 dirty 상태를 유지한다', async () => {
    // Given
    updateMilestoneMock.mockRejectedValue(new TypeError('network'));
    await editName('저장 실패 기획서');

    // When
    await act(async () => {
      button('저장').click();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Then
    expect(nameInput().value).toBe('저장 실패 기획서');
    expect(document.body.textContent).toContain('입력한 내용은 그대로 남아');
    await assertExitGuarded();

    // When: 실패 후 원래 이름으로 되돌린다.
    confirmMock.mockClear();
    await setName(milestone.name);
    const exitLink = Array.from(container.querySelectorAll('a')).find(
      (candidate) => candidate.textContent?.trim() === '← 프로그램 개요',
    );
    if (exitLink === undefined) throw new TypeError('Missing exit link.');
    await act(async () => exitLink.click());

    // Then: 저장 실패가 초기 스냅샷을 바꾸지 않아 exact revert는 clean 이다.
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('저장 성공은 편집기를 닫고 다시 열 때 저장된 스냅샷에서 clean으로 시작한다', async () => {
    // Given
    const saved = { ...milestone, name: '저장된 기획서' };
    updateMilestoneMock.mockResolvedValue(saved);
    await editName(saved.name);

    // When
    await act(async () => {
      button('저장').click();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Then
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => button('수정').click());
    expect(nameInput().value).toBe(saved.name);
    const exitLink = Array.from(container.querySelectorAll('a')).find(
      (candidate) => candidate.textContent?.trim() === '← 프로그램 개요',
    );
    if (exitLink === undefined) throw new TypeError('Missing exit link.');
    await act(async () => exitLink.click());
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('첫 편집의 변경사항을 취소하고 다른 마일스톤을 열면 두 번째 스냅샷에서 clean으로 시작한다', async () => {
    // Given: 첫 마일스톤을 변경한 뒤 실제 닫기/변경사항 취소 동선을 따른다.
    await editName('취소할 기획서');
    await act(async () => button('취소').click());
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    await act(async () => button('변경사항 취소').click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    // When: 두 번째 카드의 자신의 수정 버튼으로 연다.
    const secondEdit = buttons('수정')[1];
    if (secondEdit === undefined)
      throw new TypeError('Missing second edit button.');
    await act(async () => secondEdit.click());
    expect(nameInput().value).toBe(secondMilestone.name);
    const dialog = document.querySelector('[role="dialog"]');
    if (dialog === null) throw new TypeError('Missing milestone dialog.');
    const timeButton = Array.from(
      dialog.querySelectorAll<HTMLButtonElement>('button'),
    ).find((candidate) => candidate.textContent?.trim() === '시간 변경');
    if (timeButton === undefined) throw new TypeError('Missing time button.');
    await act(async () => timeButton.click());
    expect(
      document.querySelector<HTMLInputElement>('#milestone-start-at')?.value,
    ).toBe('18:30');
    expect(
      document.querySelector<HTMLInputElement>('#milestone-due-at')?.value,
    ).toBe('18:30');
    expect(
      dialog
        .querySelector('[data-calendar-date="2026-08-22"]')
        ?.getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      dialog
        .querySelector('[data-calendar-date="2026-08-25"]')
        ?.getAttribute('aria-pressed'),
    ).toBe('true');

    // Then: 열자마자 clean이고, 변경했다 정확히 되돌리면 다시 clean이다.
    expect(isBeforeUnloadGuarded()).toBe(false);
    await setName('임시 발표');
    expect(isBeforeUnloadGuarded()).toBe(true);
    await setName(secondMilestone.name);
    expect(isBeforeUnloadGuarded()).toBe(false);
  });
});
