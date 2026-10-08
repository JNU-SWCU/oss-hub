import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FilterChip, FilterChipGroup } from './filter-chip';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

describe('FilterChip', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(() => {
      root.unmount();
      return Promise.resolve();
    });
    container.remove();
  });

  async function render(
    selected: string,
    onSelect: (value: string) => void = () => {},
    disabled: readonly string[] = [],
  ) {
    await act(() => {
      root.render(
        <FilterChipGroup aria-label="상태 필터" className="items-center">
          {['all', 'approved', 'rejected'].map((value) => (
            <FilterChip
              key={value}
              pressed={selected === value}
              disabled={disabled.includes(value)}
              onClick={() => onSelect(value)}
            >
              {value}
            </FilterChip>
          ))}
        </FilterChipGroup>,
      );
      return Promise.resolve();
    });
    return Array.from(container.querySelectorAll<HTMLButtonElement>('button'));
  }

  it('묶음은 group 역할과 이름을, 칩은 눌림을 aria-pressed로 말한다', async () => {
    const onSelect = vi.fn();
    const chips = await render('approved', onSelect);
    const group = container.querySelector('[data-slot="filter-chip-group"]');

    expect(group?.getAttribute('role')).toBe('group');
    expect(group?.getAttribute('aria-label')).toBe('상태 필터');
    expect(group?.className).toContain('items-center');
    expect(chips.map((chip) => chip.getAttribute('aria-pressed'))).toEqual([
      'false',
      'true',
      'false',
    ]);

    expect(chips.every((chip) => chip.dataset.variant === 'toggle')).toBe(true);
    expect(chips.every((chip) => chip.type === 'button')).toBe(true);

    await act(() => {
      chips[2]?.click();
      return Promise.resolve();
    });
    expect(onSelect).toHaveBeenCalledWith('rejected');
  });

  it('화살표·Home·End로 칩 사이를 옮기고 끝에서는 반대편으로 돈다', async () => {
    const chips = await render('all');
    const press = async (chip: HTMLButtonElement | undefined, key: string) => {
      await act(() => {
        chip?.dispatchEvent(
          new KeyboardEvent('keydown', { key, bubbles: true }),
        );
        return Promise.resolve();
      });
    };

    chips[0]?.focus();
    await press(chips[0], 'ArrowRight');
    expect(document.activeElement).toBe(chips[1]);
    await press(chips[1], 'End');
    expect(document.activeElement).toBe(chips[2]);
    await press(chips[2], 'ArrowRight');
    expect(document.activeElement).toBe(chips[0]);
    await press(chips[0], 'ArrowLeft');
    expect(document.activeElement).toBe(chips[2]);
    await press(chips[2], 'Home');
    expect(document.activeElement).toBe(chips[0]);
  });

  it('비활성 칩은 이동에서 건너뛴다', async () => {
    const chips = await render('all', () => {}, ['approved']);
    chips[0]?.focus();
    await act(() => {
      chips[0]?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      );
      return Promise.resolve();
    });
    expect(document.activeElement).toBe(chips[2]);
  });
});
