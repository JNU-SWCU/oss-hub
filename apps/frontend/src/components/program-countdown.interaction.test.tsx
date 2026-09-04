// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgramCountdown } from './program-countdown';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

let container: HTMLDivElement;
let root: Root;
let mounted: boolean;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-04T10:00:00+09:00'));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  mounted = true;
});

afterEach(() => {
  if (mounted) act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function renderProgramCountdown(): void {
  act(() => {
    root.render(
      <ProgramCountdown
        mode="program"
        milestones={[
          { label: '첫 번째 마감', dueAt: '2026-08-04T10:00:02+09:00' },
          { label: '두 번째 마감', dueAt: '2026-08-04T10:00:04+09:00' },
        ]}
      />,
    );
  });
}

describe('ProgramCountdown program mode interactions', () => {
  it('promotes the next milestone and then renders the ended state on live ticks', () => {
    renderProgramCountdown();

    expect(container.textContent).toContain('첫 번째 마감');
    expect(container.querySelectorAll('[data-countdown-cell]')).toHaveLength(4);
    expect(container.querySelector('[aria-live]')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(container.textContent).not.toContain('첫 번째 마감');
    expect(container.textContent).toContain('두 번째 마감');

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(container.textContent).toContain('마감 일정이 종료되었습니다.');
    expect(container.querySelectorAll('[data-countdown-cell]')).toHaveLength(0);
  });

  it('cleans up its one-second interval on unmount', () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

    renderProgramCountdown();
    act(() => root.unmount());
    mounted = false;

    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(2000);
    expect(container.textContent).toBe('');
  });
});
