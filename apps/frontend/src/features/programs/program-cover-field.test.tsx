// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PROGRAM_COVER_MAX_BYTES,
  ProgramCoverField,
  validateProgramCover,
} from './program-cover-field';
import { ProgramCoverPreview } from './program-cover-preview';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});
afterEach(() => vi.restoreAllMocks());

describe('program cover selection', () => {
  it('accepts only a nonempty matching JPG/PNG at or below the size limit', () => {
    expect(
      validateProgramCover({
        name: 'poster.PNG',
        type: 'image/png',
        size: PROGRAM_COVER_MAX_BYTES,
      }),
    ).toBeNull();
    expect(
      validateProgramCover({ name: 'photo.jpeg', type: 'image/jpeg', size: 1 }),
    ).toBeNull();
    expect(
      validateProgramCover({ name: 'poster.png', type: 'image/jpeg', size: 1 }),
    ).toContain('JPG');
    expect(
      validateProgramCover({
        name: 'poster.svg',
        type: 'image/svg+xml',
        size: 1,
      }),
    ).toContain('JPG');
    expect(
      validateProgramCover({ name: 'poster.png', type: 'image/png', size: 0 }),
    ).toContain('빈 파일');
    expect(
      validateProgramCover({
        name: 'poster.png',
        type: 'image/png',
        size: PROGRAM_COVER_MAX_BYTES + 1,
      }),
    ).toContain('5 MB');
  });

  it('keeps the existing image when validation fails and exposes remove/restore as draft changes', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const onChange = vi.fn();
    const currentImageUrl = '/programs/example/cover/cover-one';
    try {
      await act(async () =>
        root.render(
          <>
            <ProgramCoverPreview
              name="예시"
              selection={undefined}
              currentImageUrl={currentImageUrl}
            />
            <ProgramCoverField
              selection={undefined}
              currentImageUrl={currentImageUrl}
              onChange={onChange}
            />
          </>,
        ),
      );
      const input = container.querySelector('input');
      Object.defineProperty(input, 'files', {
        configurable: true,
        value: [new File(['bad'], 'bad.svg', { type: 'image/svg+xml' })],
      });
      await act(async () =>
        input?.dispatchEvent(new Event('change', { bubbles: true })),
      );
      expect(onChange).not.toHaveBeenCalled();
      expect(container.querySelector('img')?.getAttribute('src')).toContain(
        currentImageUrl,
      );
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        'JPG',
      );
      await act(async () =>
        [...container.querySelectorAll('button')]
          .find((button) => button.textContent === '이미지 제거')
          ?.click(),
      );
      expect(onChange).toHaveBeenLastCalledWith(null);
      await act(async () =>
        root.render(
          <>
            <ProgramCoverPreview
              name="예시"
              selection={null}
              currentImageUrl={currentImageUrl}
            />
            <ProgramCoverField
              selection={null}
              currentImageUrl={currentImageUrl}
              onChange={onChange}
            />
          </>,
        ),
      );
      expect(container.querySelector('img')).toBeNull();
      await act(async () =>
        [...container.querySelectorAll('button')]
          .find((button) => button.textContent === '기존 이미지로 되돌리기')
          ?.click(),
      );
      expect(onChange).toHaveBeenLastCalledWith(undefined);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
