import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProgramCover } from './program-cover';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => {
    root.unmount();
    return Promise.resolve();
  });
  container.remove();
});

describe('program cover', () => {
  it('keeps poster geometry, falls back after a failed load, and tries a replacement URL', async () => {
    await act(() => {
      root.render(<ProgramCover src="/cover-one" />);
      return Promise.resolve();
    });
    const image = container.querySelector('img');
    expect(image?.className).toContain('object-contain');
    expect(image?.alt).toBe('');
    await act(() => {
      image?.dispatchEvent(new Event('error'));
      return Promise.resolve();
    });
    expect(
      container.querySelector('[data-cover-state="error"]'),
    ).not.toBeNull();
    expect(container.querySelector('img')).toBeNull();
    await act(() => {
      root.render(<ProgramCover src="/cover-two" />);
      return Promise.resolve();
    });
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      '/cover-two',
    );
  });

  it('opens the complete detail image in a named dialog and closes it', async () => {
    await act(() => {
      root.render(
        <ProgramCover src="/portrait" size="detail" title="합성 프로그램" />,
      );
      return Promise.resolve();
    });
    await act(() => {
      container.querySelector('button')?.click();
      return Promise.resolve();
    });
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      '합성 프로그램 대표 이미지',
    );
    const enlarged = document.querySelector('[role="dialog"] img');
    expect(enlarged?.className).toContain('object-contain');
    await act(() => {
      document
        .querySelector<HTMLButtonElement>('[aria-label="이미지 닫기"]')
        ?.click();
      return Promise.resolve();
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
