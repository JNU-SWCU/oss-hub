// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { completedAuthoringState } from './program-creation-test-fixtures';
import {
  PROGRAM_AUTHORING_STORAGE_KEY,
  serializeProgramAuthoringState,
} from './program-authoring-storage';

const mocks = vi.hoisted(() => ({
  createAuthoringProgram: vi.fn(),
  deleteAuthoringUpload: vi.fn(),
  uploadAuthoringFile: vi.fn(),
  completeAndNavigate: vi.fn(),
  useProgramExitGuard: vi.fn(),
}));

vi.mock('./program-authoring-api', () => ({
  createAuthoringProgram: mocks.createAuthoringProgram,
  deleteAuthoringUpload: mocks.deleteAuthoringUpload,
  uploadAuthoringFile: mocks.uploadAuthoringFile,
}));

vi.mock('./use-program-exit-guard', () => ({
  useProgramExitGuard: (dirty: boolean) => {
    mocks.useProgramExitGuard(dirty);
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
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('renders all six Korean steps with sidebar and compact progress without an API call', async () => {
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
    expect(mocks.createAuthoringProgram).not.toHaveBeenCalled();
    expect(mocks.uploadAuthoringFile).not.toHaveBeenCalled();
  });

  it('does not call any Program API until final confirmation', async () => {
    // Given
    sessionStorage.setItem(
      PROGRAM_AUTHORING_STORAGE_KEY,
      serializeProgramAuthoringState(completedAuthoringState()),
    );
    mocks.createAuthoringProgram.mockResolvedValue({ id: 'program-created' });

    await act(async () => {
      root.render(<ProgramCreationPage />);
      await Promise.resolve();
    });

    // When
    await act(async () => buttonNamed('최종 검토').click());
    await act(async () => buttonNamed('프로그램 만들기').click());

    // Then
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(mocks.createAuthoringProgram).not.toHaveBeenCalled();

    await act(async () => {
      buttonNamed('생성 확정').click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.createAuthoringProgram).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(PROGRAM_AUTHORING_STORAGE_KEY)).toBeNull();
    expect(mocks.completeAndNavigate).toHaveBeenCalledWith(
      '/programs/program-created',
    );
  });

  it('keeps an untouched form clean when navigating between steps', async () => {
    await act(async () => root.render(<ProgramCreationPage />));

    await act(async () => buttonNamed('기본 정보').click());

    expect(mocks.useProgramExitGuard).toHaveBeenLastCalledWith(false);
  });

  it('입력은 자동 저장하지 않고 사용자가 임시 저장을 눌렀을 때만 복구본을 만든다', async () => {
    await act(async () => root.render(<ProgramCreationPage />));
    await act(async () => buttonNamed('기본 정보').click());

    const name = container.querySelector<HTMLInputElement>('#program-name');
    if (name === null) throw new TypeError('Missing program name input.');
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set;
    await act(async () => {
      setter?.call(name, '사용자가 저장할 프로그램');
      name.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(sessionStorage.getItem(PROGRAM_AUTHORING_STORAGE_KEY)).toBeNull();

    await act(async () => buttonNamed('임시 저장').click());

    expect(
      sessionStorage.getItem(PROGRAM_AUTHORING_STORAGE_KEY),
    ).not.toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      '임시 저장했습니다',
    );
  });

  it('일정 단계에서 잘못된 마일스톤 날짜를 막고 해당 입력으로 이동한다', async () => {
    const completed = completedAuthoringState();
    sessionStorage.setItem(
      PROGRAM_AUTHORING_STORAGE_KEY,
      serializeProgramAuthoringState({
        ...completed,
        currentStep: 'schedule',
        milestones: [
          {
            ...completed.milestones[0],
            dueAt: '2026-10-01T18:00',
          },
        ],
      }),
    );

    await act(async () => {
      root.render(<ProgramCreationPage />);
      await Promise.resolve();
    });
    await act(async () => buttonNamed('저장하고 계속').click());

    expect(container.textContent).toContain(
      '마감은 시작보다 늦고 운영 종료보다 빨라야 합니다.',
    );
    expect(document.activeElement).toBe(
      container.querySelector('#milestone-1-due'),
    );
    expect(container.textContent).toContain('신청/운영 일정');
  });

  it('최종 검토에서 날짜 오류를 발견해도 일정 화면의 문제 입력으로 돌아간다', async () => {
    const completed = completedAuthoringState();
    sessionStorage.setItem(
      PROGRAM_AUTHORING_STORAGE_KEY,
      serializeProgramAuthoringState({
        ...completed,
        milestones: [
          {
            ...completed.milestones[0],
            dueAt: '2026-10-01T18:00',
          },
        ],
      }),
    );

    await act(async () => {
      root.render(<ProgramCreationPage />);
      await Promise.resolve();
    });
    await act(async () => buttonNamed('프로그램 만들기').click());

    expect(container.textContent).toContain('신청/운영 일정');
    expect(document.activeElement).toBe(
      container.querySelector('#milestone-1-due'),
    );
  });
});
