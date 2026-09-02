// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixStageNavigation } from './components/submission-matrix-stage-navigation';
import type { MatrixMilestone } from './types';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const milestones: readonly MatrixMilestone[] = [
  { id: 'plan', name: '1차 계획서', dueAt: '2026-09-10T23:59:59+09:00' },
  { id: 'mid', name: '중간 보고서', dueAt: '2026-09-20T23:59:59+09:00' },
  { id: 'final', name: '최종 결과물', dueAt: '2026-09-30T23:59:59+09:00' },
];

describe('MatrixStageNavigation', () => {
  let container: HTMLDivElement;
  let root: Root;
  const onSelectMilestone = vi.fn();

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    onSelectMilestone.mockReset();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function renderNavigation(selectedMilestoneId: string | null) {
    await act(async () => {
      root.render(
        <MatrixStageNavigation
          milestones={milestones}
          selectedMilestoneId={selectedMilestoneId}
          onSelectMilestone={onSelectMilestone}
        />,
      );
    });
  }

  it('태블릿 단계 버튼으로 모든 단계와 특정 단계를 선택한다', async () => {
    await renderNavigation('mid');
    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="group"] button'),
    );

    expect(buttons.map((button) => button.textContent)).toEqual([
      '모든 단계',
      '1차 계획서',
      '중간 보고서선택됨',
      '최종 결과물',
    ]);
    expect(buttons[2]?.getAttribute('aria-pressed')).toBe('true');
    expect(buttons.every((button) => button.dataset.slot === 'button')).toBe(
      true,
    );

    await act(async () => buttons[3]?.click());
    expect(onSelectMilestone).toHaveBeenCalledWith('final');

    await act(async () => buttons[0]?.click());
    expect(onSelectMilestone).toHaveBeenLastCalledWith(null);
  });

  it('화살표·Home·End 키로 긴 단계 목록을 이동한다', async () => {
    await renderNavigation(null);
    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="group"] button'),
    );
    buttons[0]?.focus();

    await act(async () => {
      buttons[0]?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(buttons[1]);

    await act(async () => {
      buttons[1]?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'End', bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(buttons[3]);
  });

  it('모바일 선택 메뉴도 같은 선택 계약을 사용한다', async () => {
    await renderNavigation('plan');
    const select = container.querySelector<HTMLSelectElement>(
      '#matrix-mobile-stage',
    );
    expect(select?.value).toBe('plan');

    await act(async () => {
      if (!select) return;
      select.value = 'final';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onSelectMilestone).toHaveBeenCalledWith('final');
  });
});
