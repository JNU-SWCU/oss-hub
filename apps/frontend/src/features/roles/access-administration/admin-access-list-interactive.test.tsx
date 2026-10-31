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
import type { AdminAccessInlineActions } from './components/admin-access-inline-actions';
import type { AdminAccessListItem } from './admin-access-api';
import { ADMIN_ACCESS_LIST_LIMIT } from './admin-access-list-query';
import { adminAccessMutationSuccessMessage } from './admin-access-mutation-policy';
import type { AdminAccessDirectoryItem } from './independent-authority-api';

const navigation = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  push: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => navigation,
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

function directoryItem(
  overrides: Partial<AdminAccessDirectoryItem> = {},
): AdminAccessDirectoryItem {
  return {
    ...item(),
    memberKind: 'STAFF',
    hasStaffAccess: true,
    hasAdminAccess: false,
    ...overrides,
  };
}

const noInlineActions: AdminAccessInlineActions = {
  onRequestAction: noOp,
  successMessage: null,
  conflictNotice: null,
  actionError: null,
};

const baseViewProps = {
  workspace: 'directory' as const,
  inlineActions: noInlineActions,
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

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });
}

function trigger(name: string): HTMLButtonElement {
  const found = container.querySelector(`[aria-label="${name}"]`);
  if (!(found instanceof HTMLButtonElement)) {
    throw new TypeError(`접근성 이름으로 컨트롤을 찾지 못했습니다: ${name}`);
  }
  return found;
}

function enterKey() {
  return new KeyboardEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    bubbles: true,
    cancelable: true,
  });
}

function open(element: HTMLButtonElement): HTMLElement {
  act(() => {
    element.dispatchEvent(enterKey());
  });
  const listbox = document.getElementById(
    element.getAttribute('aria-controls') ?? '',
  );
  if (!listbox) throw new TypeError('목록을 열지 못했습니다.');
  return listbox;
}

function option(listbox: HTMLElement, label: string): HTMLElement {
  const found = Array.from(
    listbox.querySelectorAll<HTMLElement>('[role="option"]'),
  ).find((candidate) => candidate.textContent?.trim() === label);
  if (!found) throw new TypeError(`선택지를 찾지 못했습니다: ${label}`);
  return found;
}

function choose(name: string, label: string) {
  const target = option(open(trigger(name)), label);
  act(() => {
    target.dispatchEvent(enterKey());
  });
}

function dialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="dialog"]');
}

function dialogButton(label: string): HTMLButtonElement {
  const found = Array.from(
    document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
  ).find((button) => button.textContent?.trim() === label);
  if (!found)
    throw new TypeError(`다이얼로그 버튼을 찾지 못했습니다: ${label}`);
  return found;
}

function nextFocus(element: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    element.addEventListener('focus', () => resolve(), { once: true });
  });
}

function rejectAfter(ms: number): {
  promise: Promise<never>;
  cancel: () => void;
} {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('포커스 복귀 신호를 받지 못했습니다.')),
      ms,
    );
  });
  return { promise, cancel: () => clearTimeout(timer) };
}

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

describe('AdminAccessView — 행 안 컨트롤 상호작용', () => {
  it('컨트롤 밖 셀을 클릭하면 onRowClick이 호출된다', () => {
    const onRowClick = vi.fn();
    const rowItem = directoryItem();
    act(() => {
      root.render(
        <AdminAccessView
          {...baseViewProps}
          items={[rowItem]}
          onRowClick={onRowClick}
        />,
      );
    });

    const chevronCell = container.querySelector('tbody tr td:last-child');
    expect(chevronCell).not.toBeNull();
    act(() => {
      chevronCell?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick).toHaveBeenCalledWith(rowItem);
  });

  it('드롭다운 항목을 고르면 onRequestAction만 호출되고 onRowClick은 호출되지 않는다', () => {
    const onRowClick = vi.fn();
    const onRequestAction = vi.fn();
    const rowItem = directoryItem();
    act(() => {
      root.render(
        <AdminAccessView
          {...baseViewProps}
          items={[rowItem]}
          inlineActions={{ ...noInlineActions, onRequestAction }}
          onRowClick={onRowClick}
        />,
      );
    });

    const listbox = open(trigger('합성 사용자 계정 상태'));
    const target = option(listbox, '비활성');
    act(() => {
      target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    act(() => {
      target.dispatchEvent(enterKey());
    });

    expect(onRequestAction).toHaveBeenCalledWith(
      rowItem,
      'SET_STATUS_DEACTIVATED',
      trigger('합성 사용자 계정 상태'),
    );
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

  it('"회원 유형" 헤더 클릭은 onSortToggle을 role로 호출한다', () => {
    const onSortToggle = vi.fn();
    act(() => {
      root.render(
        <AdminAccessView {...baseViewProps} onSortToggle={onSortToggle} />,
      );
    });

    const memberKindHeaderButton = Array.from(
      container.querySelectorAll('th button'),
    ).find((button) => button.textContent?.includes('회원 유형'));
    expect(memberKindHeaderButton).not.toBeUndefined();
    act(() => {
      memberKindHeaderButton?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });

    expect(onSortToggle).toHaveBeenCalledWith('role');
  });

  it('"관리자 접근" 헤더는 정렬 버튼이 아니다', () => {
    act(() => {
      root.render(<AdminAccessView {...baseViewProps} />);
    });

    const adminAccessHeader = Array.from(container.querySelectorAll('th')).find(
      (th) => th.textContent?.trim() === '관리자 접근',
    );
    expect(adminAccessHeader).not.toBeUndefined();
    expect(adminAccessHeader?.querySelector('button')).toBeNull();
    expect(adminAccessHeader?.hasAttribute('aria-sort')).toBe(false);
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
      return jsonResponse({
        items: [item({ name })],
        page: 1,
        limit: 20,
        total,
        facets: {
          roles: { unassigned: 0, student: 0, staff: total, admin: 0 },
          accountStatuses: { active: total, deactivated: 0 },
          pendingRequests: { none: total, pending: 0 },
        },
      });
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

describe('AdminAccessScreen — 행 인라인 변경', () => {
  afterEach(() => vi.unstubAllGlobals());

  function listResponse(items: readonly AdminAccessListItem[], page = 1) {
    return jsonResponse({
      items,
      page,
      limit: 20,
      total: items.length ? 20 * (page - 1) + items.length : 20 * (page - 1),
      facets: {
        roles: { unassigned: 0, student: 0, staff: 21, admin: 0 },
        accountStatuses: { active: 21, deactivated: 0 },
        pendingRequests: { none: 21, pending: 0 },
      },
    });
  }

  function detailResponse(overrides: Record<string, unknown> = {}) {
    return jsonResponse({
      ...directoryItem(),
      profile: {
        name: '합성 사용자',
        studentId: null,
        department: '소프트웨어공학과',
        staffNumber: '123456',
        isComplete: true,
      },
      ...overrides,
    });
  }

  function mutationResponse() {
    return jsonResponse({
      id: 'synthetic-user',
      role: 'STAFF',
      accountStatus: 'DEACTIVATED',
      pendingRequest: null,
      decidedRequest: null,
    });
  }

  async function render(searchParams: Record<string, string> = {}) {
    navigation.push.mockClear();
    navigation.searchParams = new URLSearchParams(searchParams);
    await act(async () =>
      root.render(<AdminAccessScreen workspace="directory" />),
    );
  }

  it('행 컨트롤에서 값을 고르면 상세로 이동하지 않고 최신 값 조회 후 확인 다이얼로그가 열린다', async () => {
    const detail = Promise.withResolvers<Response>();
    const fetch = vi
      .fn()
      .mockReturnValueOnce(Promise.resolve(listResponse([directoryItem()])))
      .mockReturnValueOnce(detail.promise)
      .mockReturnValueOnce(Promise.resolve(mutationResponse()))
      .mockReturnValueOnce(
        Promise.resolve(
          listResponse([directoryItem({ accountStatus: 'DEACTIVATED' })]),
        ),
      );
    vi.stubGlobal('fetch', fetch);
    await render();

    choose('합성 사용자 계정 상태', '비활성');

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(fetch.mock.calls[1]?.[0])).toContain(
      '/users/synthetic-user/access',
    );
    expect(dialog()).toBeNull();
    expect(navigation.push).not.toHaveBeenCalled();

    await act(async () => detail.resolve(detailResponse()));

    expect(dialog()?.textContent).toContain('계정 비활성화');
    expect(navigation.push).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('불러오는 중…');

    await act(async () => dialogButton('비활성화 확정').click());

    expect(dialog()).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(String(fetch.mock.calls[2]?.[0])).toContain(
      '/users/synthetic-user/access',
    );
    expect(fetch.mock.calls[2]?.[1]).toMatchObject({ method: 'PATCH' });
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      adminAccessMutationSuccessMessage(
        'SET_STATUS_DEACTIVATED',
        'synthetic-user',
      ),
    );
    expect(trigger('합성 사용자 계정 상태').textContent).toContain('비활성');
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it('상세 조회 중 정렬이 바뀌면 충돌 후 조용한 갱신은 최신 정렬로 요청한다', async () => {
    const detail = Promise.withResolvers<Response>();
    const fetch = vi
      .fn()
      .mockReturnValueOnce(Promise.resolve(listResponse([directoryItem()])))
      .mockReturnValueOnce(detail.promise)
      .mockReturnValueOnce(Promise.resolve(listResponse([directoryItem()])))
      .mockReturnValueOnce(Promise.resolve(listResponse([directoryItem()])));
    vi.stubGlobal('fetch', fetch);
    await render();

    choose('합성 사용자 계정 상태', '비활성');
    expect(fetch).toHaveBeenCalledTimes(2);

    await render({ sort: 'role', direction: 'asc' });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(String(fetch.mock.calls[2]?.[0])).toContain('sort=role');

    await act(async () =>
      detail.resolve(detailResponse({ hasAdminAccess: true })),
    );

    expect(dialog()).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(String(fetch.mock.calls[3]?.[0])).toContain('sort=role');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      '다른 처리자가 먼저 변경했습니다.',
    );
  });

  describe('조용한 갱신', () => {
    async function start(page = 2) {
      const initial = Promise.withResolvers<Response>();
      const detail = Promise.withResolvers<Response>();
      const refresh = Promise.withResolvers<Response>();
      const fetch = vi
        .fn()
        .mockReturnValueOnce(initial.promise)
        .mockReturnValueOnce(detail.promise)
        .mockReturnValueOnce(Promise.resolve(mutationResponse()))
        .mockReturnValueOnce(refresh.promise);
      vi.stubGlobal('fetch', fetch);
      await render({ page: String(page), role: 'STAFF' });
      await act(async () =>
        initial.resolve(listResponse([directoryItem()], page)),
      );
      return { detail, refresh, fetch };
    }

    async function deactivateThroughDialog(
      detail: PromiseWithResolvers<Response>,
    ) {
      const statusTrigger = trigger('합성 사용자 계정 상태');
      const refocusedAfterSelect = nextFocus(statusTrigger);
      choose('합성 사용자 계정 상태', '비활성');
      await act(() => refocusedAfterSelect);
      await act(async () => detail.resolve(detailResponse()));
      const refocusedAfterDialog = nextFocus(statusTrigger);
      await act(async () => dialogButton('비활성화 확정').click());
      await act(() => refocusedAfterDialog);
    }

    it('조용한 갱신 동안 기존 행과 트리거 포커스를 유지하고 로딩 행을 보이지 않는다', async () => {
      const { detail, refresh, fetch } = await start();
      const row = container.querySelector('tbody tr');

      await deactivateThroughDialog(detail);

      expect(fetch).toHaveBeenCalledTimes(4);
      expect(container.querySelector('tbody tr')).toBe(row);
      expect(container.textContent).not.toContain('불러오는 중…');
      expect(document.activeElement).toBe(trigger('합성 사용자 계정 상태'));
      await act(async () =>
        refresh.resolve(
          listResponse(
            [
              directoryItem({
                name: '갱신 결과',
                accountStatus: 'DEACTIVATED',
              }),
            ],
            2,
          ),
        ),
      );
      expect(container.textContent).toContain('갱신 결과');
      expect(document.activeElement).toBe(trigger('갱신 결과 계정 상태'));
      expect(navigation.push).not.toHaveBeenCalled();
    });

    it('상세 조회가 셀렉트의 포커스 복귀보다 먼저 끝나도 확인 후 포커스는 그 행의 트리거로 돌아온다', async () => {
      const { detail, refresh } = await start();
      const statusTrigger = trigger('합성 사용자 계정 상태');
      choose('합성 사용자 계정 상태', '비활성');
      await act(async () => detail.resolve(detailResponse()));
      expect(dialog()).not.toBeNull();

      const refocused = nextFocus(statusTrigger);
      const refocusTimeout = rejectAfter(2_000);
      try {
        await act(async () => dialogButton('비활성화 확정').click());
        await Promise.race([refocused, refocusTimeout.promise]);
      } finally {
        refocusTimeout.cancel();
      }

      expect(dialog()).toBeNull();
      expect(document.activeElement).toBe(statusTrigger);
      await act(async () =>
        refresh.resolve(
          listResponse([directoryItem({ accountStatus: 'DEACTIVATED' })], 2),
        ),
      );
      expect(document.activeElement).toBe(trigger('합성 사용자 계정 상태'));
    });

    it('조용한 갱신이 실패하면 행을 유지하고 다시 시도는 로딩 행이 있는 전체 재조회다', async () => {
      const { detail, refresh, fetch } = await start();
      const retry = Promise.withResolvers<Response>();
      fetch.mockReturnValueOnce(retry.promise);
      await deactivateThroughDialog(detail);

      await act(async () => refresh.reject(new TypeError('Network failed')));

      expect(container.textContent).toContain('합성 사용자');
      const alert = container.querySelector('[role="alert"]');
      expect(alert).not.toBeNull();
      expect(alert?.closest('.sticky.top-0')).not.toBeNull();
      expect(container.textContent).not.toContain('불러오는 중…');
      const retryButton = Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent === '다시 시도',
      );
      act(() => retryButton?.click());
      expect(container.textContent).toContain('불러오는 중…');
      await act(async () => retry.resolve(listResponse([directoryItem()], 2)));
      expect(container.querySelector('[role="alert"]')).toBeNull();
    });

    it('재조회 중 URL이 바뀌면 이전 페이지의 빈 결과로 현재 URL을 보정하지 않는다', async () => {
      const { detail, refresh, fetch } = await start();
      await deactivateThroughDialog(detail);
      fetch.mockResolvedValueOnce(listResponse([directoryItem()], 3));

      await render({ page: '3', role: 'STAFF', sort: 'role' });
      await act(async () => refresh.resolve(listResponse([], 2)));

      expect(container.textContent).toContain('합성 사용자');
      expect(navigation.push).not.toHaveBeenCalled();
      expect(String(fetch.mock.calls[4]?.[0])).toContain('page=3');
      expect(String(fetch.mock.calls[4]?.[0])).toContain('sort=role');
    });

    it('최초 조회가 빈 페이지여도 변경 후 재조회가 아니면 이전 페이지로 이동하지 않는다', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce(listResponse([], 2)),
      );

      await render({ page: '2', role: 'STAFF' });

      expect(
        container.querySelector('tbody [data-slot="select-trigger"]'),
      ).toBeNull();
      expect(navigation.push).not.toHaveBeenCalled();
    });

    it.each([1, 2, 3])(
      '조용한 갱신 결과가 비어 있으면 %i페이지에서만 한 페이지 뒤로 간다',
      async (page) => {
        const { detail, refresh } = await start(page);
        await deactivateThroughDialog(detail);

        await act(async () => refresh.resolve(listResponse([], page)));

        if (page > 1) {
          const destination: unknown = navigation.push.mock.calls[0]?.[0];
          expect(typeof destination).toBe('string');
          const url = new URL(String(destination), 'https://example.test');
          expect(Number(url.searchParams.get('page') ?? '1')).toBe(page - 1);
          expect(url.searchParams.get('role')).toBe('STAFF');
          expect(navigation.push).toHaveBeenCalledTimes(1);
        } else {
          expect(navigation.push).not.toHaveBeenCalled();
        }
      },
    );
  });
});
