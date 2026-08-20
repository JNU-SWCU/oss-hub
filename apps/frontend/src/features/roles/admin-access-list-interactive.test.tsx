// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

import { AdminAccessView } from './components/admin-access-view';
import type { AdminAccessListItem } from './admin-access-api';
import { ADMIN_ACCESS_LIST_LIMIT } from './admin-access-list-query';

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
    pendingRequest: null,
    lastLoginAt: '2026-07-30T01:00:00.000Z',
    ...overrides,
  };
}

const baseViewProps = {
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

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
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
    act(() => {
      githubLink?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
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
    const lastLoginHeader = headerCells.find((th) =>
      th.textContent?.includes('마지막 로그인'),
    );
    expect(userHeader?.getAttribute('aria-sort')).toBe('ascending');
    expect(lastLoginHeader?.getAttribute('aria-sort')).not.toBe('ascending');

    act(() => {
      root.render(
        <AdminAccessView
          {...baseViewProps}
          sort="lastLoginAt"
          direction="desc"
        />,
      );
    });

    const headerCellsAfter = Array.from(container.querySelectorAll('th'));
    const userHeaderAfter = headerCellsAfter.find((th) =>
      th.textContent?.includes('사용자'),
    );
    const lastLoginHeaderAfter = headerCellsAfter.find((th) =>
      th.textContent?.includes('마지막 로그인'),
    );
    expect(userHeaderAfter?.getAttribute('aria-sort')).not.toBe('descending');
    expect(lastLoginHeaderAfter?.getAttribute('aria-sort')).toBe('descending');
  });
});
