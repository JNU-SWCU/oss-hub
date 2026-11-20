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
import type { StaffDashboardSummary } from './dto';
import {
  staffDashboardProgram,
  staffDashboardSummaryOf,
} from './staff-dashboard-test-fixtures';

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
    .mockResolvedValue(staffDashboardSummaryOf([]));
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

it('restores explicit URL order and filters and asks the server for each page', async () => {
  listNavigation.search =
    'search=x&status=ended&page=2&sort=name&direction=asc';
  const nextPage = Promise.withResolvers<StaffDashboardSummary>();
  vi.mocked(getStaffDashboardSummary)
    .mockResolvedValueOnce(staffDashboardSummaryOf([]))
    .mockReturnValueOnce(nextPage.promise);

  await act(async () => root.render(<StaffDashboardPage />));
  expect(ready().order).toEqual({ sort: 'name', direction: 'asc' });
  await act(async () => ready().actions.onPageChange(3));
  expect(ready().order).toEqual({ sort: 'name', direction: 'asc' });
  expect(listNavigation.search).toBe(
    'search=x&status=ended&page=3&sort=name&direction=asc',
  );
  expect(getStaffDashboardSummary).toHaveBeenNthCalledWith(1, {
    search: 'x',
    status: 'ended',
    page: 2,
    sort: 'name',
    direction: 'asc',
  });
  expect(getStaffDashboardSummary).toHaveBeenLastCalledWith({
    search: 'x',
    status: 'ended',
    page: 3,
    sort: 'name',
    direction: 'asc',
  });
  await act(async () => nextPage.resolve(staffDashboardSummaryOf([])));
});

it('requests descending pending order by default and hides the old rows until the reversal resolves', async () => {
  const high = staffDashboardProgram({ id: 'high' });
  const low = staffDashboardProgram({
    id: 'low',
    applications: { total: 0, pendingApproval: 0, approved: 0, rejected: 0 },
  });
  const ascending = Promise.withResolvers<StaffDashboardSummary>();
  vi.mocked(getStaffDashboardSummary)
    .mockResolvedValueOnce(staffDashboardSummaryOf([high, low]))
    .mockReturnValueOnce(ascending.promise);

  await act(async () => root.render(<StaffDashboardPage />));
  expect(getStaffDashboardSummary).toHaveBeenNthCalledWith(1, {
    search: '',
    status: 'all',
    page: 1,
    sort: 'pending',
    direction: 'desc',
  });
  expect(listNavigation.search).toBe('');
  expect(ready().order).toEqual({ sort: 'pending', direction: 'desc' });
  expect(ready().model.pageItems).toEqual([high, low]);

  await act(async () =>
    ready().actions.onSortChange({ sort: 'pending', direction: 'asc' }),
  );
  expect(listNavigation.search).toBe('sort=pending&direction=asc');
  expect(getStaffDashboardSummary).toHaveBeenLastCalledWith({
    search: '',
    status: 'all',
    page: 1,
    sort: 'pending',
    direction: 'asc',
  });
  expect(captured.state?.kind).toBe('loading');

  await act(async () =>
    ascending.resolve(staffDashboardSummaryOf([low, high])),
  );
  expect(ready().order).toEqual({ sort: 'pending', direction: 'asc' });
  expect(ready().model.pageItems).toEqual([low, high]);
});

it('changing order preserves URL filters but resets the server page', async () => {
  listNavigation.search =
    'search=x&status=ended&page=3&sort=name&direction=asc';
  const sorted = Promise.withResolvers<StaffDashboardSummary>();
  vi.mocked(getStaffDashboardSummary)
    .mockResolvedValueOnce(staffDashboardSummaryOf([]))
    .mockReturnValueOnce(sorted.promise);

  await act(async () => root.render(<StaffDashboardPage />));
  await act(async () =>
    ready().actions.onSortChange({ sort: 'deadline', direction: 'asc' }),
  );
  expect(getStaffDashboardSummary).toHaveBeenLastCalledWith({
    search: 'x',
    status: 'ended',
    page: 1,
    sort: 'deadline',
    direction: 'asc',
  });
  expect(captured.state?.kind).toBe('loading');
  await act(async () => sorted.resolve(staffDashboardSummaryOf([])));
  await act(async () => ready().actions.onResetFilters());
  expect(getStaffDashboardSummary).toHaveBeenLastCalledWith({
    search: '',
    status: 'all',
    page: 1,
    sort: 'deadline',
    direction: 'asc',
  });
});
