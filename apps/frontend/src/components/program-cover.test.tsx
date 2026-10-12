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
  await act(async () => root.unmount());
  container.remove();
});

describe('program cover', () => {
  it('keeps poster geometry, falls back after a failed load, and tries a replacement URL', async () => {
    await act(async () => root.render(<ProgramCover src="/cover-one" />));
    const image = container.querySelector('img');
    expect(image?.className).toContain('object-contain');
    expect(image?.alt).toBe('');
    await act(async () => image?.dispatchEvent(new Event('error')));
    expect(
      container.querySelector('[data-cover-state="error"]'),
    ).not.toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(
      container.querySelector('svg[aria-hidden="true"]')?.textContent,
    ).toBe('OSS Hub');
    await act(async () => root.render(<ProgramCover src="/cover-two" />));
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      '/cover-two',
    );
  });

  it('opens the complete detail image in a named dialog and closes it', async () => {
    await act(async () =>
      root.render(
        <ProgramCover src="/portrait" size="detail" title="합성 프로그램" />,
      ),
    );
    await act(async () => container.querySelector('button')?.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      '합성 프로그램 대표 이미지',
    );
    const enlarged = document.querySelector('[role="dialog"] img');
    expect(enlarged?.className).toContain('object-contain');
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>('[aria-label="이미지 닫기"]')
        ?.click(),
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('puts every list card in the same poster frame and draws the default graphic when empty', async () => {
    await act(async () => root.render(<ProgramCover src={null} />));
    const cover = container.querySelector('[data-slot="program-cover"]');
    expect(cover?.getAttribute('data-cover-state')).toBe('empty');
    expect(cover?.className).toContain('aspect-[1/1.414]');
    expect(cover?.querySelector('svg[aria-hidden="true"]')?.textContent).toBe(
      'OSS Hub',
    );

    await act(async () => root.render(<ProgramCover src="/poster" />));
    expect(
      container.querySelector('[data-slot="program-cover"]')?.className,
    ).toContain('aspect-[1/1.414]');
  });

  it('keeps small thumbnails at 16:9 with only the icon', async () => {
    await act(async () =>
      root.render(<ProgramCover src={null} size="thumbnail" />),
    );
    const cover = container.querySelector('[data-slot="program-cover"]');
    expect(cover?.className).toContain('aspect-video');
    expect(cover?.textContent).toBe('');
  });

  it('shows a detail image at its own ratio instead of a fixed frame', async () => {
    await act(async () =>
      root.render(<ProgramCover src="/portrait" size="detail" />),
    );
    const cover = container.querySelector('[data-slot="program-cover"]');
    expect(cover?.className).not.toContain('aspect-');
    expect(cover?.querySelector('img')?.className).toContain('h-auto');
  });
});
