import { act } from 'react';
import { notifyManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestQueryClient, renderWithQuery } from './render-with-query';
import { StaffInsightsScreen } from '@/features/staff-insights/staff-insights-screen';
import { SystemStatusScreen } from '@/features/system-status/components/system-status-screen';
import { MyRepositoriesScreen } from '@/features/repositories/components/my-repositories-screen';
import { PublicProfileView } from '@/features/profile/components/public-profile-view';
import { ProjectDetailView } from '@/features/projects/components/project-detail-view';
import { ActivityGraphContent } from '@/features/programs/catalog/components/activity-graph-panel';
import type { PublicProfile } from '@/features/profile/public-profile-types';
import type { ProjectDetail } from '@/features/projects/types';
import type { StaffInsightsViewState } from '@/features/staff-insights/staff-insights-view';
import type { MyRepositoriesState } from '@/features/repositories/types';
import type { SystemStatusViewState } from '@/features/system-status/types';
import { PublicProfileNotFoundError } from '@/features/profile/public-profile-api';
import { ProjectNotFoundError } from '@/features/projects/api';

const api = vi.hoisted(() => ({
  scope: { kind: 'all' },
  insights: vi.fn(),
  system: vi.fn(),
  repositories: vi.fn(),
  profile: vi.fn(),
  project: vi.fn(),
  activity: vi.fn(),
}));

vi.mock('@/features/staff-insights/api', () => ({
  getStaffInsights: api.insights,
}));
vi.mock('@/features/system-status/api', () => ({
  fetchSystemStatus: api.system,
  triggerCollection: vi.fn(),
}));
vi.mock('@/features/repositories/loader', () => ({
  loadMyRepositories: api.repositories,
}));
vi.mock('@/features/profile/public-profile-api', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/features/profile/public-profile-api')
  >()),
  loadPublicProfile: api.profile,
}));
vi.mock('@/features/projects/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/projects/api')>()),
  loadProjectDetail: api.project,
}));
vi.mock('@/features/programs/catalog/api', () => ({
  getProgramActivity: api.activity,
}));
vi.mock('@/features/staff-insights/staff-insights-url-state', () => ({
  useStaffInsightsUrlState: () => ({ state: api.scope }),
}));
vi.mock('@/features/staff-insights/staff-insights-view', () => ({
  StaffInsightsView: ({
    state,
  }: {
    readonly state: StaffInsightsViewState;
  }) => (
    <output data-kind={state.kind}>
      {state.kind === 'error' ? <button onClick={state.onRetry} /> : null}
    </output>
  ),
}));
vi.mock('@/features/system-status/components/system-status-view', () => ({
  SystemStatusView: ({
    state,
    onRetry,
  }: {
    readonly state: SystemStatusViewState;
    readonly onRetry: () => void;
  }) => (
    <output data-kind={state.kind}>
      {state.kind === 'error' ? <button onClick={onRetry} /> : null}
    </output>
  ),
}));
vi.mock('@/features/repositories/components/my-repositories-view', () => ({
  MyRepositoriesView: ({
    state,
    onRetry,
  }: {
    readonly state: MyRepositoriesState;
    readonly onRetry: () => void;
  }) => (
    <output data-kind={state.kind}>
      {state.kind === 'error' ? <button onClick={onRetry} /> : null}
    </output>
  ),
}));

const profile: PublicProfile = {
  userId: 'user-1',
  githubNickname: 'query-user',
  avatarUrl: null,
  projects: [],
  observedTotals: { commitCount: 0, pullRequestCount: 0, releaseCount: 0 },
};
const project: ProjectDetail = {
  projectId: 'project-1',
  programId: 'program-1',
  programName: 'query-program',
  trackType: null,
  applicationMode: 'TEAM',
  displayName: 'query-project',
  repositoryName: 'query-repository',
  githubUrl: 'https://github.com/test/query-repository',
  publishedAt: '2026-01-01T00:00:00.000Z',
  publishedLabel: '2026',
  metrics: { commitCount: 0, pullRequestCount: 0, releaseCount: 0 },
  contributors: [],
};
const activity = [
  {
    applicationId: 'application-1',
    label: 'query-team',
    commitCount: 1,
    pullRequestCount: 0,
    releaseCount: 0,
    collectionStatus: 'READY',
    dataAsOf: null,
    lastActivityAt: null,
    members: [],
    hasIncompleteContributions: false,
  },
];

const cases = [
  {
    name: 'insights',
    render: () => <StaffInsightsScreen />,
    load: api.insights,
    data: {},
    ready: '[data-kind="ready"]',
  },
  {
    name: 'system',
    render: () => <SystemStatusScreen />,
    load: api.system,
    data: {},
    ready: '[data-kind="success"]',
  },
  {
    name: 'repositories',
    render: () => <MyRepositoriesScreen />,
    load: api.repositories,
    data: { items: [] },
    ready: '[data-kind="ready"]',
  },
  {
    name: 'profile',
    render: () => <PublicProfileView userId="user-1" />,
    load: api.profile,
    data: profile,
    ready: 'h1',
  },
  {
    name: 'project',
    render: () => <ProjectDetailView projectId="project-1" />,
    load: api.project,
    data: project,
    ready: 'h1',
  },
  {
    name: 'activity',
    render: () => <ActivityGraphContent programId="program-1" />,
    load: api.activity,
    data: activity,
    ready: 'strong',
  },
];

describe('read-only screen queries', () => {
  let view: Awaited<ReturnType<typeof renderWithQuery>> | undefined;

  beforeEach(() => {
    vi.resetAllMocks();
    notifyManager.setScheduler(queueMicrotask);
  });

  afterEach(async () => {
    await view?.unmount();
    view = undefined;
    notifyManager.setScheduler((callback) => setTimeout(callback, 0));
  });

  it.each(cases)(
    '$name shares one pending read and renders both readers',
    async ({ render, load, data, ready }) => {
      const response = Promise.withResolvers<unknown>();
      load.mockReturnValue(response.promise);
      view = await renderWithQuery(
        <>
          {render()}
          {render()}
        </>,
      );
      expect(load).toHaveBeenCalledTimes(1);
      await act(async () => response.resolve(data));
      expect(view.container.querySelectorAll(ready)).toHaveLength(2);
    },
  );

  it.each(cases)(
    '$name retries a failed read without remounting',
    async ({ render, load, data, ready }) => {
      load
        .mockRejectedValueOnce(new TypeError('read failed'))
        .mockResolvedValue(data);
      view = await renderWithQuery(render());
      const retry = view.container.querySelector('button');
      if (!(retry instanceof HTMLButtonElement))
        throw new TypeError('retry missing');
      const completed = Promise.withResolvers<void>();
      const unsubscribe = view.queryClient
        .getQueryCache()
        .subscribe((event) => {
          if (
            event.query.state.status === 'success' &&
            event.query.state.fetchStatus === 'idle'
          ) {
            completed.resolve();
          }
        });
      try {
        await act(async () => {
          retry.click();
          await completed.promise;
        });
        expect(load).toHaveBeenCalledTimes(2);
        expect(view.container.querySelector(ready)).not.toBeNull();
      } finally {
        unsubscribe();
      }
    },
  );

  it('a late activity response cannot replace the newly selected program', async () => {
    const old = Promise.withResolvers<unknown>();
    api.activity
      .mockReturnValueOnce(old.promise)
      .mockResolvedValue([{ ...activity[0], label: 'new-team' }]);
    view = await renderWithQuery(<ActivityGraphContent programId="old" />);
    await view.rerender(<ActivityGraphContent programId="new" />);
    await act(async () => old.resolve(activity));
    expect(view.container.querySelector('strong')?.textContent).toBe(
      'new-team',
    );
  });

  it.each(cases)(
    '$name keeps cached content visible on return while refreshing',
    async ({ render, load, data, ready }) => {
      const queryClient = createTestQueryClient();
      queryClient.setDefaultOptions({
        queries: {
          ...queryClient.getDefaultOptions().queries,
          gcTime: Infinity,
        },
      });
      load.mockResolvedValue(data);
      view = await renderWithQuery(render(), { queryClient });
      await view.rerender(null);
      const refresh = Promise.withResolvers<unknown>();
      load.mockReturnValue(refresh.promise);
      await view.rerender(render());
      expect(view.container.querySelector(ready)).not.toBeNull();
      await act(async () => refresh.resolve(data));
      expect(view.container.querySelector(ready)).not.toBeNull();
    },
  );

  it('staff insights forwards the query signal and cancels on departure', async () => {
    api.insights.mockReturnValue(new Promise(() => {}));
    view = await renderWithQuery(<StaffInsightsScreen />);
    const signal: unknown = api.insights.mock.calls[0]?.[1];
    expect(signal).toBeInstanceOf(AbortSignal);
    if (!(signal instanceof AbortSignal)) throw new TypeError('signal missing');
    expect(signal.aborted).toBe(false);
    await view.rerender(null);
    expect(signal.aborted).toBe(true);
  });

  it.each([
    {
      render: () => <PublicProfileView userId="missing" />,
      load: api.profile,
      error: new PublicProfileNotFoundError(),
    },
    {
      render: () => <ProjectDetailView projectId="missing" />,
      load: api.project,
      error: new ProjectNotFoundError(),
    },
  ])(
    'preserves not-found instead of offering a failed-read retry',
    async ({ render, load, error }) => {
      load.mockRejectedValue(error);
      view = await renderWithQuery(render());
      expect(view.container.querySelector('a')?.getAttribute('href')).toBe(
        '/programs?status=ended',
      );
      expect(view.container.querySelector('button')).toBeNull();
    },
  );
});
