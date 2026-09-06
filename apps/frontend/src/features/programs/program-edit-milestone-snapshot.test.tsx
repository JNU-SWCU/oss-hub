// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
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
const getEditableMilestoneMock = vi.hoisted(() => vi.fn());
const updateEditableMilestoneMock = vi.hoisted(() => vi.fn());
const listMilestoneDocumentsMock = vi.hoisted(() => vi.fn());

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

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  getEditableProgram: getEditableProgramMock,
  getEditableMilestone: getEditableMilestoneMock,
  updateEditableMilestone: updateEditableMilestoneMock,
  createMilestone: vi.fn(),
  deleteMilestone: vi.fn(),
  updateProgram: vi.fn(),
  updateProgramLifecycle: vi.fn(),
}));

vi.mock('./milestone-document-api', () => ({
  listMilestoneDocuments: listMilestoneDocumentsMock,
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
  trackType: 'EXTRACURRICULAR',
  lifecycle: 'PUBLISHED',
  applicationTemplateKey: 'oss-contest',
  applicationTemplateVersion: 1,
  applicationCount: 0,
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
    getEditableMilestoneMock
      .mockReset()
      .mockImplementation((milestoneId: string) => {
        const current = program.milestones.find(
          (item) => item.id === milestoneId,
        );
        if (current === undefined)
          return Promise.reject(new Error('Unknown test milestone'));
        return Promise.resolve({
          milestone: current,
          operation: { startAt: program.startAt, endAt: program.endAt },
          documents: [],
          fileUpload: {
            maxBytes: 5242880,
            maxLabel: '5 MiB',
            accept: '.pdf',
            formatLabel: 'PDF',
          },
          fingerprint: 'a'.repeat(64),
        });
      });
    updateEditableMilestoneMock.mockReset();
    listMilestoneDocumentsMock.mockResolvedValue({
      documents: [],
      fileUpload: {
        maxBytes: 5242880,
        maxLabel: '5 MiB',
        accept: '.pdf',
        formatLabel: 'PDF',
      },
    });
    routerMock.push.mockReset();
    originalConfirm = window.confirm;
    confirmMock = vi.fn().mockReturnValue(false);
    window.confirm = confirmMock;
    await act(async () => {
      root.render(
        <ProgramEditPage programId="program-1" canDeleteProgram={false} />,
      );
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

  function editButton(name: string): HTMLButtonElement {
    const result = document.querySelector<HTMLButtonElement>(
      `button[aria-label="${name} 수정"]`,
    );
    if (result === null) throw new TypeError(`Edit button not found: ${name}`);
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
    await act(async () => editButton(milestone.name).click());
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
    updateEditableMilestoneMock.mockRejectedValue(new TypeError('network'));
    await editName('저장 실패 기획서');

    // When
    await act(async () => {
      button('저장').click();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Then
    expect(nameInput().value).toBe('저장 실패 기획서');
    expect(document.body.textContent).toContain(
      '저장 결과를 확인할 수 없습니다. 입력은 유지됩니다.',
    );
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

  it('기존 마일스톤은 단일 snapshot을 읽고 fingerprint를 포함한 full PATCH로 저장한다', async () => {
    await editName('수정된 기획서');
    updateEditableMilestoneMock.mockResolvedValue({
      milestone: { ...milestone, name: '수정된 기획서' },
      operation: { startAt: program.startAt, endAt: program.endAt },
      documents: [],
      fileUpload: {
        maxBytes: 5242880,
        maxLabel: '5 MiB',
        accept: '.pdf',
        formatLabel: 'PDF',
      },
      fingerprint: 'b'.repeat(64),
    });
    await act(async () => {
      button('저장').click();
      await Promise.resolve();
    });

    expect(getEditableMilestoneMock).toHaveBeenCalledWith('milestone-1');
    expect(updateEditableMilestoneMock).toHaveBeenCalledWith(
      'milestone-1',
      expect.objectContaining({
        expectedFingerprint: 'a'.repeat(64),
        name: '수정된 기획서',
        documents: [],
      }),
    );
    expect(updateEditableMilestoneMock.mock.calls[0]?.[1]).toMatchObject({
      startAt: milestone.startAt,
      dueAt: milestone.dueAt,
    });
  });

  it('목록의 오래된 메타데이터 대신 GET snapshot의 날짜와 이름으로 편집을 시작한다', async () => {
    const current = {
      ...milestone,
      name: '서버 최신 기획서',
      startAt: '2026-08-17T09:30:59.000Z',
      dueAt: '2026-08-21T09:30:59.000Z',
    };
    getEditableMilestoneMock.mockResolvedValueOnce({
      milestone: current,
      operation: { startAt: program.startAt, endAt: program.endAt },
      documents: [],
      fileUpload: {
        maxBytes: 5242880,
        maxLabel: '5 MiB',
        accept: '.pdf',
        formatLabel: 'PDF',
      },
      fingerprint: 'c'.repeat(64),
    });
    await act(async () => {
      editButton(milestone.name).click();
      await Promise.resolve();
    });

    expect(nameInput().value).toBe('서버 최신 기획서');
    const scheduleButton = document.querySelector<HTMLButtonElement>(
      'button[aria-label="서버 최신 기획서 일정 입력"]',
    );
    if (scheduleButton === null)
      throw new TypeError('Missing server schedule input button.');
    await act(async () => scheduleButton.click());
    expect(
      document.querySelector<HTMLInputElement>(
        'input[aria-label="서버 최신 기획서 시작 시각"]',
      )?.value,
    ).toBe('18:30');
  });

  it('unknown 저장 결과는 입력을 유지하고 명시적 새로고침 전에는 재기준화하지 않는다', async () => {
    updateEditableMilestoneMock.mockRejectedValue(new TypeError('network'));
    await editName('결과 확인 필요');
    await act(async () => {
      button('저장').click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(nameInput().value).toBe('결과 확인 필요');
    expect(document.body.textContent).toContain(
      '저장 결과를 확인할 수 없습니다',
    );
    expect(button('새로고침')).toBeTruthy();
  });

  it('conflict refresh keeps the draft blocked until explicit latest restart', async () => {
    updateEditableMilestoneMock.mockRejectedValueOnce(
      new ApiError({
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        detail: 'changed',
        instance: '/milestones/milestone-1',
        code: 'PRG_016',
      }),
    );
    await editName('충돌 전 입력');
    await act(async () => {
      button('저장').click();
      await Promise.resolve();
    });
    getEditableMilestoneMock.mockResolvedValueOnce({
      milestone: { ...milestone, name: '서버 최신' },
      operation: { startAt: program.startAt, endAt: program.endAt },
      documents: [],
      fileUpload: {
        maxBytes: 5242880,
        maxLabel: '5 MiB',
        accept: '.pdf',
        formatLabel: 'PDF',
      },
      fingerprint: 'd'.repeat(64),
    });
    await act(async () => button('새로고침').click());
    expect(nameInput().value).toBe('충돌 전 입력');
    expect(button('저장').disabled).toBe(true);
    await act(async () => button('최신 서버 상태로 다시 시작').click());
    expect(nameInput().value).toBe('서버 최신');
    expect(button('저장').disabled).toBe(false);
  });

  it('same-tick submit events issue one aggregate PATCH', async () => {
    updateEditableMilestoneMock.mockResolvedValue({
      milestone,
      operation: { startAt: program.startAt, endAt: program.endAt },
      documents: [],
      fileUpload: {
        maxBytes: 5242880,
        maxLabel: '5 MiB',
        accept: '.pdf',
        formatLabel: 'PDF',
      },
      fingerprint: 'e'.repeat(64),
    });
    await editName('한 번만 저장');
    await act(async () => {
      button('저장').click();
      button('저장').click();
      await Promise.resolve();
    });
    expect(updateEditableMilestoneMock).toHaveBeenCalledTimes(1);
  });

  it('저장 성공은 편집기를 닫고 다시 열 때 저장된 스냅샷에서 clean으로 시작한다', async () => {
    // Given
    const saved = { ...milestone, name: '저장된 기획서' };
    updateEditableMilestoneMock.mockResolvedValue({
      milestone: saved,
      operation: { startAt: program.startAt, endAt: program.endAt },
      documents: [],
      fileUpload: {
        maxBytes: 5242880,
        maxLabel: '5 MiB',
        accept: '.pdf',
        formatLabel: 'PDF',
      },
      fingerprint: 'b'.repeat(64),
    });
    await editName(saved.name);

    // When
    await act(async () => {
      button('저장').click();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Then
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    getEditableMilestoneMock.mockResolvedValueOnce({
      milestone: saved,
      operation: { startAt: program.startAt, endAt: program.endAt },
      documents: [],
      fileUpload: {
        maxBytes: 5242880,
        maxLabel: '5 MiB',
        accept: '.pdf',
        formatLabel: 'PDF',
      },
      fingerprint: 'b'.repeat(64),
    });
    await act(async () => editButton(saved.name).click());
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
    await act(async () => button('버리기').click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    // When: 두 번째 카드의 자신의 수정 버튼으로 연다.
    const secondEdit = editButton(secondMilestone.name);
    await act(async () => secondEdit.click());
    expect(nameInput().value).toBe(secondMilestone.name);
    const dialog = document.querySelector('[role="dialog"]');
    if (dialog === null) throw new TypeError('Missing milestone dialog.');
    /*
     * 단일 범위 편집기는 `layout="simple"` 이라 인라인 「시간 변경」 disclosure 가 없다.
     * 날짜·시각은 「일정 입력」이 여는 `ProgramScheduleRangeDialog` 가 담당하고,
     * 그 입력들은 id 가 아니라 `aria-label` 로 이름을 갖는다.
     */
    const scheduleButton = dialog.querySelector<HTMLButtonElement>(
      `button[aria-label="${secondMilestone.name} 일정 입력"]`,
    );
    if (scheduleButton === null)
      throw new TypeError('Missing schedule input button.');
    await act(async () => scheduleButton.click());
    const timeValue = (label: string) =>
      document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)
        ?.value;
    expect(timeValue(`${secondMilestone.name} 시작 시각`)).toBe('18:30');
    expect(timeValue(`${secondMilestone.name} 종료 시각`)).toBe('18:30');
    // 중첩 다이얼로그만 닫는다 — 문서의 첫 「취소」는 마일스톤 다이얼로그 것이다.
    const openDialogs =
      document.querySelectorAll<HTMLElement>('[role="dialog"]');
    const rangeDialog = openDialogs[openDialogs.length - 1];
    if (rangeDialog === undefined) throw new TypeError('Missing range dialog.');
    const closeRangeDialog = Array.from(
      rangeDialog.querySelectorAll<HTMLButtonElement>('button'),
    ).find((candidate) => candidate.textContent?.trim() === '취소');
    if (closeRangeDialog === undefined)
      throw new TypeError('Missing range dialog cancel.');
    await act(async () => closeRangeDialog.click());
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
