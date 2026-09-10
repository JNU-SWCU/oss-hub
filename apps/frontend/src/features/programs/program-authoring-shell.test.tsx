// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ProgramAuthoringShell } from './program-authoring-shell';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

it('필수 정보가 준비되지 않은 단계는 이동할 수 없고 준비되면 활성화된다', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const onNavigate = vi.fn();
  const render = async (disabled: boolean) => {
    await act(async () => {
      root.render(
        <ProgramAuthoringShell
          currentStep="information"
          title="합성 프로그램 신청"
          description=""
          steps={[
            { id: 'information', label: '신청 정보' },
            { id: 'composition', label: '팀 구성·제출', disabled },
          ]}
          onNavigate={onNavigate}
        >
          <p>합성 신청 내용</p>
        </ProgramAuthoringShell>,
      );
    });
  };
  const compositionButton = () => {
    const button = container.querySelectorAll<HTMLButtonElement>(
      'nav[aria-label="작성 단계"] button',
    )[1];
    if (!button) throw new Error('Composition step button is missing');
    return button;
  };
  try {
    await render(true);
    expect(compositionButton().disabled).toBe(true);
    await act(async () => compositionButton().click());
    expect(onNavigate).not.toHaveBeenCalled();

    await render(false);
    expect(compositionButton().disabled).toBe(false);
    await act(async () => compositionButton().click());
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith('composition');
    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(container.textContent).not.toContain('프로그램이 생성되지 않습니다');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
