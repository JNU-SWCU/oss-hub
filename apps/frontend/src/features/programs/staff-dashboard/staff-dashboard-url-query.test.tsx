import { act } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  createListScreenRoot,
  listNavigation,
  useTestSearchParams,
} from '../../../../test-support/list-screen-root';
import { StaffDashboardPage } from './staff-dashboard-page';
import type { StaffDashboardPageViewState } from './staff-dashboard-page-view';
import { getStaffDashboardSummary } from './api';

vi.mock('next/navigation', () => ({
  useSearchParams: useTestSearchParams,
  useRouter: () => listNavigation,
  usePathname: () => '/dashboard',
}));
vi.mock('./api', () => ({ getStaffDashboardSummary: vi.fn() }));
const captured = vi.hoisted(() => ({
  state: null as StaffDashboardPageViewState | null,
}));
vi.mock('./staff-dashboard-page-view', () => ({
  StaffDashboardPageView: ({
    state,
  }: {
    readonly state: StaffDashboardPageViewState;
  }) => {
    captured.state = state;
    return null;
  },
}));
let root: ReturnType<typeof createListScreenRoot>;
let container: HTMLDivElement;
function ready() {
  if (captured.state?.kind !== 'ready')
    throw new Error('Dashboard is not ready');
  return captured.state;
}
beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  container = document.createElement('div');
  root = createListScreenRoot(container);
  vi.mocked(getStaffDashboardSummary)
    .mockReset()
    .mockResolvedValue({ programs: [] });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

it('restores URL filters without refetching the unfiltered summary for local paging', async () => {
  listNavigation.search = 'search=x&status=ended&page=2';
  await act(async () => root.render(<StaffDashboardPage />));
  expect(ready().search).toBe('x');
  expect(ready().status).toBe('ended');
  await act(async () => ready().actions.onPageChange(3));
  expect(listNavigation.search).toBe('search=x&status=ended&page=3');
  expect(getStaffDashboardSummary).toHaveBeenCalledTimes(1);
});

it('reset cancels uncommitted debounced search instead of restoring it later', async () => {
  await act(async () => root.render(<StaffDashboardPage />));
  await act(async () => ready().actions.onSearchChange('pending'));
  await act(async () => ready().actions.onResetFilters());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
  expect(listNavigation.search).toBe('');
  expect(ready().search).toBe('');
});
