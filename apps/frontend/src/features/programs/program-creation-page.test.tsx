// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { completedAuthoringState } from './program-creation-test-fixtures';
import {
  PROGRAM_AUTHORING_RECOVERY_KEY,
  loadProgramAuthoringRecoveryKey,
} from './program-authoring-storage';

const mocks = vi.hoisted(() => ({
  createAuthoringProgram: vi.fn(),
  deleteAuthoringUpload: vi.fn(),
  uploadAuthoringFile: vi.fn(),
  completeAndNavigate: vi.fn(),
  useProgramExitGuard: vi.fn(),
  discardUnsaved: undefined as (() => void) | undefined,
}));

vi.mock('./program-authoring-api', () => ({
  createAuthoringProgram: mocks.createAuthoringProgram,
  deleteAuthoringUpload: mocks.deleteAuthoringUpload,
  uploadAuthoringFile: mocks.uploadAuthoringFile,
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

  beforeEach(() => {
    sessionStorage.clear();
    mocks.createAuthoringProgram.mockReset();
    mocks.deleteAuthoringUpload.mockReset();
    mocks.uploadAuthoringFile.mockReset();
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

  it('renders all six Korean steps without draft controls or restoration copy', async () => {
    sessionStorage.setItem(
      'oss-hub:program-authoring',
      JSON.stringify(completedAuthoringState()),
    );

    await act(async () => root.render(<ProgramCreationPage />));

    for (const label of [
      '유형',
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

  it('does not call any Program API until final confirmation and clears recovery after success', async () => {
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

  it('필드 오류가 있으면 입력 옆에만 표시하고 중복 요약 경고는 만들지 않는다', async () => {
    await act(async () => root.render(<ProgramCreationPage />));
    await act(async () => buttonNamed('기본 정보').click());
    await act(async () => buttonNamed('계속').click());

    expect(container.textContent).toContain('주관기관을 입력해 주세요.');
    expect(container.textContent).not.toContain('입력 내용을 확인해 주세요');
    expect(container.textContent).not.toContain('표시된 입력란을 고친 뒤');
  });

  it('navigates without persisting dirty form content', async () => {
    await act(async () => root.render(<ProgramCreationPage />));
    await act(async () => buttonNamed('기본 정보').click());

    const name = container.querySelector<HTMLInputElement>('#program-name');
    if (name === null) throw new TypeError('Missing program name input.');
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set;
    await act(async () => {
      setter?.call(name, '계속 작성할 프로그램');
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

  it('stores only a rotated recovery key after an idempotency conflict', async () => {
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
    expect(recoveryKey).not.toBe(completed.idempotencyKey);
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
});
