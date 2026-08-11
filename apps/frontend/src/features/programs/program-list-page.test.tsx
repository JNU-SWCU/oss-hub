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

let currentSearch = '';
const routerPushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPushMock }),
  useSearchParams: () => new URLSearchParams(currentSearch),
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
    currentSearch = '';
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

  async function renderPage(
    canCreateProgram: boolean,
    viewerRole: 'STUDENT' | 'STAFF' | 'ADMIN' = 'STAFF',
  ): Promise<void> {
    await act(async () => {
      root.render(
        <ProgramListPage
          canCreateProgram={canCreateProgram}
          viewerRole={viewerRole}
        />,
      );
      await Promise.resolve();
    });
  }

  it('교직원은 프로그램이 있어도 목록 머리말에서 새 프로그램을 만들 수 있다', async () => {
    await renderPage(true);

    const description = container.querySelector(
      '[data-slot="page-header-description"]',
    );
    const createLinks = Array.from(
      container.querySelectorAll<HTMLAnchorElement>('a[href="/programs/new"]'),
    );
    expect(description?.classList.contains('break-keep')).toBe(true);
    expect(createLinks).toHaveLength(1);
    expect(createLinks[0]?.textContent).toBe('프로그램 만들기');
  });

  it('교직원은 프로그램이 없어도 목록 머리말의 만들기 동선을 한 번만 본다', async () => {
    listProgramsMock.mockResolvedValueOnce({
      items: [],
      page: 1,
      pageSize: 20,
      totalItems: 0,
      totalPages: 0,
    });

    await renderPage(true);

    expect(container.querySelectorAll('a[href="/programs/new"]')).toHaveLength(
      1,
    );
    expect(container.textContent).toContain('등록된 프로그램이 없습니다');
  });

  it('학생에게는 프로그램 만들기 동선을 노출하지 않는다', async () => {
    await renderPage(false, 'STUDENT');

    expect(container.querySelector('a[href="/programs/new"]')).toBeNull();
  });
});

describe('ProgramListPage 카드 그리드·정렬', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    currentSearch = '';
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

  async function renderPage(): Promise<void> {
    await act(async () => {
      root.render(
        <ProgramListPage canCreateProgram={false} viewerRole="STUDENT" />,
      );
      await Promise.resolve();
    });
  }

  function select(): HTMLSelectElement {
    const element = container.querySelector('select');
    if (!(element instanceof HTMLSelectElement)) {
      throw new TypeError('정렬 select를 찾지 못했습니다');
    }
    return element;
  }

  async function changeSelectValue(
    element: HTMLSelectElement,
    value: string,
  ): Promise<void> {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      'value',
    )?.set;
    await act(async () => {
      setter?.call(element, value);
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  it('상태별 섹션 제목(h2) 없이 카드 그리드 하나로 렌더한다', async () => {
    await renderPage();

    expect(container.querySelector('h2')).toBeNull();
    expect(container.textContent).toContain('합성 프로그램');
  });

  it('URL에 없는 정렬은 기본값(생략)으로 표시되고, listPrograms를 sort 없이 호출한다', async () => {
    await renderPage();

    expect(select().value).toBe('');
    expect(listProgramsMock).toHaveBeenCalledWith(
      expect.objectContaining({ sort: undefined, direction: undefined }),
    );
  });

  it('URL의 sort/direction을 select와 데이터 요청에 그대로 반영한다', async () => {
    currentSearch = 'sort=name&direction=desc';
    await renderPage();

    expect(select().value).toBe('name');
    expect(listProgramsMock).toHaveBeenCalledWith(
      expect.objectContaining({ sort: 'name', direction: 'desc' }),
    );
  });

  it('정렬 select를 바꾸면 현재 status를 보존한 URL로 이동한다', async () => {
    currentSearch = 'status=recruiting';
    await renderPage();

    await changeSelectValue(select(), 'applicationPeriod');

    expect(routerPushMock).toHaveBeenCalledWith(
      '/programs?status=recruiting&sort=applicationPeriod',
    );
  });
});
