// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listPrograms } from './api';
import { ProgramListPage } from './program-list-page';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.ComponentProps<'a'> & { readonly href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('./api', () => ({
  listPrograms: vi.fn(),
}));

const listProgramsMock = vi.mocked(listPrograms);

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  value: true,
  configurable: true,
});

describe('ProgramListPage 등록 동선', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    listProgramsMock.mockResolvedValue({
      items: [
        {
          id: 'program-1',
          name: '합성 프로그램',
          organizer: '합성 운영처',
          category: 'BASIC',
          applicationStartAt: '2026-08-01T00:00:00.000Z',
          applicationEndAt: '2026-08-31T00:00:00.000Z',
          endAt: '2026-09-30T00:00:00.000Z',
          description: '합성 설명',
        },
      ],
      page: 1,
      pageSize: 20,
      totalItems: 1,
      totalPages: 1,
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  async function renderPage(canCreateProgram: boolean): Promise<void> {
    await act(async () => {
      root.render(
        <ProgramListPage
          canCreateProgram={canCreateProgram}
          viewerRole="STAFF"
        />,
      );
      await Promise.resolve();
    });
  }

  it('교직원은 프로그램이 있어도 목록 머리말에서 새 프로그램을 만들 수 있다', async () => {
    await renderPage(true);

    const createLinks = Array.from(
      container.querySelectorAll<HTMLAnchorElement>('a[href="/programs/new"]'),
    );
    expect(createLinks).toHaveLength(1);
    expect(createLinks[0]?.textContent).toBe('프로그램 만들기');
  });

  it('학생에게는 프로그램 만들기 동선을 노출하지 않는다', async () => {
    await renderPage(false);

    expect(container.querySelector('a[href="/programs/new"]')).toBeNull();
  });
});
