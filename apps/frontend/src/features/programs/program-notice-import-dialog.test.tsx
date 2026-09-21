// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProgramNoticeImport } from './program-notice-import';

const api = vi.hoisted(() => ({ previewProgramNotice: vi.fn() }));
vi.mock('./program-notice-api', () => api);
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const preview = {
  sourceUrl: 'https://sojoong.kr/notice/?uid=42&mod=document',
  name: '합성 프로그램',
  description: '첫 문단\n\n운영 안내\n- 항목 하나\n- 항목 둘',
  coverImages: [
    'https://sojoong.kr/wp-content/uploads/poster-one.jpg',
    'https://sojoong.kr/wp-content/uploads/poster-two.jpg',
  ],
  warnings: ['MULTIPLE_IMAGES', 'EXTERNAL_APPLICATION_LINK'],
};
let root: Root;
let container: HTMLDivElement;
const onApply = vi.fn();
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.resetAllMocks();
});
function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find(
    (item) => item.textContent === label,
  );
  if (!found) throw new Error(`Missing button ${label}`);
  return found;
}
async function enterUrl(url: string) {
  const input = document.querySelector<HTMLInputElement>('input[type="url"]');
  if (!input) throw new Error('Missing URL field');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set;
    setter?.call(input, url);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function open() {
  await act(async () =>
    root.render(
      <ProgramNoticeImport
        currentName="기존 이름"
        currentDescription="기존 설명"
        hasCover
        onApply={onApply}
      />,
    ),
  );
  await act(async () => button('공지에서 가져오기').click());
  await enterUrl(preview.sourceUrl);
}

it('keeps existing fields unchecked, previews paragraphs, and applies only explicitly selected fields', async () => {
  api.previewProgramNotice.mockResolvedValue(preview);
  await open();
  await act(async () => button('불러오기').click());
  expect(button('선택한 내용 적용').disabled).toBe(true);
  expect(onApply).not.toHaveBeenCalled();
  expect(
    document.querySelector('[data-slot="notice-description-preview"]')
      ?.textContent,
  ).toBe(preview.description);
  expect(document.body.textContent).toContain('신청 안내');
  const description = document.querySelector<HTMLInputElement>(
    'input[name="notice-description"]',
  );
  const poster = document.querySelector<HTMLInputElement>(
    'input[name="notice-cover"][value="1"]',
  );
  await act(async () => {
    description?.click();
    poster?.click();
  });
  await act(async () => button('선택한 내용 적용').click());
  expect(onApply).toHaveBeenCalledExactlyOnceWith({
    description: preview.description,
    externalCover: {
      sourceUrl: preview.sourceUrl,
      imageUrl: preview.coverImages[1],
    },
  });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it('aborts closing, ignores a late response, and reopens with the last entered URL', async () => {
  let resolve: ((value: typeof preview) => void) | undefined;
  api.previewProgramNotice.mockImplementation(
    () =>
      new Promise<typeof preview>((done) => {
        resolve = done;
      }),
  );
  await open();
  await act(async () => button('불러오기').click());
  const signal = api.previewProgramNotice.mock.calls[0]?.[1] as AbortSignal;
  await enterUrl('https://sojoong.kr/notice/?uid=43&mod=document');
  expect(signal.aborted).toBe(true);
  await act(async () => resolve?.(preview));
  expect(
    document.querySelector('[data-slot="notice-description-preview"]'),
  ).toBeNull();
  await act(async () => button('불러오기').click());
  const nextSignal = api.previewProgramNotice.mock.calls[1]?.[1] as AbortSignal;
  await act(async () => button('닫기').click());
  expect(nextSignal.aborted).toBe(true);
  await act(async () => resolve?.(preview));
  expect(onApply).not.toHaveBeenCalled();
  await act(async () => button('공지에서 가져오기').click());
  expect(
    document.querySelector<HTMLInputElement>('input[type="url"]')?.value,
  ).toBe('https://sojoong.kr/notice/?uid=43&mod=document');
});

it('keeps retry and manual authoring available after preview failure', async () => {
  api.previewProgramNotice
    .mockRejectedValueOnce(new Error('network unavailable'))
    .mockResolvedValueOnce({
      ...preview,
      coverImages: [],
      warnings: ['NO_IMAGE'],
    });
  await open();
  await act(async () => button('불러오기').click());
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    '직접 입력',
  );
  await act(async () => button('불러오기').click());
  expect(document.body.textContent).toContain('이미지를 찾지 못했습니다');
  expect(document.querySelectorAll('input[name="notice-cover"]')).toHaveLength(
    0,
  );
  expect(onApply).not.toHaveBeenCalled();
});
