import { act } from 'react';
import type { Root } from 'react-dom/client';
import { createListScreenRoot as createRoot } from '../../../../test-support/list-screen-root';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import type { ProgramAuthoringState } from './program-authoring-model';
import { completedAuthoringState } from './program-creation-test-fixtures';
import {
  PROGRAM_AUTHORING_RECOVERY_KEY,
  loadProgramAuthoringRecoveryKey,
} from './program-authoring-storage';

const mocks = vi.hoisted(() => ({
  createAuthoringProgram:
    vi.fn<typeof import('./program-authoring-api').createAuthoringProgram>(),
  deleteAuthoringUpload: vi.fn(),
  uploadAuthoringFile: vi.fn(),
  uploadProgramCover: vi.fn(),
  getAuthoringUploadPolicy: vi.fn(),
  completeAndNavigate: vi.fn(),
  useProgramExitGuard: vi.fn(),
  previewProgramNotice: vi.fn(),
  discardUnsaved: undefined as (() => void) | undefined,
}));

vi.mock('./program-notice-api', () => ({
  previewProgramNotice: mocks.previewProgramNotice,
}));

vi.mock('./program-authoring-api', () => ({
  uploadProgramCover: mocks.uploadProgramCover,
  createAuthoringProgram: mocks.createAuthoringProgram,
  deleteAuthoringUpload: mocks.deleteAuthoringUpload,
  uploadAuthoringFile: mocks.uploadAuthoringFile,
  getAuthoringUploadPolicy: mocks.getAuthoringUploadPolicy,
}));

vi.mock('./use-program-exit-guard', () => ({
  useProgramExitGuard: (dirty: boolean, discardUnsaved: () => void) => {
    mocks.useProgramExitGuard(dirty);
    mocks.discardUnsaved = discardUnsaved;
    return {
      completeAndNavigate: mocks.completeAndNavigate,
    };
  },
}));

import { ProgramCreationPage } from './program-creation-page';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

function buttonNamed(name: string): HTMLButtonElement {
  const button = [...document.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(name),
  );
  if (button === undefined) throw new TypeError(`button not found: ${name}`);
  return button;
}

describe('ProgramCreationPage guided authoring', () => {
  let container: HTMLDivElement;
  let root: Root;

  function trackOption(name: string): HTMLInputElement {
    const option = [
      ...container.querySelectorAll<HTMLInputElement>(
        '[role="radiogroup"] input[type="radio"]',
      ),
    ].find((candidate) => candidate.closest('label')?.textContent === name);
    if (option === undefined)
      throw new TypeError(`track option not found: ${name}`);
    return option;
  }

  function labelledButton(name: string): HTMLButtonElement {
    const button = container.querySelector<HTMLButtonElement>(
      `button[aria-label="${name}"]`,
    );
    if (button === null) throw new TypeError(`button not found: ${name}`);
    return button;
  }

  function teamSizeInput(bound: 'min' | 'max'): HTMLInputElement {
    const input = container.querySelector<HTMLInputElement>(
      `#program-team-${bound}-size`,
    );
    if (input === null) throw new TypeError(`missing team ${bound} size`);
    return input;
  }

  async function typeTeamSize(bound: 'min' | 'max', text: string) {
    const input = teamSizeInput(bound);
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set?.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  async function renderBasicStep(
    overrides: Partial<ProgramAuthoringState> = {},
  ) {
    await act(async () =>
      root.render(
        <ProgramCreationPage
          initialState={{
            ...completedAuthoringState(),
            currentStep: 'basic',
            ...overrides,
          }}
        />,
      ),
    );
  }

  async function createFromReview() {
    await act(async () => buttonNamed('최종 검토').click());
    await act(async () => buttonNamed('프로그램 만들기').click());
    await act(async () => buttonNamed('생성 확정').click());
    return mocks.createAuthoringProgram.mock.calls[0]?.[0];
  }

  beforeEach(() => {
    sessionStorage.clear();
    mocks.createAuthoringProgram.mockReset();
    mocks.deleteAuthoringUpload.mockReset();
    mocks.uploadAuthoringFile.mockReset();
    mocks.uploadProgramCover.mockReset();
    mocks.getAuthoringUploadPolicy.mockReset().mockResolvedValue({
      fileUpload: { maxBytes: 5 * 1024 * 1024, maxLabel: '5 MB' },
    });
    mocks.completeAndNavigate.mockClear();
    mocks.useProgramExitGuard.mockClear();
    mocks.discardUnsaved = undefined;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('renders all five Korean steps without draft controls or restoration copy', async () => {
    sessionStorage.setItem(
      'oss-hub:program-authoring',
      JSON.stringify(completedAuthoringState()),
    );

    await act(async () => root.render(<ProgramCreationPage />));

    for (const label of [
      '기본 정보',
      '신청/운영 일정',
      '마일스톤',
      '운영 설정',
      '최종 검토',
    ]) {
      expect(container.textContent).toContain(label);
    }
    expect(container.querySelector('[aria-label="작성 단계"]')).not.toBeNull();
    expect(
      container.querySelector('[aria-label="작성 진행률"]'),
    ).not.toBeNull();
    expect(container.textContent).not.toContain('임시 저장');
    expect(container.textContent).not.toContain('저장하고 계속');
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(mocks.createAuthoringProgram).not.toHaveBeenCalled();
    expect(mocks.uploadAuthoringFile).not.toHaveBeenCalled();
  });

  it.each([
    new TypeError('policy unavailable'),
    new SyntaxError('invalid JSON'),
  ])(
    '업로드 제한을 못 받으면 작성 대신 재시도를 보이고 복구한다: %s',
    async (error) => {
      mocks.getAuthoringUploadPolicy.mockRejectedValueOnce(error);
      await act(async () => root.render(<ProgramCreationPage />));
      expect(container.textContent).toContain(
        '파일 업로드 제한을 불러오지 못했습니다.',
      );
      expect(container.querySelector('input[type="file"]')).toBeNull();
      await act(async () => buttonNamed('다시 불러오기').click());
      expect(container.textContent).toContain('기본 정보');
      expect(mocks.getAuthoringUploadPolicy).toHaveBeenCalledTimes(2);
    },
  );

  it('동시에 열린 작성 화면은 업로드 정책 요청을 공유한다', async () => {
    await act(async () =>
      root.render(
        <>
          <ProgramCreationPage />
          <ProgramCreationPage />
        </>,
      ),
    );

    expect(container.querySelectorAll('[aria-label="작성 단계"]')).toHaveLength(
      2,
    );
    expect(mocks.getAuthoringUploadPolicy).toHaveBeenCalledTimes(1);
  });

  it('does not mutate programs until final confirmation and clears recovery after success', async () => {
    mocks.createAuthoringProgram.mockResolvedValue({ id: 'program-created' });
    sessionStorage.setItem(PROGRAM_AUTHORING_RECOVERY_KEY, 'request-recovery');

    await act(async () => {
      root.render(
        <ProgramCreationPage initialState={completedAuthoringState()} />,
      );
      await Promise.resolve();
    });

    await act(async () => buttonNamed('프로그램 만들기').click());

    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(mocks.createAuthoringProgram).not.toHaveBeenCalled();

    await act(async () => {
      buttonNamed('생성 확정').click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.createAuthoringProgram).toHaveBeenCalledTimes(1);
    expect(mocks.createAuthoringProgram).toHaveBeenCalledWith(
      expect.anything(),
      'request-recovery',
    );
    expect(sessionStorage.getItem(PROGRAM_AUTHORING_RECOVERY_KEY)).toBeNull();
    expect(mocks.completeAndNavigate).toHaveBeenCalledWith(
      '/programs/program-created',
    );
  });

  it('keeps an untouched form clean when navigating between steps', async () => {
    await act(async () => root.render(<ProgramCreationPage />));

    await act(async () => buttonNamed('기본 정보').click());

    expect(mocks.useProgramExitGuard).toHaveBeenLastCalledWith(false);
    mocks.discardUnsaved?.();
    expect(sessionStorage.getItem(PROGRAM_AUTHORING_RECOVERY_KEY)).toBeNull();
  });

  it('applies a notice to editable fields and only persists its external cover after final confirmation', async () => {
    const sourceUrl = 'https://sojoong.kr/notice/?uid=42&mod=document';
    const imageUrl = 'https://sojoong.kr/wp-content/uploads/poster.jpg';
    const description = '합성 프로그램 안내\n\n운영 일정\n- 합성 활동';
    mocks.previewProgramNotice.mockResolvedValueOnce({
      sourceUrl,
      name: '가져온 합성 프로그램',
      description,
      coverImages: [imageUrl],
      warnings: [],
    });
    mocks.createAuthoringProgram.mockResolvedValueOnce({
      id: 'notice-created',
    });
    const initial = {
      ...completedAuthoringState(),
      currentStep: 'basic' as const,
    };
    await act(async () =>
      root.render(<ProgramCreationPage initialState={initial} />),
    );
    await act(async () => buttonNamed('공지에서 가져오기').click());
    const url = document.querySelector<HTMLInputElement>('input[type="url"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set?.call(url, sourceUrl);
      url?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => buttonNamed('불러오기').click());
    await act(async () =>
      document
        .querySelector<HTMLInputElement>('input[name="notice-description"]')
        ?.click(),
    );
    await act(async () => buttonNamed('선택한 내용 적용').click());
    expect(container.querySelector('textarea')?.value).toBe(description);
    expect(
      container
        .querySelector('[data-slot="program-cover-preview"] img')
        ?.getAttribute('src'),
    ).toBe(imageUrl);
    expect(mocks.createAuthoringProgram).not.toHaveBeenCalled();
    await act(async () => buttonNamed('최종 검토').click());
    expect(container.textContent).toContain('공지에서 가져온 이미지');
    await act(async () => buttonNamed('프로그램 만들기').click());
    expect(mocks.createAuthoringProgram).not.toHaveBeenCalled();
    await act(async () => buttonNamed('생성 확정').click());
    const sent = mocks.createAuthoringProgram.mock.calls[0]?.[0];
    expect(sent).toMatchObject({
      name: initial.name,
      description,
      externalCover: { sourceUrl, imageUrl },
    });
    expect(sent).not.toHaveProperty('coverUploadId');
    expect(sent?.milestones).toHaveLength(initial.milestones.length);
  });

  it('필드 오류가 있으면 입력 옆에만 표시하고 중복 요약 경고는 만들지 않는다', async () => {
    await act(async () => root.render(<ProgramCreationPage />));
    await act(async () => buttonNamed('기본 정보').click());
    await act(async () => buttonNamed('계속').click());

    expect(container.textContent).toContain('프로그램명을 입력해 주세요.');
    expect(container.textContent).not.toContain('입력 내용을 확인해 주세요');
    expect(container.textContent).not.toContain('표시된 입력란을 고친 뒤');
  });

  it('새 프로그램은 SW중심대학사업단 라벨로 시작하고, 모두 지우면 계속을 막는다', async () => {
    await act(async () => root.render(<ProgramCreationPage />));
    await act(async () => buttonNamed('기본 정보').click());

    const remove = container.querySelector<HTMLButtonElement>(
      'button[aria-label="전남대학교 SW중심대학사업단 삭제"]',
    );
    if (remove === null) throw new TypeError('Missing default organizer chip.');
    await act(async () => remove.click());
    await act(async () => buttonNamed('계속').click());

    expect(container.textContent).toContain(
      '주관기관을 1개 이상 입력해 주세요.',
    );
    expect(container.querySelector('#authoring-organizers')).not.toBeNull();
    expect(mocks.useProgramExitGuard).toHaveBeenLastCalledWith(true);
  });

  it('서버가 organizers 필드 오류를 돌려주면 기본 정보 단계의 주관기관 입력 옆에 보여준다', async () => {
    const completed = completedAuthoringState();
    mocks.createAuthoringProgram.mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'Bad Request',
        status: 400,
        detail: '입력값을 확인해 주세요.',
        instance: '/program-authoring/programs',
        code: 'PRG_001',
        fieldErrors: [
          {
            field: 'organizers',
            code: 'PRG_001',
            message: '주관기관은 10개까지 입력할 수 있습니다.',
          },
        ],
      }),
    );
    await act(async () =>
      root.render(<ProgramCreationPage initialState={completed} />),
    );
    await act(async () => buttonNamed('프로그램 만들기').click());
    await act(async () => buttonNamed('생성 확정').click());

    const field = container.querySelector<HTMLInputElement>(
      '#authoring-organizers',
    );
    expect(field?.getAttribute('aria-invalid')).toBe('true');
    expect(
      container.querySelector('#authoring-organizers-error')?.textContent,
    ).toBe('주관기관은 10개까지 입력할 수 있습니다.');
    expect(container.textContent).not.toContain('프로그램 생성에 실패했습니다');
    expect(mocks.completeAndNavigate).not.toHaveBeenCalled();
  });

  it('navigates without persisting dirty form content', async () => {
    await act(async () => root.render(<ProgramCreationPage />));
    await act(async () => buttonNamed('기본 정보').click());

    const name = container.querySelector<HTMLInputElement>('#program-name');
    if (name === null) throw new TypeError('Missing program name input.');
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    );
    await act(async () => {
      setter?.set?.call(name, '계속 작성할 프로그램');
      name.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => buttonNamed('계속').click());

    expect(container.textContent).toContain('신청/운영 일정');
    expect(sessionStorage.getItem(PROGRAM_AUTHORING_RECOVERY_KEY)).toBeNull();
    expect(mocks.useProgramExitGuard).toHaveBeenLastCalledWith(true);
  });

  it('마일스톤 단계에서 잘못된 날짜를 막고 편집 팝업을 연다', async () => {
    const completed = completedAuthoringState();
    await act(async () => {
      root.render(
        <ProgramCreationPage
          initialState={{
            ...completed,
            currentStep: 'milestones',
            milestones: [
              {
                ...completed.milestones[0],
                dueAt: '2026-10-01T18:00',
              },
            ],
          }}
        />,
      );
    });
    await act(async () => buttonNamed('계속').click());

    expect(document.body.textContent).toContain(
      '기간은 운영 기간 안에 있어야 합니다.',
    );
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.textContent).toContain('마일스톤 일정');
  });

  it('마일스톤 날짜가 비었으면 비활성 시각 입력 대신 날짜 달력으로 이동한다', async () => {
    const completed = completedAuthoringState();
    await act(async () => {
      root.render(
        <ProgramCreationPage
          initialState={{
            ...completed,
            currentStep: 'milestones',
            milestones: [
              {
                ...completed.milestones[0],
                startAt: '',
                dueAt: '',
              },
            ],
          }}
        />,
      );
    });

    await act(async () => buttonNamed('계속').click());

    expect(document.body.textContent).toContain('기간을 입력해 주세요.');
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.contains(document.activeElement)).toBe(true);
  });

  it('preserves the recovery key after an idempotency conflict', async () => {
    const completed = completedAuthoringState();
    mocks.createAuthoringProgram.mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        detail: '이미 사용한 요청입니다.',
        instance: '/programs',
        code: 'PRG_015',
      }),
    );
    await act(async () => {
      root.render(<ProgramCreationPage initialState={completed} />);
      await Promise.resolve();
    });
    await act(async () => buttonNamed('프로그램 만들기').click());
    await act(async () => {
      buttonNamed('생성 확정').click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const recoveryKey = loadProgramAuthoringRecoveryKey(sessionStorage);
    expect(recoveryKey).toBe(completed.idempotencyKey);
    expect(sessionStorage.getItem(PROGRAM_AUTHORING_RECOVERY_KEY)).toBe(
      recoveryKey,
    );
    expect(
      sessionStorage.getItem(PROGRAM_AUTHORING_RECOVERY_KEY),
    ).not.toContain('milestones');
    expect(mocks.useProgramExitGuard).toHaveBeenLastCalledWith(false);
    mocks.discardUnsaved?.();
    expect(sessionStorage.getItem(PROGRAM_AUTHORING_RECOVERY_KEY)).toBeNull();
  });

  it('opens the scoped existing program without creating a new request after a conflict', async () => {
    const completed = completedAuthoringState();
    const problem = {
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
      detail: '이미 생성된 프로그램을 확인해 주세요.',
      instance: '/program-authoring/programs',
      code: 'PRG_017',
      existingProgramId: 'seed:e2e:existing-program',
    };
    mocks.createAuthoringProgram.mockRejectedValue(new ApiError(problem));
    await act(async () =>
      root.render(<ProgramCreationPage initialState={completed} />),
    );
    await act(async () => buttonNamed('프로그램 만들기').click());
    await act(async () => buttonNamed('생성 확정').click());

    await act(async () => buttonNamed('기존 프로그램 확인').click());

    expect(mocks.completeAndNavigate).toHaveBeenCalledWith(
      '/programs/seed%3Ae2e%3Aexisting-program',
    );
    expect(mocks.createAuthoringProgram).toHaveBeenCalledTimes(1);
    expect(mocks.createAuthoringProgram.mock.calls[0]?.[1]).toBe(
      completed.idempotencyKey,
    );
  });

  it('waits for prepared upload cleanup before opening the existing program', async () => {
    const coverFile = new File(['synthetic-png'], 'cover.png', {
      type: 'image/png',
    });
    const completed = { ...completedAuthoringState(), coverFile };
    mocks.uploadProgramCover.mockResolvedValue({
      id: 'pending-cover',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    mocks.createAuthoringProgram.mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        detail: '이미 생성된 프로그램을 확인해 주세요.',
        instance: '/program-authoring/programs',
        code: 'PRG_017',
        ...{ existingProgramId: 'existing-program' },
      }),
    );
    let finishCleanup: (() => void) | undefined;
    mocks.deleteAuthoringUpload.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishCleanup = resolve;
        }),
    );
    await act(async () =>
      root.render(<ProgramCreationPage initialState={completed} />),
    );
    await act(async () => buttonNamed('프로그램 만들기').click());
    await act(async () => buttonNamed('생성 확정').click());

    await act(async () => buttonNamed('기존 프로그램 확인').click());
    expect(mocks.deleteAuthoringUpload).toHaveBeenCalledExactlyOnceWith(
      'pending-cover',
    );
    expect(mocks.completeAndNavigate).not.toHaveBeenCalled();

    await act(async () => finishCleanup?.());
    expect(mocks.completeAndNavigate).toHaveBeenCalledExactlyOnceWith(
      '/programs/existing-program',
    );
    expect(loadProgramAuthoringRecoveryKey(sessionStorage)).toBeNull();
    expect(mocks.createAuthoringProgram).toHaveBeenCalledTimes(1);
  });

  it('hides the existing program link when a retry fails differently', async () => {
    const completed = completedAuthoringState();
    const problem = {
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
      detail: '이미 생성된 프로그램을 확인해 주세요.',
      instance: '/program-authoring/programs',
      code: 'PRG_017',
      existingProgramId: 'existing-program',
    };
    mocks.createAuthoringProgram
      .mockRejectedValueOnce(new ApiError(problem))
      .mockRejectedValueOnce(new TypeError('network closed'));
    await act(async () =>
      root.render(<ProgramCreationPage initialState={completed} />),
    );
    await act(async () => buttonNamed('프로그램 만들기').click());
    await act(async () => buttonNamed('생성 확정').click());
    expect(document.body.textContent).toContain('기존 프로그램 확인');

    await act(async () => buttonNamed('프로그램 만들기').click());
    await act(async () => buttonNamed('생성 확정').click());

    expect(document.body.textContent).not.toContain('기존 프로그램 확인');
  });

  it('keeps the request key after an uncertain network response', async () => {
    const completed = completedAuthoringState();
    mocks.createAuthoringProgram.mockRejectedValue(
      new TypeError('network closed'),
    );
    await act(async () =>
      root.render(<ProgramCreationPage initialState={completed} />),
    );
    await act(async () => buttonNamed('프로그램 만들기').click());
    await act(async () => buttonNamed('생성 확정').click());

    expect(loadProgramAuthoringRecoveryKey(sessionStorage)).toBe(
      completed.idempotencyKey,
    );
  });

  it('최종 검토에서 날짜 오류를 발견하면 마일스톤 편집으로 돌아간다', async () => {
    const completed = completedAuthoringState();
    await act(async () => {
      root.render(
        <ProgramCreationPage
          initialState={{
            ...completed,
            milestones: [
              {
                ...completed.milestones[0],
                dueAt: '2026-10-01T18:00',
              },
            ],
          }}
        />,
      );
    });
    await act(async () => buttonNamed('프로그램 만들기').click());
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain(
        '기간은 운영 기간 안에 있어야 합니다.',
      ),
    );

    expect(container.textContent).toContain('마일스톤 일정');
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('교과/비교과를 선택 목록 없이 두 선택지로 고르고 그 값으로 프로그램을 만든다', async () => {
    mocks.createAuthoringProgram.mockResolvedValue({ id: 'program-created' });
    await renderBasicStep();

    expect(container.querySelector('select')).toBeNull();
    expect(trackOption('비교과').checked).toBe(true);

    await act(async () => trackOption('교과').click());
    expect(trackOption('교과').checked).toBe(true);
    expect(trackOption('비교과').checked).toBe(false);

    expect(await createFromReview()).toMatchObject({
      trackType: 'CURRICULAR',
    });
  });

  it('교과/비교과를 고르지 않고 계속하면 첫 선택지로 초점을 옮겨 그 자리에서 고칠 수 있다', async () => {
    await renderBasicStep({ trackType: '' });
    buttonNamed('계속').focus();
    await act(async () => buttonNamed('계속').click());

    const group = container.querySelector('[role="radiogroup"]');
    expect(group?.getAttribute('aria-invalid')).toBe('true');
    expect(group?.getAttribute('aria-describedby')).toBe(
      'program-track-type-error',
    );
    expect(container.querySelector('#program-track-type-error')).not.toBeNull();
    expect(document.activeElement).toBe(trackOption('교과'));

    await act(async () => trackOption('교과').click());
    expect(trackOption('교과').checked).toBe(true);
    expect(container.querySelector('#program-track-type-error')).toBeNull();
  });

  it('늘리기·줄이기 버튼으로 인원을 정하고 최소 인원은 1 아래로 내려가지 않는다', async () => {
    mocks.createAuthoringProgram.mockResolvedValue({ id: 'program-created' });
    await renderBasicStep();
    expect(teamSizeInput('min').value).toBe('1');
    expect(labelledButton('최소 인원 줄이기').disabled).toBe(true);

    await act(async () => labelledButton('최소 인원 늘리기').click());
    await act(async () => labelledButton('최대 인원 늘리기').click());
    expect(teamSizeInput('min').value).toBe('2');
    expect(teamSizeInput('max').value).toBe('5');

    await act(async () => labelledButton('최소 인원 줄이기').click());
    expect(teamSizeInput('min').value).toBe('1');
    expect(labelledButton('최소 인원 줄이기').disabled).toBe(true);

    expect(await createFromReview()).toMatchObject({
      teamMinSize: 1,
      teamMaxSize: 5,
    });
  });

  it('지수 표기로 적은 인원도 만들 때 보내는 숫자와 같게 읽어 한 명씩 줄인다', async () => {
    mocks.createAuthoringProgram.mockResolvedValue({ id: 'program-created' });
    await renderBasicStep();

    await typeTeamSize('max', '1e1');
    await act(async () => labelledButton('최대 인원 줄이기').click());
    expect(teamSizeInput('max').value).toBe('9');

    expect(await createFromReview()).toMatchObject({ teamMaxSize: 9 });
  });

  it('인원이 모두 범위를 벗어나면 두 칸을 표시하고 첫 칸으로 초점을 옮긴다', async () => {
    await renderBasicStep();
    await typeTeamSize('min', '0');
    await typeTeamSize('max', '101');
    await act(async () => buttonNamed('계속').click());

    expect(teamSizeInput('min').getAttribute('aria-invalid')).toBe('true');
    expect(teamSizeInput('max').getAttribute('aria-invalid')).toBe('true');
    expect(teamSizeInput('min').getAttribute('aria-describedby')).toBe(
      'program-team-size-error',
    );
    expect(
      container.querySelectorAll('#program-team-size-error li'),
    ).toHaveLength(2);
    expect(document.activeElement).toBe(teamSizeInput('min'));
  });

  it('최대 인원만 틀리면 그 칸만 표시하고 그 칸으로 초점을 옮긴다', async () => {
    await renderBasicStep();
    await typeTeamSize('min', '3');
    await typeTeamSize('max', '2');
    await act(async () => buttonNamed('계속').click());

    expect(teamSizeInput('min').getAttribute('aria-invalid')).toBe('false');
    expect(teamSizeInput('max').getAttribute('aria-invalid')).toBe('true');
    expect(container.querySelector('#program-team-size-error')).not.toBeNull();
    expect(
      container.querySelectorAll('#program-team-size-error li'),
    ).toHaveLength(0);
    expect(document.activeElement).toBe(teamSizeInput('max'));
  });
});
