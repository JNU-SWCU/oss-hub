import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PROGRAM_COVER_MAX_BYTES,
  ProgramCoverField,
  validateProgramCover,
} from './program-cover-field';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});
afterEach(() => vi.restoreAllMocks());

function buttonNamed(
  container: HTMLElement,
  name: string,
): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find(
    (button) => button.textContent === name,
  );
}

describe('program cover selection', () => {
  it('opens the native picker from the empty poster button, allows the same file again, and blocks controls while disabled', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const onChange = vi.fn();
    try {
      await act(async () =>
        root.render(<ProgramCoverField selection={null} onChange={onChange} />),
      );
      const input = container.querySelector('input');
      if (!input) throw new Error('Cover input did not render');
      const openPicker = vi.spyOn(input, 'click');
      expect(container.querySelector('img')).toBeNull();
      await act(async () => buttonNamed(container, '이미지 올리기')?.click());
      expect(openPicker).toHaveBeenCalledOnce();
      const file = new File(['synthetic'], 'poster.png', { type: 'image/png' });
      Object.defineProperty(input, 'files', {
        configurable: true,
        value: [file],
      });
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await act(async () =>
          input.dispatchEvent(new Event('change', { bubbles: true })),
        );
        expect(input.value).toBe('');
      }
      expect(onChange.mock.calls).toEqual([[file], [file]]);
      await act(async () =>
        root.render(
          <ProgramCoverField selection={null} disabled onChange={onChange} />,
        ),
      );
      expect(input.disabled).toBe(true);
      const button = buttonNamed(container, '이미지 올리기');
      expect(button?.disabled).toBe(true);
      await act(async () => button?.click());
      expect(openPicker).toHaveBeenCalledOnce();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('previews the imported image inside its field without exposing source addresses and recovers after a failed image', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const selection = {
      sourceUrl: 'https://sojoong.kr/notice/?uid=42&mod=document',
      imageUrl: 'https://sojoong.kr/wp-content/uploads/poster.jpg',
    };
    try {
      await act(async () =>
        root.render(
          <ProgramCoverField selection={selection} onChange={vi.fn()} />,
        ),
      );
      const image = container.querySelector('img');
      expect(image?.getAttribute('src')).toBe(selection.imageUrl);
      expect(image?.getAttribute('referrerpolicy')).toBe('no-referrer');
      expect(container.querySelector('[role="status"]')?.textContent).toBe(
        '공지에서 가져온 이미지',
      );
      expect(container.textContent).not.toContain(selection.sourceUrl);
      expect(container.textContent).not.toContain(selection.imageUrl);
      expect(container.textContent).not.toContain('목록 미리보기');
      await act(async () => image?.dispatchEvent(new Event('error')));
      expect(
        container.querySelector('[data-cover-state="error"]'),
      ).not.toBeNull();
      await act(async () =>
        root.render(
          <ProgramCoverField
            selection={{
              ...selection,
              imageUrl: 'https://sojoong.kr/wp-content/uploads/replacement.jpg',
            }}
            onChange={vi.fn()}
          />,
        ),
      );
      expect(container.querySelector('img')?.getAttribute('src')).toContain(
        'replacement.jpg',
      );
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

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

  it('replaces the image through 교체 inside the poster', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const onChange = vi.fn();
    try {
      await act(async () =>
        root.render(
          <ProgramCoverField
            selection={undefined}
            currentImageUrl="/programs/example/cover/cover-one"
            onChange={onChange}
          />,
        ),
      );
      const input = container.querySelector('input');
      if (!input) throw new Error('Cover input did not render');
      const openPicker = vi.spyOn(input, 'click');
      await act(async () => buttonNamed(container, '교체')?.click());
      expect(openPicker).toHaveBeenCalledOnce();
      const file = new File(['synthetic'], 'poster.jpg', {
        type: 'image/jpeg',
      });
      Object.defineProperty(input, 'files', {
        configurable: true,
        value: [file],
      });
      await act(async () =>
        input.dispatchEvent(new Event('change', { bubbles: true })),
      );
      expect(onChange).toHaveBeenLastCalledWith(file);
      await act(async () =>
        root.render(
          <ProgramCoverField
            selection={file}
            currentImageUrl="/programs/example/cover/cover-one"
            disabled
            onChange={onChange}
          />,
        ),
      );
      expect(container.querySelector('[role="status"]')?.textContent).toBe(
        'poster.jpg',
      );
      expect(container.textContent).not.toContain('기존 이미지로 되돌리기');
      expect(buttonNamed(container, '교체')?.disabled).toBe(true);
      expect(buttonNamed(container, '삭제')?.disabled).toBe(true);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('keeps the existing image when validation fails and removes it with 삭제 as a draft change', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const onChange = vi.fn();
    const currentImageUrl = '/programs/example/cover/cover-one';
    try {
      await act(async () =>
        root.render(
          <ProgramCoverField
            selection={undefined}
            currentImageUrl={currentImageUrl}
            onChange={onChange}
          />,
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
      await act(async () => buttonNamed(container, '삭제')?.click());
      expect(onChange.mock.calls).toEqual([[null]]);
      await act(async () =>
        root.render(
          <ProgramCoverField
            selection={null}
            currentImageUrl={currentImageUrl}
            onChange={onChange}
          />,
        ),
      );
      expect(container.querySelector('img')).toBeNull();
      expect(container.querySelector('[role="alert"]')).toBeNull();
      expect(
        [...container.querySelectorAll('button')].map(
          (button) => button.textContent,
        ),
      ).toEqual(['이미지 올리기']);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
