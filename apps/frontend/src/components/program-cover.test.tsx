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
  it('AC6 crops the card image at the top and recovers from failed loads', async () => {
    await act(async () => root.render(<ProgramCover src="/cover-one" />));
    const image = container.querySelector('img');
    expect(image?.className).toContain('object-cover');
    expect(image?.className).toContain('object-top');
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
    const trigger = container.querySelector('button');
    expect(trigger?.className).toContain('cursor-zoom-in');
    expect(trigger?.textContent).toBe('');
    expect(
      trigger?.querySelector('[data-slot="program-cover-zoom"] svg'),
    ).not.toBeNull();
    await act(async () => trigger?.click());
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

  it('AC6 reserves a banner frame and top-crops the empty graphic', async () => {
    await act(async () => root.render(<ProgramCover src={null} />));
    const cover = container.querySelector('[data-slot="program-cover"]');
    expect(cover?.getAttribute('data-cover-state')).toBe('empty');
    expect(cover?.className).toContain('aspect-video');
    expect(cover?.className).toContain('w-full');
    expect(
      cover?.querySelector('svg')?.getAttribute('preserveAspectRatio'),
    ).toBe('xMidYMin slice');
    expect(cover?.querySelector('svg[aria-hidden="true"]')?.textContent).toBe(
      'OSS Hub',
    );

    await act(async () => root.render(<ProgramCover src="/poster" />));
    expect(
      container.querySelector('[data-slot="program-cover"]')?.className,
    ).toContain('aspect-video');
  });

  it('keeps small thumbnails at 16:9 with only the icon', async () => {
    await act(async () =>
      root.render(<ProgramCover src={null} size="thumbnail" />),
    );
    const cover = container.querySelector('[data-slot="program-cover"]');
    expect(cover?.className).toContain('aspect-video');
    expect(cover?.textContent).toBe('');
    await act(async () =>
      root.render(<ProgramCover src="/thumbnail" size="thumbnail" />),
    );
    const image = container.querySelector('img');
    expect(image?.className).toContain('object-contain');
    expect(image?.className).not.toContain('object-cover');
    expect(image?.className).not.toContain('object-top');
  });

  it('shows a detail image at its own ratio up to an A4 height instead of a fixed frame', async () => {
    await act(async () =>
      root.render(<ProgramCover src="/portrait" size="detail" />),
    );
    const cover = container.querySelector('[data-slot="program-cover"]');
    expect(cover?.className).not.toContain('aspect-');
    const image = cover?.querySelector('img');
    expect(image?.className).toContain('h-auto');
    expect(image?.className).toContain('max-h-[141.4cqw]');
    expect(image?.className).toContain('object-top');
  });
});
