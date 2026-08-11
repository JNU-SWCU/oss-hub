// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDebouncedValue } from './use-debounced-value';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

describe('useDebouncedValue', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  /** 훅을 실제로 돌려 렌더될 때마다의 값을 기록한다. */
  function mount(initial: string, delayMs: number) {
    const renders: string[] = [];

    function Probe({ value }: { readonly value: string }) {
      const debounced = useDebouncedValue(value, delayMs);
      renders.push(debounced);
      return null;
    }

    act(() => {
      root.render(<Probe value={initial} />);
    });

    return {
      renders,
      update: (value: string) => {
        act(() => {
          root.render(<Probe value={value} />);
        });
      },
    };
  }

  it('처음 렌더에서는 초기값을 그대로 돌려준다', () => {
    const { renders } = mount('a', 300);
    expect(renders.at(-1)).toBe('a');
  });

  it('delayMs가 지나기 전에는 이전 값을 유지한다', () => {
    const { renders, update } = mount('a', 300);
    update('ab');

    act(() => {
      vi.advanceTimersByTime(299);
    });

    expect(renders.at(-1)).toBe('a');
  });

  it('delayMs가 지나면 최신값으로 갱신된다', () => {
    const { renders, update } = mount('a', 300);
    update('ab');

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(renders.at(-1)).toBe('ab');
  });

  it('delay 안에 값이 연속으로 바뀌면 타이머를 다시 재고 마지막 값만 반영한다', () => {
    const { renders, update } = mount('a', 300);

    update('ab');
    act(() => {
      vi.advanceTimersByTime(200);
    });
    update('abc');
    act(() => {
      vi.advanceTimersByTime(200);
    });
    // 마지막 갱신 이후 200ms만 지났으므로 아직 300ms를 채우지 못했다.
    expect(renders.at(-1)).toBe('a');

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(renders.at(-1)).toBe('abc');
  });

  it('unmount되면 대기 중이던 타이머를 정리한다', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { update } = mount('a', 300);
    update('ab');

    act(() => root.unmount());

    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
