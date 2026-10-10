import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import type { EditableProgram } from './api';
import { UNSAVED_PROGRAM_MESSAGE } from './program-creation-flow';
import {
  buildProgramEditInput,
  mapMilestoneDeleteError,
  mapMilestoneError,
  mapProgramEditError,
  toProgramEditForm,
  validateProgramEditForm,
  validateMilestoneForm,
} from './program-edit-flow';
import { PROGRAM_END_AT_UNDECIDED } from './program-end-at';
import { ProgramEditPage } from './program-edit-page';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const routerReplaceMock = vi.hoisted(() => vi.fn());
const routerPushMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: routerPushMock,
    replace: routerReplaceMock,
    refresh: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
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

const { purgeProgramMock, getEditableProgramMock, updateProgramMock } =
  vi.hoisted(() => ({
    getEditableProgramMock: vi.fn(),
    purgeProgramMock: vi.fn(),
    updateProgramMock: vi.fn(),
  }));
const listMilestoneDocumentsMock = vi.hoisted(() => vi.fn());

vi.mock('./api', () => ({
  getEditableProgram: getEditableProgramMock,
  purgeProgram: purgeProgramMock,
  updateProgram: updateProgramMock,
  createMilestone: vi.fn(),
  deleteMilestone: vi.fn(),
}));

vi.mock('./milestone-document-api', () => ({
  listMilestoneDocuments: listMilestoneDocumentsMock,
}));

const editableProgram: EditableProgram = {
  id: 'program-1',
  name: 'OSS',
  organizer: 'Center',
  trackType: 'EXTRACURRICULAR',

  applicationTemplateKey: 'oss-contest',
  lifecycle: 'PUBLISHED',
  applicationTemplateVersion: 1,
  applicationCount: 0,
  deletionScopeCounts: {
    applications: 1,
    teams: 0,
    boardPosts: 0,
    submissions: 0,
    submissionEvents: 0,
    scopeFingerprint: '0123456789abcdef0123456789abcdef',
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
  milestones: [],
};

describe('ProgramEditPage save payload', () => {
  it('preserves unchanged ISO timestamps with non-zero seconds when STAFF saves by canonical id', () => {
    const form = toProgramEditForm(editableProgram);

    const input = buildProgramEditInput(form, []);

    expect(input).toMatchObject({
      trackType: 'EXTRACURRICULAR',
      applicationStartAt: editableProgram.applicationStartAt,
      applicationEndAt: editableProgram.applicationEndAt,
      startAt: editableProgram.startAt,
      endAt: editableProgram.endAt,
      teamMinSize: 2,
      teamMaxSize: 4,
      notifyOnDeadline: false,
    });
  });

  it('submits a new ISO timestamp when STAFF edits the minute-precision datetime field', () => {
    const form = {
      ...toProgramEditForm(editableProgram),
      applicationStartAt: '2026-08-01T19:45',
    };

    const input = buildProgramEditInput(form, ['applicationStartAt']);

    expect(input.applicationStartAt).toBe('2026-08-01T10:45:00.000Z');
    expect(input.applicationEndAt).toBe(editableProgram.applicationEndAt);
  });

  it('allows an operating period to begin before applications close', () => {
    const input = buildProgramEditInput(
      {
        ...toProgramEditForm(editableProgram),
        startAt: '2026-08-14T09:30',
      },
      ['startAt'],
    );

    expect(input).toMatchObject({
      applicationEndAt: editableProgram.applicationEndAt,
      startAt: '2026-08-14T00:30:00.000Z',
    });
  });

  it('종료일 없는 프로그램은 날짜를 넣기 전까지 막히고, 날짜를 고르면 ISO 로 나간다', () => {
    for (const endAt of [null, PROGRAM_END_AT_UNDECIDED]) {
      expect(
        validateProgramEditForm(
          toProgramEditForm({ ...editableProgram, endAt }),
        ).endAt,
      ).toBe('운영 종료를 입력해 주세요.');
    }

    const input = buildProgramEditInput(
      {
        ...toProgramEditForm(editableProgram),
        endAt: '2026-09-01T19:45',
      },
      ['endAt'],
    );

    expect(input.endAt).toBe('2026-09-01T10:45:00.000Z');
  });

  it('browser timezone과 무관하게 서버 시각을 서울 시각으로 표시하고 저장한다', () => {
    const form = toProgramEditForm({
      ...editableProgram,
      applicationStartAt: '2026-08-01T00:00:00.000Z',
    });

    expect(form.applicationStartAt).toBe('2026-08-01T09:00');
    expect(
      buildProgramEditInput(
        { ...form, applicationStartAt: '2026-08-01T10:00' },
        ['applicationStartAt'],
      ).applicationStartAt,
    ).toBe('2026-08-01T01:00:00.000Z');
  });

  it('신청 동일 시각은 허용하지만 운영 동일 시각과 현재 마일스톤 밖 운영 시작은 거부한다', () => {
    const equalApplication = {
      ...toProgramEditForm(editableProgram),
      applicationStartAt: '2026-08-15T18:30',
      applicationEndAt: '2026-08-15T18:30',
    };
    expect(validateProgramEditForm(equalApplication).period).toBeUndefined();

    expect(
      validateProgramEditForm({
        ...equalApplication,
        startAt: '2026-08-31T18:30',
        endAt: '2026-08-31T18:30',
      }).endAt,
    ).toContain('운영 시작일 이후');

    expect(
      validateProgramEditForm({
        ...toProgramEditForm({
          ...editableProgram,
          milestones: [
            {
              id: 'milestone-1',
              name: '중간 점검',
              startAt: '2026-08-16T09:30:59.123Z',
              dueAt: '2026-08-20T09:30:59.123Z',
              submissionType: 'TEXT',
              instructions: null,
            },
          ],
        }),
        startAt: '2026-08-17T18:30',
      }).startAt,
    ).toContain('마일스톤 시작일');
  });
});

describe('마일스톤 저장 전 검증', () => {
  const form = {
    id: null,
    name: '중간 보고',
    startAt: '2026-08-10T09:00',
    dueAt: '2026-08-20T18:00',
    originalStartAt: null,
    originalDueAt: null,
    instructions: '',
  };

  it('빈 이름·시작·마감을 각 입력 오류로 돌린다', () => {
    expect(
      validateMilestoneForm(
        { ...form, name: '', startAt: '', dueAt: '' },
        '2026-08-01T09:00',
        '2026-09-01T09:00',
      ),
    ).toMatchObject({
      name: expect.any(String) as unknown,
      startAt: expect.any(String) as unknown,
      dueAt: expect.any(String) as unknown,
    });
  });

  it('역순과 운영 기간 밖 날짜를 시작·마감 입력에 돌린다', () => {
    expect(
      validateMilestoneForm(
        {
          ...form,
          startAt: '2026-08-20T18:00',
          dueAt: '2026-08-20T18:00',
        },
        '2026-08-01T09:00',
        '2026-09-01T09:00',
      ).startAt,
    ).toContain('마감일보다 앞서야');
    expect(
      validateMilestoneForm(
        {
          ...form,
          startAt: '2026-07-31T18:00',
          dueAt: '2026-09-01T09:01',
        },
        '2026-08-01T09:00',
        '2026-09-01T09:00',
      ),
    ).toMatchObject({
      startAt: expect.any(String) as unknown,
      dueAt: expect.any(String) as unknown,
    });
    expect(
      validateMilestoneForm(
        {
          ...form,
          dueAt: '2026-09-01T09:00',
        },
        '2026-08-01T09:00',
        '2026-09-01T09:00',
      ).dueAt,
    ).toBeUndefined();
  });
});

describe('마일스톤 실패 안내', () => {
  function apiError(code: string, status: number): ApiError {
    return new ApiError({
      type: 'about:blank',
      title: 'Error',
      status,
      detail: '',
      code,
      instance: '/programs/program-1/milestones',
    });
  }

  it('저장 실패는 편집기에 남은 입력을 단언하고 다시 저장하라고 말한다', () => {
    expect(mapMilestoneError(new TypeError('network')).general).toBe(
      '마일스톤을 저장하지 못했습니다. 입력한 내용은 그대로 남아 있으니 잠시 후 다시 저장해 주세요.',
    );
  });

  it('삭제 실패는 입력 보존을 단언하지 않고 목록 새로고침을 권한다', () => {
    const message = mapMilestoneDeleteError(new TypeError('network'));
    expect(message).toBe(
      '마일스톤을 삭제하지 못했습니다. 목록을 새로고침해 현재 상태를 확인한 뒤 다시 시도해 주세요.',
    );
    expect(message).not.toContain('입력한 내용은 그대로 남아');
  });

  it('제출물 충돌은 기존 안내를 유지한다', () => {
    expect(mapMilestoneDeleteError(apiError('PRG_009', 409))).toBe(
      '제출물이 있는 마일스톤은 삭제할 수 없습니다.',
    );
  });

  it('PRG_010 은 팀이 아니라 저장소 자동 생성 설정을 원인으로 지목한다', () => {
    const onSave = mapMilestoneError(apiError('PRG_010', 422)).general ?? '';
    expect(onSave).toBe(
      '저장소 자동 생성을 켜려면 마일스톤이 1개 이상 있어야 합니다. 마일스톤을 추가한 뒤 다시 저장해 주세요.',
    );
    expect(onSave).not.toContain('팀 프로그램');

    const onProgramSave =
      mapProgramEditError(apiError('PRG_010', 422)).general ?? '';
    expect(onProgramSave).toBe(onSave);

    const onDelete = mapMilestoneDeleteError(apiError('PRG_010', 422));
    expect(onDelete).toBe(
      '저장소 자동 생성이 켜져 있어 마지막 마일스톤은 삭제할 수 없습니다. 다른 마일스톤을 먼저 추가하거나 저장소 자동 생성을 꺼 주세요.',
    );
    expect(onDelete).not.toContain('팀 프로그램');
  });
});

describe('ProgramEditPage 컴포넌트', () => {
  let container: HTMLDivElement;
  let root: Root;
  let confirmMock: ReturnType<typeof vi.fn>;
  let originalConfirm: typeof window.confirm;
  let restoreHistoryBack: () => void = () => undefined;

  function getButton(name: string): HTMLButtonElement {
    const button = Array.from(document.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim() === name,
    );
    if (!(button instanceof HTMLButtonElement)) {
      throw new TypeError(`Button not found: ${name}`);
    }
    return button;
  }

  function queryButton(name: string): HTMLButtonElement | undefined {
    return Array.from(document.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim() === name,
    );
  }

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    routerReplaceMock.mockReset();
    routerPushMock.mockReset();
    getEditableProgramMock.mockReset();
    purgeProgramMock.mockReset();
    updateProgramMock.mockReset();
    listMilestoneDocumentsMock.mockResolvedValue({
      documents: [],
      fileUpload: {
        maxBytes: 5242880,
        maxLabel: '5 MiB',
        accept: '.pdf',
        formatLabel: 'PDF',
      },
    });

    originalConfirm = window.confirm;
    confirmMock = vi.fn().mockReturnValue(false);
    window.confirm = confirmMock;
    const historyBackMock = vi
      .spyOn(window.history, 'back')
      .mockImplementation(() => {
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
    restoreHistoryBack = () => historyBackMock.mockRestore();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    window.confirm = originalConfirm;
    restoreHistoryBack();
  });

  it.each(['PUBLISHED', 'ARCHIVED'] as const)(
    'published/archived 프로그램은 저장하지 않은 입력이 있어도 한 번 확인한 뒤 삭제한다 (%s)',
    async (lifecycle) => {
      const program = { ...editableProgram, lifecycle };
      getEditableProgramMock.mockResolvedValue(program);
      purgeProgramMock.mockResolvedValue({
        id: 'program-1',
        deleted: true,
        deletedCounts: { applications: 1 },
      });

      await act(async () => {
        root.render(<ProgramEditPage programId="program-1" canDeleteProgram />);
        await Promise.resolve();
      });

      const nameInput =
        container.querySelector<HTMLInputElement>('#program-name');
      if (nameInput === null) throw new TypeError('Missing #program-name.');
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      );
      await act(async () => {
        setter?.set?.call(nameInput, '삭제 직전에도 남아 있는 입력');
        nameInput.dispatchEvent(new Event('input', { bubbles: true }));
        await Promise.resolve();
      });

      await act(async () => getButton('프로그램 삭제').click());
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      await act(async () => getButton('삭제').click());
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(purgeProgramMock).toHaveBeenCalledTimes(1);
      expect(purgeProgramMock).toHaveBeenCalledWith(
        'program-1',
        program.deletionScopeCounts,
      );
      expect(confirmMock).not.toHaveBeenCalled();
      expect(routerPushMock).toHaveBeenCalledWith(
        `/programs?purged=${encodeURIComponent('지원서 1건')}`,
      );
    },
  );

  it('삭제 실패는 다이얼로그와 나가기 가드를 유지한다', async () => {
    getEditableProgramMock.mockResolvedValue(editableProgram);
    purgeProgramMock.mockRejectedValue(new TypeError('network'));

    await act(async () => {
      root.render(<ProgramEditPage programId="program-1" canDeleteProgram />);
      await Promise.resolve();
    });
    const nameInput =
      container.querySelector<HTMLInputElement>('#program-name');
    if (nameInput === null) throw new TypeError('Missing #program-name.');
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    );
    await act(async () => {
      setter?.set?.call(nameInput, '삭제 실패 뒤에도 남아 있는 입력');
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
    });

    await act(async () => getButton('프로그램 삭제').click());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => getButton('삭제').click());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(purgeProgramMock).toHaveBeenCalledTimes(1);
    expect(routerPushMock).not.toHaveBeenCalled();
    expect(confirmMock).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(document.body.textContent).toContain(
      '프로그램 전체를 삭제하지 못했습니다.',
    );
    expect(getButton('삭제').disabled).toBe(false);
  });

  it('삭제를 취소하면 purge를 호출하지 않고 나가기 가드를 보존한다', async () => {
    getEditableProgramMock.mockResolvedValue(editableProgram);

    await act(async () => {
      root.render(<ProgramEditPage programId="program-1" canDeleteProgram />);
      await Promise.resolve();
    });
    const nameInput =
      container.querySelector<HTMLInputElement>('#program-name');
    if (nameInput === null) throw new TypeError('Missing #program-name.');
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    );
    await act(async () => {
      setter?.set?.call(nameInput, '삭제 취소 뒤에도 남아 있는 입력');
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
    });

    await act(async () => getButton('프로그램 삭제').click());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => getButton('취소').click());

    expect(purgeProgramMock).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    const exitLink = Array.from(container.querySelectorAll('a')).find(
      (candidate) => candidate.textContent?.trim() === '← 프로그램 개요',
    );
    if (exitLink === undefined) throw new TypeError('Missing exit link.');
    await act(async () => exitLink.click());

    expect(confirmMock).toHaveBeenCalledWith(UNSAVED_PROGRAM_MESSAGE);
    expect(routerPushMock).not.toHaveBeenCalled();
  });

  it('빈 새 마일스톤은 변환 전에 필드 오류를 보여 주고 일정 달력에 초점을 둔다', async () => {
    getEditableProgramMock.mockResolvedValue(editableProgram);

    await act(async () => {
      root.render(
        <ProgramEditPage programId="program-1" canDeleteProgram={false} />,
      );
      await Promise.resolve();
    });
    await act(async () => getButton('추가').click());
    await act(async () => getButton('마일스톤 저장').click());

    expect(container.textContent).toContain('마일스톤 이름을 입력해 주세요.');
    expect(container.textContent).toContain('유효한 시작일을 입력해 주세요.');
    expect(container.textContent).toContain('유효한 마감일을 입력해 주세요.');
    expect(document.activeElement).toBe(
      container.querySelector(
        '[data-testid="program-schedule-calendar-scroll"][aria-invalid="true"]',
      ),
    );
  });

  it('이름만 채운 새 마일스톤은 비활성 시각 입력 대신 날짜 달력에 초점을 둔다', async () => {
    getEditableProgramMock.mockResolvedValue(editableProgram);
    await act(async () => {
      root.render(
        <ProgramEditPage programId="program-1" canDeleteProgram={false} />,
      );
      await Promise.resolve();
    });
    await act(async () => getButton('추가').click());
    const name = container.querySelector<HTMLInputElement>('#milestone-name');
    if (name === null) throw new TypeError('Missing milestone name.');
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    );
    await act(async () => {
      setter?.set?.call(name, '새 마일스톤');
      name.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => getButton('마일스톤 저장').click());

    expect(document.activeElement).toBe(
      container.querySelector(
        '[data-testid="program-schedule-calendar-scroll"][aria-invalid="true"]',
      ),
    );
  });

  it('저장 후에도 화면에 머무르고 상세 화면으로 이동하지 않는다', async () => {
    getEditableProgramMock.mockResolvedValue(editableProgram);
    updateProgramMock.mockResolvedValue(editableProgram);

    await act(async () => {
      root.render(
        <ProgramEditPage programId="program-1" canDeleteProgram={false} />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      getButton('프로그램 정보 저장').click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(updateProgramMock).toHaveBeenCalled();
    expect(routerReplaceMock).not.toHaveBeenCalled();
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      '저장되었습니다.',
    );
  });

  it('「미정」 센티널 프로그램은 종료일을 넣기 전까지 저장하지 않고, 넣으면 그 날짜로 저장한다', async () => {
    const legacyProgram = {
      ...editableProgram,
      endAt: PROGRAM_END_AT_UNDECIDED,
    };
    getEditableProgramMock.mockResolvedValue(legacyProgram);
    updateProgramMock.mockResolvedValue({
      ...legacyProgram,
      endAt: '2026-08-31T14:59:00.000Z',
    });

    await act(async () => {
      root.render(
        <ProgramEditPage programId="program-1" canDeleteProgram={false} />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain('종료일 미정');
    await act(async () => getButton('프로그램 정보 저장').click());
    await act(async () => {
      await Promise.resolve();
    });

    expect(updateProgramMock).not.toHaveBeenCalled();
    expect(
      container.querySelector('#operation-schedule-error')?.textContent,
    ).toBe('운영 종료를 입력해 주세요.');

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="운영 기간 수정"]')
        ?.click(),
    );
    expect(document.body.querySelector('#program-end-at-undecided')).toBeNull();
    expect(
      document.body.querySelector<HTMLInputElement>(
        'input[aria-label="운영 기간 종료일"]',
      )?.value,
    ).toBe('');
    await act(async () =>
      document.body
        .querySelector<HTMLButtonElement>('[data-calendar-date="2026-08-17"]')
        ?.click(),
    );
    await act(async () =>
      document.body
        .querySelector<HTMLButtonElement>('[data-calendar-date="2026-08-31"]')
        ?.click(),
    );
    await act(async () => getButton('날짜 적용').click());
    await act(async () => getButton('프로그램 정보 저장').click());
    await act(async () => {
      await Promise.resolve();
    });

    expect(updateProgramMock).toHaveBeenCalledTimes(1);
    expect(updateProgramMock).toHaveBeenLastCalledWith(
      'program-1',
      expect.objectContaining({ endAt: '2026-08-31T14:59:00.000Z' }),
    );
  });

  it('운영 시작과 종료가 같으면 적용 전에 dialog 오류를 보여준다', async () => {
    getEditableProgramMock.mockResolvedValue(editableProgram);

    await act(async () => {
      root.render(
        <ProgramEditPage programId="program-1" canDeleteProgram={false} />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="운영 기간 수정"]')
        ?.click(),
    );
    const sameDay = document.body.querySelector<HTMLButtonElement>(
      '[data-calendar-date="2026-08-31"]',
    );
    const endTime = document.body.querySelector<HTMLInputElement>(
      'input[aria-label="운영 기간 종료 시각"]',
    );
    if (sameDay === null || endTime === null)
      throw new TypeError('Missing operation calendar controls.');
    await act(async () => {
      sameDay.click();
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set?.call(endTime, '09:30');
      endTime.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => getButton('날짜 적용').click());

    expect(updateProgramMock).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(
      '프로그램 종료일은 운영 시작일 이후여야 합니다.',
    );
  });

  it('신청 기간 적용은 PATCH 없이 선택 endpoint만 dirty로 만든 뒤 부모 저장 한 번에서 보낸다', async () => {
    getEditableProgramMock.mockResolvedValue(editableProgram);
    updateProgramMock.mockResolvedValue(editableProgram);

    await act(async () => {
      root.render(
        <ProgramEditPage programId="program-1" canDeleteProgram={false} />,
      );
      await Promise.resolve();
    });

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="신청 기간 수정"]')
        ?.click(),
    );
    const applicationStart = document.body.querySelector<HTMLButtonElement>(
      '[data-calendar-date="2026-08-02"]',
    );
    if (applicationStart === null)
      throw new TypeError('Missing application calendar.');
    await act(async () => {
      applicationStart.click();
    });
    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>('[data-calendar-date="2026-08-15"]')
        ?.click();
    });
    await act(async () => getButton('날짜 적용').click());
    expect(updateProgramMock).not.toHaveBeenCalled();

    await act(async () => getButton('프로그램 정보 저장').click());
    await act(async () => {
      await Promise.resolve();
    });

    expect(updateProgramMock).toHaveBeenCalledTimes(1);
    expect(updateProgramMock).toHaveBeenLastCalledWith(
      'program-1',
      expect.objectContaining({
        applicationStartAt: '2026-08-02T09:30:00.000Z',
        applicationEndAt: editableProgram.applicationEndAt,
      }),
    );
  });

  it('기본 정보 저장이 실패하면 입력값과 dirty 상태를 유지하고 폼 옆에 에러를 보여준다', async () => {
    getEditableProgramMock.mockResolvedValue(editableProgram);
    updateProgramMock.mockRejectedValue(new TypeError('network'));

    await act(async () => {
      root.render(
        <ProgramEditPage programId="program-1" canDeleteProgram={false} />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    const nameInput =
      container.querySelector<HTMLInputElement>('#program-name');
    if (nameInput === null) throw new TypeError('Missing #program-name.');
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    );
    await act(async () => {
      setter?.set?.call(nameInput, '저장 실패해도 남아야 하는 이름');
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => {
      getButton('프로그램 정보 저장').click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(updateProgramMock).toHaveBeenCalled();

    expect(
      container.querySelector<HTMLInputElement>('#program-name')?.value,
    ).toBe('저장 실패해도 남아야 하는 이름');

    expect(getButton('프로그램 정보 저장')).toBeTruthy();

    expect(container.textContent).toContain(
      '저장에 실패했습니다. 다시 시도해 주세요.',
    );
  });

  it('마일스톤 편집기에 저장 안 한 입력이 있으면 나가기가 확인창을 거친다', async () => {
    getEditableProgramMock.mockResolvedValue(editableProgram);

    await act(async () => {
      root.render(
        <ProgramEditPage programId="program-1" canDeleteProgram={false} />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      getButton('추가').click();
    });

    const nameInput =
      container.querySelector<HTMLInputElement>('#milestone-name');
    if (nameInput === null) throw new TypeError('Missing #milestone-name.');
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    );
    await act(async () => {
      setter?.set?.call(nameInput, '아직 저장 안 한 마일스톤');
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const exitLink = Array.from(container.querySelectorAll('a')).find(
      (candidate) => candidate.textContent?.trim() === '← 프로그램 개요',
    );
    if (exitLink === undefined) throw new TypeError('Missing exit link.');

    await act(async () => {
      exitLink.click();
    });

    expect(confirmMock).toHaveBeenCalledWith(UNSAVED_PROGRAM_MESSAGE);

    expect(routerPushMock).not.toHaveBeenCalled();
  });

  it('canDeleteProgram={true}면 위험 영역 섹션을 그린다', async () => {
    getEditableProgramMock.mockResolvedValue(editableProgram);

    await act(async () => {
      root.render(<ProgramEditPage programId="program-1" canDeleteProgram />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain('위험 영역');
    expect(queryButton('프로그램 삭제')).toBeTruthy();
  });

  it('canDeleteProgram={false}면 위험 영역과 삭제 버튼을 그리지 않는다', async () => {
    getEditableProgramMock.mockResolvedValue(editableProgram);

    await act(async () => {
      root.render(
        <ProgramEditPage programId="program-1" canDeleteProgram={false} />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain('위험 영역');
    expect(queryButton('프로그램 삭제')).toBeUndefined();
  });
});
