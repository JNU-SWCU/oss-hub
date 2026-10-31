import { act } from 'react';
import { renderWithQuery } from '../../../../test-support/render-with-query';
type Root = Awaited<ReturnType<typeof renderWithQuery>>;
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

import { AdminAccessView } from './components/admin-access-view';
import { AdminAccessScreen } from './components/admin-access-screen';
import type { AdminAccessListItem } from './admin-access-api';
import { ADMIN_ACCESS_LIST_LIMIT } from './admin-access-list-query';

const navigation = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  push: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navigation.push }),
  usePathname: () => '/dashboard/users',
  useSearchParams: () => navigation.searchParams,
}));

const noOp = () => undefined;

function item(
  overrides: Partial<AdminAccessListItem> = {},
): AdminAccessListItem {
  return {
    id: 'synthetic-user',
    githubLogin: 'synthetic-user',
    name: '합성 사용자',
    role: 'STAFF',
    accountStatus: 'ACTIVE',
    isSelf: false,
    isProfileComplete: true,
    createdAt: '2026-07-29T00:00:00.000Z',
    pendingRequest: null,
    lastLoginAt: '2026-07-30T01:00:00.000Z',
    ...overrides,
  };
}

const baseViewProps = {
  workspace: 'directory' as const,
  items: [item()],
  query: '',
  role: '' as const,
  accountStatus: '' as const,
  pendingRequest: '' as const,
  sort: 'name' as const,
  direction: 'asc' as const,
  page: 1,
  limit: ADMIN_ACCESS_LIST_LIMIT,
  total: 1,
  pendingCount: 0,
  isLoading: false,
  errorMessage: null,
  onQueryChange: noOp,
  onSearch: noOp,
  onRoleChange: noOp,
  onAccountStatusChange: noOp,
  onPendingRequestChange: noOp,
  onSortToggle: noOp,
  onPageChange: noOp,
  onRetry: noOp,
  onResetFilters: noOp,
  onRowClick: noOp,
};

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  root = await renderWithQuery(null);
  container = root.container;
});

afterEach(async () => {
  await root.unmount();
  container.remove();
});

describe('AdminAccessView — 행 클릭 상호작용', () => {
  it('행을 클릭하면 onRowClick이 해당 아이템으로 호출된다', () => {
    const onRowClick = vi.fn();
    act(() => {
      root.render(
        <AdminAccessView {...baseViewProps} onRowClick={onRowClick} />,
      );
    });

    const row = container.querySelector('tbody tr');
    expect(row).not.toBeNull();
    act(() => {
      row?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick).toHaveBeenCalledWith(baseViewProps.items[0]);
  });

  it('GitHub 아이콘 링크 클릭은 onRowClick을 함께 호출하지 않는다', () => {
    const onRowClick = vi.fn();
    act(() => {
      root.render(
        <AdminAccessView {...baseViewProps} onRowClick={onRowClick} />,
      );
    });

    const githubLink = container.querySelector<HTMLAnchorElement>(
      'a[aria-label="GitHub 프로필 열기"]',
    );
    expect(githubLink).not.toBeNull();
    githubLink?.addEventListener('click', (event) => event.preventDefault());
    act(() => {
      githubLink?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });

    expect(onRowClick).not.toHaveBeenCalled();
  });
});

describe('AdminAccessView — 헤더 클릭 정렬 토글', () => {
  it('"사용자" 헤더 클릭은 onSortToggle을 name으로 호출한다', () => {
    const onSortToggle = vi.fn();
    act(() => {
      root.render(
        <AdminAccessView
          {...baseViewProps}
          sort="lastLoginAt"
          onSortToggle={onSortToggle}
        />,
      );
    });

    const userHeaderButton = Array.from(
      container.querySelectorAll('th button'),
    ).find((button) => button.textContent?.includes('사용자'));
    expect(userHeaderButton).not.toBeUndefined();
    act(() => {
      userHeaderButton?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });

    expect(onSortToggle).toHaveBeenCalledWith('name');
  });

  it('"역할" 헤더 클릭은 onSortToggle을 role로 호출한다', () => {
    const onSortToggle = vi.fn();
    act(() => {
      root.render(
        <AdminAccessView {...baseViewProps} onSortToggle={onSortToggle} />,
      );
    });

    const roleHeaderButton = Array.from(
      container.querySelectorAll('th button'),
    ).find((button) => button.textContent?.includes('역할'));
    expect(roleHeaderButton).not.toBeUndefined();
    act(() => {
      roleHeaderButton?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });

    expect(onSortToggle).toHaveBeenCalledWith('role');
  });

  it('"계정 상태" 헤더 클릭은 onSortToggle을 accountStatus로 호출한다', () => {
    const onSortToggle = vi.fn();
    act(() => {
      root.render(
        <AdminAccessView {...baseViewProps} onSortToggle={onSortToggle} />,
      );
    });

    const statusHeaderButton = Array.from(
      container.querySelectorAll('th button'),
    ).find((button) => button.textContent?.includes('계정 상태'));
    expect(statusHeaderButton).not.toBeUndefined();
    act(() => {
      statusHeaderButton?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });

    expect(onSortToggle).toHaveBeenCalledWith('accountStatus');
  });

  it('"마지막 로그인" 헤더 클릭은 onSortToggle을 lastLoginAt으로 호출한다', () => {
    const onSortToggle = vi.fn();
    act(() => {
      root.render(
        <AdminAccessView {...baseViewProps} onSortToggle={onSortToggle} />,
      );
    });

    const lastLoginHeaderButton = Array.from(
      container.querySelectorAll('th button'),
    ).find((button) => button.textContent?.includes('마지막 로그인'));
    expect(lastLoginHeaderButton).not.toBeUndefined();
    act(() => {
      lastLoginHeaderButton?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });

    expect(onSortToggle).toHaveBeenCalledWith('lastLoginAt');
  });

  it('"가입 일시" 헤더 클릭은 onSortToggle을 createdAt으로 호출한다', () => {
    const onSortToggle = vi.fn();
    act(() => {
      root.render(
        <AdminAccessView {...baseViewProps} onSortToggle={onSortToggle} />,
      );
    });

    const createdAtHeaderButton = Array.from(
      container.querySelectorAll('th button'),
    ).find((button) => button.textContent?.includes('가입 일시'));
    expect(createdAtHeaderButton).not.toBeUndefined();
    act(() => {
      createdAtHeaderButton?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });

    expect(onSortToggle).toHaveBeenCalledWith('createdAt');
  });

  it('현재 정렬 필드가 바뀌면 각 th의 aria-sort가 그에 맞게 바뀐다', () => {
    act(() => {
      root.render(
        <AdminAccessView {...baseViewProps} sort="name" direction="asc" />,
      );
    });

    const headerCells = Array.from(container.querySelectorAll('th'));
    const userHeader = headerCells.find((th) =>
      th.textContent?.includes('사용자'),
    );
    const createdAtHeader = headerCells.find((th) =>
      th.textContent?.includes('가입 일시'),
    );
    expect(userHeader?.getAttribute('aria-sort')).toBe('ascending');
    expect(createdAtHeader?.getAttribute('aria-sort')).not.toBe('ascending');

    act(() => {
      root.render(
        <AdminAccessView
          {...baseViewProps}
          sort="createdAt"
          direction="desc"
        />,
      );
    });

    const headerCellsAfter = Array.from(container.querySelectorAll('th'));
    const userHeaderAfter = headerCellsAfter.find((th) =>
      th.textContent?.includes('사용자'),
    );
    const createdAtHeaderAfter = headerCellsAfter.find((th) =>
      th.textContent?.includes('가입 일시'),
    );
    expect(userHeaderAfter?.getAttribute('aria-sort')).not.toBe('descending');
    expect(createdAtHeaderAfter?.getAttribute('aria-sort')).toBe('descending');
  });
});

describe.each(['directory', 'queue'] as const)(
  'AdminAccessScreen — %s 요청 순서',
  (workspace) => {
    afterEach(() => vi.unstubAllGlobals());

    function response(name: string, total: number) {
      return new Response(
        JSON.stringify({
          items: [item({ name })],
          page: 1,
          limit: 20,
          total,
          facets: {
            roles: { unassigned: 0, student: 0, staff: total, admin: 0 },
            accountStatuses: { active: total, deactivated: 0 },
            pendingRequests: { none: total, pending: 0 },
          },
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }

    async function search(query: string) {
      navigation.searchParams = new URLSearchParams({ query });
      await act(async () =>
        root.render(<AdminAccessScreen workspace={workspace} />),
      );
    }

    it.each(['success', 'failure'] as const)(
      '이전 검색의 늦은 %s가 최신 검색 결과를 바꾸지 않는다',
      async (outcome) => {
        const first = Promise.withResolvers<Response>();
        const second = Promise.withResolvers<Response>();
        vi.stubGlobal(
          'fetch',
          vi
            .fn()
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise),
        );
        await search('first');
        await search('second');
        await act(async () => second.resolve(response('최신 결과', 2)));

        expect(container.textContent).toContain('최신 결과');
        await act(async () => {
          if (outcome === 'success') first.resolve(response('이전 결과', 1));
          else first.reject(new TypeError('Network request failed'));
        });

        expect(container.textContent).toContain('최신 결과');
        expect(container.textContent).toContain('총 2명');
        expect(container.textContent).not.toContain('이전 결과');
        expect(container.querySelector('[role="alert"]')).toBeNull();
      },
    );

    it('이전 검색 완료가 진행 중인 최신 검색의 로딩을 끝내지 않는다', async () => {
      const first = Promise.withResolvers<Response>();
      const second = Promise.withResolvers<Response>();
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockReturnValueOnce(first.promise)
          .mockReturnValueOnce(second.promise),
      );
      await search('first');
      await search('second');
      await act(async () => first.resolve(response('이전 결과', 1)));

      expect(container.textContent).not.toContain('이전 결과');
      expect(container.textContent).toContain('불러오는 중…');
      await act(async () => second.resolve(response('최신 결과', 2)));
      expect(container.textContent).toContain('최신 결과');
    });
  },
);
