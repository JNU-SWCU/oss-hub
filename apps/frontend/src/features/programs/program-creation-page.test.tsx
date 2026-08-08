// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createProgram: vi.fn(),
  leavePage: vi.fn(),
  completeAndNavigate: vi.fn(),
  listApplicationTemplates: vi.fn(async () => []),
}));

vi.mock('./api', () => ({
  createProgram: mocks.createProgram,
  listApplicationTemplates: mocks.listApplicationTemplates,
}));

vi.mock('./use-program-exit-guard', () => ({
  useProgramExitGuard: () => ({
    leavePage: mocks.leavePage,
    completeAndNavigate: mocks.completeAndNavigate,
  }),
}));

import { ProgramCreationPage } from './program-creation-page';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

describe('ProgramCreationPage 유형 선택 대화상자', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.createProgram.mockReset();
    mocks.leavePage.mockReset();
    mocks.completeAndNavigate.mockReset();
    mocks.listApplicationTemplates.mockClear();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('다시 연 대화상자를 Escape로 닫으면 실제 호출 버튼으로 초점을 돌린다', async () => {
    await act(async () => {
      root.render(<ProgramCreationPage />);
      await Promise.resolve();
    });

    const firstOption = document.querySelector<HTMLInputElement>(
      'input[name="program-category"]',
    );
    if (firstOption === null) {
      throw new TypeError('프로그램 유형 선택지를 찾지 못했습니다.');
    }
    await act(async () => firstOption.click());

    const continueButton = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === '이 유형으로 계속',
    );
    if (continueButton === undefined) {
      throw new TypeError('유형 선택 완료 버튼을 찾지 못했습니다.');
    }
    await act(async () => continueButton.click());

    const returnButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '유형 다시 선택',
    );
    if (returnButton === undefined) {
      throw new TypeError('유형 다시 선택 버튼을 찾지 못했습니다.');
    }
    await act(async () => returnButton.click());

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    if (dialog === null) {
      throw new TypeError('다시 연 프로그램 유형 대화상자를 찾지 못했습니다.');
    }
    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(returnButton);
  });
});
