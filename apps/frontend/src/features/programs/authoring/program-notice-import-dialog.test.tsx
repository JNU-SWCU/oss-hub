import { act } from 'react';
import { createQueryRoot as createRoot } from '../../../../test-support/render-with-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProgramNoticeImport } from './program-notice-import';
import type { ProgramNoticePreview } from './program-notice-dto';

const api = vi.hoisted(() => ({
  previewProgramNotice:
    vi.fn<typeof import('./program-notice-api').previewProgramNotice>(),
  listProgramNotices: vi.fn(),
}));
vi.mock('./program-notice-api', () => api);
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});
const source = 'https://sojoong.kr/notice/notice-board/?uid=42&mod=document';
const preview: ProgramNoticePreview = {
  sourceUrl: source,
  name: '합성 프로그램',
  description: '첫 문단\n\n운영 안내\n- 항목 하나\n- 항목 둘',
  coverImages: [
    'https://sojoong.kr/wp-content/uploads/poster-one.jpg',
    'https://sojoong.kr/wp-content/uploads/poster-two.jpg',
  ],
  warnings: ['MULTIPLE_IMAGES', 'EXTERNAL_APPLICATION_LINK'],
  candidates: {
    organizers: ['전남대학교'],
    applicationPeriod: { endsAt: '2026-11-18T09:00:00.000Z' },
    operationPeriod: {
      startsAt: '2026-11-19T00:00:00.000Z',
      endsAt: '2026-11-20T09:00:00.000Z',
    },
    teamSize: { min: 2, max: 4 },
  },
};
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
const onApply = vi.fn();
const items = Array.from({ length: 11 }, (_, index) => ({
  url: `${source}${index}`,
  title: `공고 ${index + 1}`,
  postedAt: '2026-11-17',
  thumbnailUrl: null,
}));
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  api.listProgramNotices.mockResolvedValue({ items });
  api.previewProgramNotice.mockResolvedValue(preview);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.resetAllMocks();
});
function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find(
    (item) =>
      item.textContent === label || item.getAttribute('aria-label') === label,
  );
  if (!found) throw new Error(`Missing button ${label}`);
  return found;
}
async function open(currentName = '기존 이름') {
  await act(async () =>
    root.render(
      <ProgramNoticeImport
        currentName={currentName}
        currentDescription=""
        currentOrganizers={['전남대학교']}
        hasCover
        onApply={onApply}
      />,
    ),
  );
  await act(async () => button('공고 불러오기').click());
  await act(async () => {
    await vi.waitFor(() => expect(api.listProgramNotices).toHaveBeenCalled());
  });
}
async function pick() {
  await act(async () => button('공고 1').click());
}

it('shows five cards per page and limits the list to ten', async () => {
  await open();
  expect(document.body.textContent).toContain('공고 5');
  expect(document.body.textContent).not.toContain('공고 6');
  await act(async () => button('2').click());
  expect(document.body.textContent).toContain('공고 10');
  expect(document.body.textContent).not.toContain('공고 11');
});

it('reviews struck, empty, equal and absent fields and applies all checked fields once', async () => {
  await open();
  await pick();
  expect(document.querySelector('s')?.textContent).toBe('기존 이름');
  expect(document.body.textContent).toContain('비어 있음');
  expect(document.body.textContent).toContain('변경 없음');
  expect(
    document.querySelector<HTMLInputElement>('input[name="notice-organizers"]')
      ?.disabled,
  ).toBe(true);
  await act(async () =>
    document
      .querySelector<HTMLButtonElement>('[aria-label="이미지 2"]')
      ?.click(),
  );
  const apply = button('적용');
  await act(async () => {
    apply.click();
    apply.click();
  });
  expect(onApply).toHaveBeenCalledExactlyOnceWith({
    name: preview.name,
    description: preview.description,
    applicationEndAt: '2026-11-18T18:00',
    operationStartAt: '2026-11-19T09:00',
    operationEndAt: '2026-11-20T18:00',
    teamMinSize: '2',
    teamMaxSize: '4',
    externalCover: { sourceUrl: source, imageUrl: preview.coverImages[1] },
  });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it('applies changed organizers and preserves unchecked fields', async () => {
  api.previewProgramNotice.mockResolvedValue({
    ...preview,
    candidates: { organizers: ['새 주관기관'] },
  });
  await open();
  await pick();
  expect(document.body.textContent).toContain('공고에서 찾지 못함');
  await act(async () => {
    document
      .querySelector<HTMLInputElement>('input[name="notice-name"]')
      ?.click();
    document
      .querySelector<HTMLInputElement>('input[name="notice-description"]')
      ?.click();
    document
      .querySelector<HTMLInputElement>('[aria-label="대표 이미지"]')
      ?.click();
  });
  await act(async () => button('적용').click());
  expect(onApply).toHaveBeenCalledExactlyOnceWith({
    organizers: ['새 주관기관'],
  });
});

it('disables apply when all values are equal or absent and has no cover', async () => {
  api.previewProgramNotice.mockResolvedValue({
    ...preview,
    name: '기존 이름',
    description: '',
    candidates: {},
    coverImages: [],
  });
  await open();
  await pick();
  expect(button('적용').disabled).toBe(true);
  expect(document.body.textContent).toContain('공고에서 찾지 못함');
  expect(onApply).not.toHaveBeenCalled();
});

it('aborts closing, ignores late responses, and starts a fresh request on reopen', async () => {
  const stale = Promise.withResolvers<ProgramNoticePreview>();
  api.previewProgramNotice.mockReturnValueOnce(stale.promise);
  await open();
  await pick();
  const signal: AbortSignal = api.previewProgramNotice.mock.calls[0]?.[1];
  await act(async () => button('닫기').click());
  expect(signal.aborted).toBe(true);
  await act(async () => button('공고 불러오기').click());
  await pick();
  await act(async () => stale.resolve({ ...preview, name: 'stale' }));
  expect(document.body.textContent).toContain('합성 프로그램');
  expect(document.body.textContent).not.toContain('stale');
  expect(api.previewProgramNotice).toHaveBeenCalledTimes(2);
});

it('allows retry after preview failure without showing success or applying fields', async () => {
  api.previewProgramNotice.mockRejectedValueOnce(
    new Error('network unavailable'),
  );
  await open();
  await pick();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    '다시 시도',
  );
  expect(onApply).not.toHaveBeenCalled();
  await act(async () => button('다시 시도').click());
  expect(button('적용').disabled).toBe(false);
});

it('retries a failed list request while keeping manual authoring available', async () => {
  api.listProgramNotices.mockRejectedValueOnce(new Error('502'));
  await open();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    '직접 입력',
  );
  await act(async () => button('다시 시도').click());
  await act(async () => {
    await vi.waitFor(() =>
      expect(api.listProgramNotices).toHaveBeenCalledTimes(2),
    );
  });
  expect(button('공고 1')).toBeDefined();
  expect(onApply).not.toHaveBeenCalled();
});
