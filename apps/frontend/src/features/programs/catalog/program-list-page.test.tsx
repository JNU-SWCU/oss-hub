import { act } from 'react';
import type { Root } from 'react-dom/client';
import {
  createListScreenRoot as createRoot,
  listNavigation,
  useTestSearchParams,
} from '../../../../test-support/list-screen-root';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getProgramEndedYears, listPrograms } from './api';
import { ProgramListPage } from './program-list-page';
import { ApiError, apiPath } from '@/lib/api-client';
import {
  NavigationNoticeProvider,
  rememberProgramPurged,
} from '@/lib/navigation-notices';

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

const routerPushMock = vi.fn((href: string) => listNavigation.push(href));
const routerReplaceMock = vi.fn((href: string) => listNavigation.replace(href));

vi.mock('next/navigation', () => ({
  usePathname: () => '/programs',
  useRouter: () => ({ push: routerPushMock, replace: routerReplaceMock }),
  useSearchParams: useTestSearchParams,
}));

vi.mock('./api', () => ({
  listPrograms: vi.fn(),
  getProgramEndedYears: vi.fn(),
}));

const listProgramsMock = vi.mocked(listPrograms);

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  value: true,
  configurable: true,
});

describe('ProgramListPage 종료 프로그램 목록', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    listNavigation.search = 'status=ended';
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    vi.mocked(getProgramEndedYears).mockResolvedValue([2026, 2025]);
    listProgramsMock.mockResolvedValue({
      items: [
        {
          id: 'ended-program',
          name: '합성 종료 프로그램',
          organizer: '합성 운영처',
          trackType: 'EXTRACURRICULAR',
          lifecycle: 'PUBLISHED',
          applicationStartAt: '2025-01-01T00:00:00.000Z',
          applicationEndAt: '2025-02-01T00:00:00.000Z',
          endAt: '2025-12-31T00:00:00.000Z',
          description: '',
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
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  async function renderEndedPrograms() {
    await act(async () =>
      root.render(
        <ProgramListPage canCreateProgram={false} viewerRole={null} />,
      ),
    );
  }

  it('종료 상태와 URL 연도를 요청하고 공용 카드로 동일한 프로그램 상세를 연다', async () => {
    listNavigation.search = 'status=ended&year=2025&sort=name&direction=desc';
    await renderEndedPrograms();
    expect(listProgramsMock).toHaveBeenLastCalledWith({
      page: 1,
      pageSize: 20,
      search: '',
      status: 'ended',
      year: 2025,
      sort: 'name',
      direction: 'desc',
    });
    expect(
      container
        .querySelector('[data-slot="program-card"]')
        ?.closest('a')
        ?.getAttribute('href'),
    ).toBe('/programs/ended-program');
    expect(container.querySelector('a[href="/programs/new"]')).toBeNull();
    const filter = container.querySelector<HTMLSelectElement>(
      'select[aria-label="종료 연도"]',
    );
    expect(filter?.options).toHaveLength(3);
    expect(filter?.value).toBe('2025');
  });

  it('잘못된 연도는 전체 종료 목록으로 요청한다', async () => {
    listNavigation.search = 'status=ended&year=1999';
    await renderEndedPrograms();
    expect(listProgramsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'ended',
        year: undefined,
      }),
    );
  });

  it('연도 조회가 404여도 카드는 표시하고 연도 선택은 숨긴다', async () => {
    vi.mocked(getProgramEndedYears).mockRejectedValueOnce(
      new ApiError({
        type: 'about:blank',
        title: 'Not Found',
        status: 404,
        detail: 'Not Found',
        instance: apiPath('programs/ended-years'),
        code: 'NOT_FOUND',
      }),
    );
    await renderEndedPrograms();
    expect(
      container.querySelector('[data-slot="program-card"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('select[aria-label="종료 연도"]'),
    ).toBeNull();
  });

  it.each(['search', 'page', 'sort'])(
    '%s 변경에는 연도를 재조회하지 않고 종료 탭 재진입 때만 조회한다',
    async (change) => {
      listProgramsMock.mockResolvedValue({
        items: [],
        page: 1,
        pageSize: 20,
        totalItems: 21,
        totalPages: 2,
      });
      if (change === 'search') vi.useFakeTimers();
      await renderEndedPrograms();
      await act(async () => {
        if (change === 'search') {
          const input = container.querySelector('input');
          if (!input) throw new Error('검색 입력이 없습니다');
          Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'value',
          )?.set?.call(input, 'query');
          input.dispatchEvent(new Event('input', { bubbles: true }));
        } else if (change === 'page') {
          const next = Array.from(container.querySelectorAll('button')).find(
            (button) => button.textContent === '다음',
          );
          if (!next) throw new Error('다음 페이지 버튼이 없습니다');
          next.click();
        } else {
          listNavigation.search = 'status=ended&sort=name';
          root.render(
            <ProgramListPage canCreateProgram={false} viewerRole={null} />,
          );
        }
      });
      if (change === 'search')
        await act(async () => {
          await vi.advanceTimersByTimeAsync(300);
        });
      expect(listProgramsMock).toHaveBeenLastCalledWith(
        expect.objectContaining(
          change === 'search'
            ? { search: 'query' }
            : change === 'page'
              ? { page: 2 }
              : { sort: 'name' },
        ),
      );
      expect(getProgramEndedYears).toHaveBeenCalledTimes(1);
      listNavigation.search = '';
      await renderEndedPrograms();
      listNavigation.search = 'status=ended';
      await renderEndedPrograms();
      expect(getProgramEndedYears).toHaveBeenCalledTimes(2);
    },
  );

  it('조회된 연도에 없어도 유효한 URL 연도를 선택된 값으로 표시한다', async () => {
    listNavigation.search = 'status=ended&year=2030';
    await renderEndedPrograms();
    expect(
      container.querySelector<HTMLSelectElement>(
        'select[aria-label="종료 연도"]',
      )?.value,
    ).toBe('2030');
  });

  it('연도 변경은 URL로 이동한다', async () => {
    await renderEndedPrograms();
    const select = container.querySelector<HTMLSelectElement>(
      'select[aria-label="종료 연도"]',
    );
    if (!select) throw new Error('종료 연도 필터가 없습니다');
    await act(async () => {
      select.value = '2025';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(routerPushMock).toHaveBeenCalledWith(
      '/programs?status=ended&year=2025',
    );
  });

  it('이전 연도의 늦은 응답이 최신 연도 목록을 덮어쓰지 않는다', async () => {
    const previous =
      Promise.withResolvers<Awaited<ReturnType<typeof listPrograms>>>();
    listProgramsMock.mockReturnValueOnce(previous.promise);
    await renderEndedPrograms();
    listNavigation.search = 'status=ended&year=2025';
    await renderEndedPrograms();
    await act(async () =>
      previous.resolve({
        items: [],
        page: 1,
        pageSize: 20,
        totalItems: 0,
        totalPages: 0,
      }),
    );
    expect(
      container.querySelector('[data-slot="program-card"]'),
    ).not.toBeNull();
  });
});

const CARD_GRID_TRACK =
  '[grid-template-columns:repeat(auto-fill,minmax(min(20rem,100%),1fr))]';

function trackClasses(grid: Element | null): string[] {
  return Array.from(grid?.classList ?? []).filter((className) =>
    className.startsWith('[grid-template-columns:'),
  );
}

describe('ProgramListPage 등록 동선', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    listNavigation.search = '';
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    listProgramsMock.mockResolvedValue({
      items: [
        {
          id: 'program-1',
          name: '합성 프로그램',
          organizer: '합성 운영처',
          trackType: 'EXTRACURRICULAR',
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
    sessionStorage.clear();
    listNavigation.search = '';
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    listProgramsMock.mockResolvedValue({
      items: [
        {
          id: 'program-1',
          name: '합성 프로그램',
          organizer: '합성 운영처',
          trackType: 'EXTRACURRICULAR',
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
        <NavigationNoticeProvider>
          <ProgramListPage canCreateProgram={false} viewerRole="STUDENT" />
        </NavigationNoticeProvider>,
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
    );
    await act(async () => {
      setter?.set?.call(element, value);
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  it('상태별 섹션 제목(h2) 없이 카드 그리드 하나로 렌더한다', async () => {
    await renderPage();

    expect(container.querySelector('h2')).toBeNull();
    expect(container.textContent).toContain('합성 프로그램');
  });

  it('G5 constrains and centers the program section', async () => {
    await renderPage();
    const section = container.querySelector('section');
    for (const className of ['max-w-[1200px]', 'mx-auto', 'w-full']) {
      expect(section?.classList.contains(className), className).toBe(true);
    }
  });

  it('G3 keeps the shared 20rem track on the programs grid', async () => {
    await renderPage();
    const grid = container.querySelector('[data-slot="card-grid"]');
    expect(grid?.querySelector('[data-slot="program-card"]')).not.toBeNull();
    expect(trackClasses(grid)).toEqual([CARD_GRID_TRACK]);
  });

  it('AC8 renders six horizontal skeleton cards with reserved content rows', async () => {
    const pending =
      Promise.withResolvers<Awaited<ReturnType<typeof listPrograms>>>();
    listProgramsMock.mockReturnValueOnce(pending.promise);
    await renderPage();
    const grid = container.querySelector(
      '[data-slot="skeleton"] [data-slot="card-grid"]',
    );
    expect(trackClasses(grid)).toEqual([CARD_GRID_TRACK]);
    expect(grid?.children).toHaveLength(6);
    for (const wrapper of Array.from(grid?.children ?? [])) {
      for (const className of ['h-full', 'min-w-0']) {
        expect(wrapper.classList.contains(className), className).toBe(true);
      }
      const card = wrapper.firstElementChild;
      expect(card).not.toBeNull();
      if (!card) continue;
      for (const className of [
        'h-full',
        'min-h-[170px]',
        'grid',
        'grid-cols-[auto_minmax(0,1fr)]',
      ]) {
        expect(card.classList.contains(className), className).toBe(true);
      }
      const poster = card.querySelector(
        '[data-slot="list-card-cover"] > [data-slot="skeleton-block"]',
      );
      expect(poster?.classList.contains('aspect-[1/1.414]')).toBe(true);
      expect(poster?.classList.contains('w-full')).toBe(true);
      expect(card.querySelector('.aspect-video')).toBeNull();
      for (const slot of [
        'card-header',
        'card-content',
        'list-card-affordance',
      ]) {
        expect(
          card
            .querySelector(`[data-slot="${slot}"]`)
            ?.classList.contains('px-0'),
          slot,
        ).toBe(true);
      }
      expect(
        card
          .querySelector('[data-slot="card-title"]')
          ?.classList.contains('min-h-[2lh]'),
      ).toBe(true);
      expect(
        card.querySelector('[data-slot="card-content"]')?.children.length,
      ).toBeGreaterThanOrEqual(2);
      expect(
        card.querySelector('[data-slot="list-card-affordance"]'),
      ).not.toBeNull();
    }
    expect(
      container.querySelector('[role="status"]')?.classList.contains('sr-only'),
    ).toBe(true);
  });

  it('URL에 없는 정렬은 기본값(생략)으로 표시되고, listPrograms를 sort 없이 호출한다', async () => {
    await renderPage();

    expect(select().value).toBe('');
    expect(listProgramsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'current',
        sort: undefined,
        direction: undefined,
      }),
    );
  });

  it('URL의 sort/direction을 select와 데이터 요청에 그대로 반영한다', async () => {
    listNavigation.search = 'sort=name&direction=desc';
    await renderPage();

    expect(select().value).toBe('name');
    expect(listProgramsMock).toHaveBeenCalledWith(
      expect.objectContaining({ sort: 'name', direction: 'desc' }),
    );
  });

  it('정렬 select를 바꾸면 현재 status를 보존한 URL로 이동한다', async () => {
    listNavigation.search = 'status=recruiting';
    await renderPage();

    await changeSelectValue(select(), 'applicationPeriod');

    expect(routerReplaceMock).toHaveBeenCalledWith(
      '/programs?status=recruiting&sort=applicationPeriod',
    );
  });

  it('조작된 URL의 삭제 안내는 표시하지 않는다', async () => {
    listNavigation.search = 'purged=forged-text';

    await renderPage();

    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).not.toContain('forged-text');
  });

  it('전체 삭제 후 저장한 안내는 한 번만 표시한다', async () => {
    rememberProgramPurged('지원서 2건 · 알림 3건');
    await renderPage();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      '지원서 2건 · 알림 3건',
    );
    await act(async () => root.unmount());
    root = createRoot(container);
    await renderPage();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('종료된 프로그램 카드에도 상세 href를 그대로 넘긴다', async () => {
    listProgramsMock.mockResolvedValueOnce({
      items: [
        {
          id: 'program-ended',
          name: '종료된 합성 프로그램',
          organizer: '합성 운영처',
          trackType: 'EXTRACURRICULAR',
          applicationStartAt: '2020-01-01T00:00:00.000Z',
          applicationEndAt: '2020-01-31T00:00:00.000Z',
          endAt: '2020-02-28T00:00:00.000Z',
          description: '종료 회귀 테스트',
        },
      ],
      page: 1,
      pageSize: 20,
      totalItems: 1,
      totalPages: 1,
    });

    await act(async () =>
      root.render(
        <ProgramListPage canCreateProgram={false} viewerRole="STUDENT" />,
      ),
    );

    const endedCard = container.querySelector(
      '[data-slot="program-card"][data-status="ended"]',
    );
    const link = endedCard?.closest('a');
    expect(link?.getAttribute('href')).toBe('/programs/program-ended');
  });
});
