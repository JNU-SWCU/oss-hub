// @vitest-environment happy-dom

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

const {
  getEditableProgramMock,
  updateProgramMock,
  updateProgramLifecycleMock,
} = vi.hoisted(() => ({
  getEditableProgramMock: vi.fn(),
  updateProgramMock: vi.fn(),
  updateProgramLifecycleMock: vi.fn(),
}));

vi.mock('./api', () => ({
  getEditableProgram: getEditableProgramMock,
  updateProgram: updateProgramMock,
  updateProgramLifecycle: updateProgramLifecycleMock,
  createMilestone: vi.fn(),
  updateMilestone: vi.fn(),
  deleteMilestone: vi.fn(),
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
    // Given
    const form = toProgramEditForm(editableProgram);

    // When
    const input = buildProgramEditInput(form, []);

    // Then
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
    // Given
    const form = {
      ...toProgramEditForm(editableProgram),
      applicationStartAt: '2026-08-01T19:45',
    };

    // When
    const input = buildProgramEditInput(form, ['applicationStartAt']);

    // Then
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

  // 종료일 없음을 뜻하는 표현이 하나로 모였다 — `null` 과 센티널은 같은 뜻이고
  // 폼은 그것을 「미정」 체크박스로 나르며, 저장은 언제나 센티널로 되돌린다.
  // 예전에는 이 자리에서 payload 가 `null` 로 나갔는데, 그 값을 받은 서버는
  // `new Date(null)` 로 Invalid Date 를 만든다(program-editor.service.ts).
  it('종료일 없는 프로그램은 센티널로 왕복하고, 날짜를 고르면 ISO 로 나간다', () => {
    expect(
      buildProgramEditInput(
        toProgramEditForm({ ...editableProgram, endAt: null }),
        [],
      ).endAt,
    ).toBe(PROGRAM_END_AT_UNDECIDED);

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
      name: expect.any(String),
      startAt: expect.any(String),
      dueAt: expect.any(String),
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
      startAt: expect.any(String),
      dueAt: expect.any(String),
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

// #355 — 마일스톤 실패 안내는 "입력이 남아 있는지"와 "다음에 무엇을 할지"를 말해야 한다.
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

  // PRG_010 의 실제 서버 규칙은 저장소 자동 생성 설정이며 팀 여부와 무관하다.
  // 화면이 "팀 프로그램" 을 원인으로 지목하면 교직원이 엉뚱한 곳을 고치게 된다.
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

// #867 — 저장은 화면에 머무르고(리다이렉트 없음), 게시 상태 전환은 window.confirm이
// 아니라 화면 안 확인창으로 처리한다. 이 두 가지는 페이지 컴포넌트를 실제로 렌더링해야
// 검증된다 — 순수 함수 테스트로는 라우팅·다이얼로그 여부를 볼 수 없다.
describe('ProgramEditPage 컴포넌트', () => {
  let container: HTMLDivElement;
  let root: Root;
  let confirmMock: ReturnType<typeof vi.fn>;
  let originalConfirm: typeof window.confirm;

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
    ) as HTMLButtonElement | undefined;
  }

  function getScheduleButton(name: string): HTMLButtonElement {
    const button = Array.from(
      document.querySelectorAll<HTMLButtonElement>('button[aria-pressed]'),
    ).find((candidate) => candidate.textContent?.includes(name));
    if (button === undefined) {
      throw new TypeError(`Schedule button not found: ${name}`);
    }
    return button;
  }

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    routerReplaceMock.mockReset();
    routerPushMock.mockReset();
    getEditableProgramMock.mockReset();
    updateProgramMock.mockReset();
    updateProgramLifecycleMock.mockReset();
    // window.confirm은 이 화면에서 더 이상 쓰이지 않아야 한다 — 남아 있다면 호출을
    // 잡아내되, 값을 돌려주지 않으면 뒤에 이어지는 로직이 확인 없이 막힐 수 있으니
    // false로 고정해 "여전히 confirm에 의존한다"가 조용히 통과하지 않게 한다.
    originalConfirm = window.confirm;
    confirmMock = vi.fn().mockReturnValue(false);
    window.confirm = confirmMock;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    window.confirm = originalConfirm;
  });

  it('빈 새 마일스톤은 변환 전에 필드 오류를 보여 주고 첫 입력에 초점을 둔다', async () => {
    getEditableProgramMock.mockResolvedValue(editableProgram);

    await act(async () => {
      root.render(
        <ProgramEditPage programId="program-1" canDeleteProgram={false} />,
      );
      await Promise.resolve();
    });
    await act(async () => getButton('추가').click());
    await act(async () => getButton('저장').click());

    expect(container.textContent).toContain('마일스톤 이름을 입력해 주세요.');
    expect(container.textContent).toContain('유효한 시작일을 입력해 주세요.');
    expect(container.textContent).toContain('유효한 마감일을 입력해 주세요.');
    expect(document.activeElement).toBe(
      container.querySelector('#milestone-name'),
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
    )?.set;
    await act(async () => {
      setter?.call(name, '새 마일스톤');
      name.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => getButton('저장').click());

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
      getButton('변경사항 저장').click();
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

  // Addition 2 — 저장 실패 경로는 여태 마운트 테스트가 없었다. submit의 catch가
  // form을 그대로 두는지(errors만 채우고 setForm/초기화를 하지 않는지)를 실제
  // DOM으로 확인한다.
  it('운영 시작과 종료가 같으면 종료 시각 옆에 오류를 보여준다', async () => {
    getEditableProgramMock.mockResolvedValue(editableProgram);

    await act(async () => {
      root.render(
        <ProgramEditPage programId="program-1" canDeleteProgram={false} />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => getScheduleButton('운영 기간').click());
    const lastDay = container.querySelector<HTMLButtonElement>(
      '[data-calendar-date="2026-08-31"]',
    );
    if (lastDay === null) throw new TypeError('Missing 2026-08-31.');
    await act(async () => {
      lastDay.click();
    });

    await act(async () => {
      getButton('변경사항 저장').click();
    });

    expect(updateProgramMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      '프로그램 종료일은 운영 시작일 이후여야 합니다.',
    );
    expect(document.activeElement).toBe(
      container.querySelector('#program-end-at'),
    );
  });

  it('신청 날짜 순서가 잘못되면 두 날짜의 관계와 수정 위치를 함께 안내한다', async () => {
    getEditableProgramMock.mockResolvedValue(editableProgram);

    await act(async () => {
      root.render(
        <ProgramEditPage programId="program-1" canDeleteProgram={false} />,
      );
      await Promise.resolve();
    });

    const sameDay = container.querySelector<HTMLButtonElement>(
      '[data-calendar-date="2026-08-15"]',
    );
    if (sameDay === null) throw new TypeError('Missing 2026-08-15.');
    await act(async () => sameDay.click());
    await act(async () => getButton('시간 변경').click());
    const applicationStart = container.querySelector<HTMLInputElement>(
      '#program-application-start-at',
    );
    if (applicationStart === null)
      throw new TypeError('Missing #program-application-start-at.');
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set;
    await act(async () => {
      setter?.call(applicationStart, '18:31');
      applicationStart.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => getButton('변경사항 저장').click());

    expect(updateProgramMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      '신청 시작과 마감을 모두 확인해 주세요. 시작은 마감과 같거나 이전이어야 합니다.',
    );
    expect(document.activeElement).toBe(
      container.querySelector('#program-application-start-at'),
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
    )?.set;
    await act(async () => {
      setter?.call(nameInput, '저장 실패해도 남아야 하는 이름');
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => {
      getButton('변경사항 저장').click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(updateProgramMock).toHaveBeenCalled();
    // 입력값이 그대로다 — submit의 catch는 setForm으로 되돌리지 않는다.
    expect(
      container.querySelector<HTMLInputElement>('#program-name')?.value,
    ).toBe('저장 실패해도 남아야 하는 이름');
    // 저장 버튼은 저장 중 상태에서 풀려나 다시 눌러 볼 수 있다.
    expect(getButton('변경사항 저장')).toBeTruthy();
    // 에러는 폼 옆(FieldError)에 뜬다 — 페이지 위쪽 generalAlert가 아니다.
    expect(container.textContent).toContain(
      '저장에 실패했습니다. 다시 시도해 주세요.',
    );
  });

  it('게시 상태 전환은 window.confirm이 아니라 화면 안 확인창으로 처리한다', async () => {
    // 상태 전환 성공 후에는 load()로 다시 불러오지 않는다(아래 블로커 회귀
    // 테스트 참고) — getEditableProgram은 최초 진입 한 번만 불린다.
    getEditableProgramMock.mockResolvedValue(editableProgram);
    updateProgramLifecycleMock.mockResolvedValue({
      id: 'program-1',
      lifecycle: 'ARCHIVED',
    });

    await act(async () => {
      root.render(
        <ProgramEditPage programId="program-1" canDeleteProgram={false} />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      getButton('프로그램 내리기').click();
    });

    expect(confirmMock).not.toHaveBeenCalled();
    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('프로그램을 내릴까요?');

    await act(async () => {
      getButton('내리기').click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(updateProgramLifecycleMock).toHaveBeenCalledWith(
      'program-1',
      'ARCHIVED',
    );
    expect(getEditableProgramMock).toHaveBeenCalledTimes(1);
    expect(confirmMock).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(queryButton('프로그램 내리기')).toBeUndefined();
    expect(getButton('다시 게시하기')).toBeTruthy();
  });

  // #1181 — 이 확인창은 실제로 일어나는 일만 말해야 한다. 내리기(ARCHIVED)는
  // 공개 목록에서 프로그램을 지우지 않는다: backend `program-list-status-filter.ts`
  // 의 공개 모수가 `PUBLISHED | ARCHIVED` 라 목록에 남고, 상세도
  // `programs.service.ts` 가 lifecycle 로 막지 않아 그대로 열린다. 예전 문구는
  // 「공개 목록에서 사라지고」라고 약속해 교직원이 아무도 못 본다고 믿게 했다.
  // 문구가 다시 그 약속으로 흘러가면 이 테스트가 잡는다.
  it('내리기 확인창은 목록에서 사라진다고 약속하지 않고 목록·상세가 열린다고 알린다', async () => {
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
      getButton('프로그램 내리기').click();
    });

    const dialogText =
      document.querySelector('[role="alertdialog"]')?.textContent ?? '';
    expect(dialogText).toContain(
      '신규 신청이 곧바로 멈춥니다. 다만 공개 목록에서 사라지지는 않습니다 — 목록과 상세는 그대로 열립니다. 이미 접수된 신청과 팀·제출 데이터는 그대로 남으며 언제든 다시 게시할 수 있습니다.',
    );
    // 지키지 못하는 약속 — 어떤 표현으로도 다시 들어오면 안 된다.
    expect(dialogText).not.toContain('공개 목록에서 사라지고');
    expect(dialogText).not.toContain('목록에서 사라집니다');
    expect(dialogText).not.toContain('공개 목록에 보이지 않');
  });

  // 리뷰에서 발견된 블로커 — confirmLifecycleToggle이 성공 후 load()를 불렀다.
  // load()는 즉시 setState({kind:'loading'})·setForm(null)을 하므로 그 순간
  // 렌더 가드가 화면 전체를 스켈레톤으로 갈아치우고, 다시 불러온 서버 값으로
  // form을 되돌려 저장하지 않은 기본 정보 입력을 지워 버렸다. 이 테스트는 그
  // 회귀를 잡는다 — OLD 코드(await load())로 되돌리면 실패해야 한다.
  it('게시 상태를 전환해도 저장하지 않은 기본 정보 입력과 화면이 그대로 남는다', async () => {
    getEditableProgramMock.mockResolvedValue(editableProgram);
    // 요청을 일부러 매달아 둔다 — "진행 중"인 순간을 경쟁 상태 없이 확실하게
    // 관찰하려면, 프라미스가 언제 풀리는지 테스트가 직접 쥐고 있어야 한다.
    let resolveLifecycle: (result: {
      id: string;
      lifecycle: 'PUBLISHED' | 'ARCHIVED';
    }) => void = () => undefined;
    updateProgramLifecycleMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLifecycle = resolve;
        }),
    );

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
    )?.set;
    await act(async () => {
      setter?.call(nameInput, '저장 안 한 이름');
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(nameInput.value).toBe('저장 안 한 이름');

    await act(async () => {
      getButton('프로그램 내리기').click();
    });
    await act(async () => {
      getButton('내리기').click();
    });

    // 요청이 아직 안 끝난 이 시점 — 화면이 스켈레톤으로 갈아치워지지 않았고
    // 입력값도 지워지지 않았는지, 정말 "진행 중"인지(버튼 문구) 확인한다.
    expect(
      document.querySelector('[aria-label="프로그램 편집 불러오는 중"]'),
    ).toBeNull();
    expect(
      container.querySelector<HTMLInputElement>('#program-name')?.value,
    ).toBe('저장 안 한 이름');
    expect(getButton('내리는 중…')).toBeTruthy();

    await act(async () => {
      resolveLifecycle({ id: 'program-1', lifecycle: 'ARCHIVED' });
      await Promise.resolve();
      await Promise.resolve();
    });

    // 완료된 뒤에도 마찬가지 — 게시 상태는 바뀌었지만 폼은 손대지 않았다.
    expect(
      document.querySelector('[aria-label="프로그램 편집 불러오는 중"]'),
    ).toBeNull();
    expect(
      container.querySelector<HTMLInputElement>('#program-name')?.value,
    ).toBe('저장 안 한 이름');
    expect(getButton('다시 게시하기')).toBeTruthy();
    expect(container.textContent).toContain('내림');
  });

  // Addition 1 + 2 — 게시 상태 전환 실패는 여태 마운트 테스트가 없었다. 실패
  // 메시지가 generalAlert(페이지 맨 위)가 아니라 게시 상태 섹션 안, 버튼과
  // 같은 자리에 뜨는지, 다이얼로그가 닫히고 버튼이 다시 눌릴 수 있는지,
  // lifecycle 값 자체는 바뀌지 않았는지를 실제 DOM으로 확인한다.
  it('게시 상태 전환이 실패하면 다이얼로그를 닫고 게시 상태 섹션 안에 에러를 보여주며 버튼을 되살린다', async () => {
    getEditableProgramMock.mockResolvedValue(editableProgram);
    updateProgramLifecycleMock.mockRejectedValue(new TypeError('network'));

    await act(async () => {
      root.render(
        <ProgramEditPage programId="program-1" canDeleteProgram={false} />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      getButton('프로그램 내리기').click();
    });
    await act(async () => {
      getButton('내리기').click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // 다이얼로그는 닫혔다 — 실패해도 열린 채 멈추지 않는다.
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();

    // 버튼은 다시 눌러 볼 수 있는 상태로 돌아온다 — 「내리는 중…」에 갇히지 않는다.
    const retryButton = getButton('프로그램 내리기');
    expect(retryButton.disabled).toBe(false);

    // lifecycle 값 자체는 바뀌지 않았다 — 여전히 PUBLISHED다.
    expect(queryButton('다시 게시하기')).toBeUndefined();
    expect(container.textContent).not.toContain('내림');

    // 에러는 게시 상태 섹션 안, 그 버튼과 같은 자리에 뜬다 — 페이지 맨 위
    // generalAlert 자리가 아니다.
    const alerts = Array.from(document.querySelectorAll('[role="alert"]'));
    const lifecycleAlert = alerts.find((alert) =>
      alert.textContent?.includes(
        '상태를 변경하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      ),
    );
    expect(lifecycleAlert).toBeTruthy();
    const section = lifecycleAlert?.closest('section');
    expect(section?.textContent).toContain('게시 상태');
    expect(section?.contains(retryButton)).toBe(true);
  });

  // 리뷰에서 발견된 기본 폼만 지키던 간극 — 열려 있는 마일스톤 편집기에 저장
  // 안 한 입력이 있어도 나가기 링크가 그냥 통과했다. #867 요건 7(나가기 보호)은
  // 마일스톤 편집도 포함해야 한다.
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
    )?.set;
    await act(async () => {
      setter?.call(nameInput, '아직 저장 안 한 마일스톤');
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
    // confirmMock은 beforeEach에서 false를 돌려주므로 이동은 막힌다.
    expect(routerPushMock).not.toHaveBeenCalled();
  });

  // #1095 — canDeleteProgram은 셸(ProgramEditRoute)이 교직원 또는 관리자로 판정해 이
  // 페이지로 넘기는 값이다(종전 #875에서는 ADMIN 전용이었다).
  // 페이지는 그 값을 그대로 ProgramEditView에 전달해 위험 영역 노출을 가른다.
  it('canDeleteProgram={true}면 위험 영역 섹션을 그린다', async () => {
    getEditableProgramMock.mockResolvedValue(editableProgram);

    await act(async () => {
      root.render(<ProgramEditPage programId="program-1" canDeleteProgram />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain('위험 영역');
    expect(queryButton('프로그램 영구 삭제')).toBeTruthy();
  });

  it('canDeleteProgram={false}면 삭제 버튼 없이 아카이브 안내를 그린다', async () => {
    getEditableProgramMock.mockResolvedValue(editableProgram);

    await act(async () => {
      root.render(
        <ProgramEditPage programId="program-1" canDeleteProgram={false} />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain('위험 영역');
    expect(container.textContent).toContain('아카이브');
    expect(queryButton('프로그램 영구 삭제')).toBeUndefined();
    expect(queryButton('연결 데이터까지 모두 삭제')).toBeUndefined();
  });
});
