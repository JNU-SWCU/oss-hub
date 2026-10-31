import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { notifyManager } from '@tanstack/react-query';
import { renderWithQuery } from './render-with-query';
import { featureKey, programFeatureKey } from '@/lib/query-keys';
import { useStudentDashboardQuery } from '@/features/dashboard/queries';
import { fetchStudentDashboard } from '@/features/dashboard/api';
import { invalidateAdminAccess } from '@/features/roles/access-administration/queries';
import { useApplicationDecisionMutation } from '@/features/programs/applications/queries';
import { decideApplication } from '@/features/programs/applications/api';

vi.mock('@/features/dashboard/api', async (original) => ({
  ...(await original<typeof import('@/features/dashboard/api')>()),
  fetchStudentDashboard: vi.fn(),
}));
vi.mock('@/features/programs/applications/api', async (original) => ({
  ...(await original<typeof import('@/features/programs/applications/api')>()),
  decideApplication: vi.fn(),
}));

let view: Awaited<ReturnType<typeof renderWithQuery>> | undefined;

afterEach(async () => {
  await view?.unmount();
  notifyManager.setScheduler((callback) => setTimeout(callback, 0));
  vi.resetAllMocks();
});

function Dashboard() {
  const query = useStudentDashboardQuery();
  return <output>{query.data?.items.length ?? 'loading'}</output>;
}

it('동시에 열린 학생 대시보드는 하나의 조회를 공유한다', async () => {
  const response = Promise.withResolvers<{ readonly items: readonly [] }>();
  vi.mocked(fetchStudentDashboard).mockReturnValue(response.promise);
  notifyManager.setScheduler(queueMicrotask);
  view = await renderWithQuery(
    <>
      <Dashboard />
      <Dashboard />
    </>,
  );
  expect(fetchStudentDashboard).toHaveBeenCalledTimes(1);
  await act(async () => response.resolve({ items: [] }));
  expect(view.container.textContent).toBe('00');
});

it('관리자 변경은 목록과 패싯 및 대상 상세만 무효화한다', async () => {
  view = await renderWithQuery(null);
  const client = view.queryClient;
  const keys = [
    featureKey('admin-access', 'list', 'directory', { page: 2 }),
    featureKey('admin-access', 'list', 'queue', { page: 1 }),
    featureKey('admin-access', 'facets'),
    featureKey('admin-access', 'detail', 'target'),
  ];
  for (const key of keys) client.setQueryData(key, {});
  const other = featureKey('admin-access', 'detail', 'other');
  client.setQueryData(other, {});
  await invalidateAdminAccess(client, 'target');
  for (const key of keys)
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  expect(client.getQueryState(other)?.isInvalidated).toBe(false);
});

function Decision() {
  const mutation = useApplicationDecisionMutation('program-1');
  return (
    <button
      onClick={() =>
        mutation.mutate({
          applicationId: 'application-1',
          input: { action: 'REVERT' },
        })
      }
    >
      decide
    </button>
  );
}

it('신청 결정 성공은 프로그램 개요와 대시보드를 무효화한다', async () => {
  vi.mocked(decideApplication).mockResolvedValue({
    applicationId: 'application-1',
    status: 'SUBMITTED',
  });
  view = await renderWithQuery(<Decision />);
  const keys = [
    programFeatureKey('program-1', 'overview', true),
    featureKey('student-dashboard'),
    featureKey('staff-dashboard'),
  ];
  for (const key of keys) {
    view.queryClient.setQueryDefaults(key, { gcTime: Infinity });
    view.queryClient.setQueryData(key, {});
  }
  await act(async () => view?.container.querySelector('button')?.click());
  for (const key of keys)
    expect(view.queryClient.getQueryState(key)?.isInvalidated).toBe(true);
});

it('신청 결정 실패는 기존 프로그램 개요를 무효화하지 않는다', async () => {
  vi.mocked(decideApplication).mockRejectedValue(new TypeError('network'));
  view = await renderWithQuery(<Decision />);
  const key = programFeatureKey('program-1', 'overview', true);
  view.queryClient.setQueryDefaults(key, { gcTime: Infinity });
  view.queryClient.setQueryData(key, { count: 1 });
  await act(async () => view?.container.querySelector('button')?.click());
  expect(view.queryClient.getQueryData(key)).toEqual({ count: 1 });
  expect(view.queryClient.getQueryState(key)?.isInvalidated).toBe(false);
});
