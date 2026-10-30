import { act, type ReactNode } from 'react';
import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthSession, Me } from '@/features/auth/types';
import {
  getSessionSnapshot,
  refreshSession,
  resetSessionStore,
  subscribeSession,
} from '@/features/auth/session-store';
import { featureKey, programFeatureKey, programKey } from '@/lib/query-keys';
import { fetchSession } from '@/features/auth/api';
import { getProgramOverview } from '@/features/programs/catalog/program-overview-api';
import {
  createTestQueryClient,
  renderWithQuery,
} from '../../../test-support/render-with-query';
import { QueryProvider } from './query-provider';

vi.mock('@/features/auth/api', () => ({
  fetchSession: vi.fn(),
}));

vi.mock('@/features/programs/catalog/program-overview-api', () => ({
  getProgramOverview: vi.fn(),
}));

const user: Me = {
  nickname: 'synthetic-user',
  name: null,
  email: null,
  avatarUrl: null,
  memberKind: 'STUDENT',
  hasStaffAccess: false,
  hasAdminAccess: false,
  isProfileComplete: true,
};

const overviewKey = programFeatureKey('synthetic-program', 'overview', false);
const overview: Awaited<ReturnType<typeof getProgramOverview>> = {
  programId: 'synthetic-program',
  name: 'Synthetic program',
  trackType: null,
  milestoneCount: 0,
  boardPostCount: 0,
  participantCount: 0,
  teamCount: 0,
  connectedRepositoryCount: 0,
  viewerRole: 'STUDENT',
  viewerDocumentsCompleted: null,
  viewerDocumentsTotal: null,
  fullySubmittedParticipantCount: null,
  remainingMilestones: [],
  milestoneDocuments: [],
};
const session = (nextUser: Me): AuthSession => ({
  isAuthenticated: true,
  user: nextUser,
});

function nextSession(status: ReturnType<typeof getSessionSnapshot>['status']) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Session did not reach ${status}`));
    }, 1_000);
    const unsubscribe = subscribeSession(() => {
      if (getSessionSnapshot().status !== status) return;
      clearTimeout(timeout);
      unsubscribe();
      resolve();
    });
  });
}

function ClientProbe({
  onClient,
}: {
  readonly onClient: (client: QueryClient) => void;
}) {
  onClient(useQueryClient());
  return null;
}

function Overview() {
  const query = useQuery({
    queryKey: overviewKey,
    queryFn: () => getProgramOverview('synthetic-program'),
  });
  return <output>{query.status}</output>;
}

describe('QueryProvider', () => {
  let view: Awaited<ReturnType<typeof renderWithQuery>> | undefined;
  let client: QueryClient;

  beforeEach(() => {
    resetSessionStore();
    vi.mocked(fetchSession).mockReset();
    vi.mocked(fetchSession).mockResolvedValue(session(user));
    vi.mocked(getProgramOverview).mockReset();
  });

  afterEach(async () => {
    if (view) await view.unmount();
    view = undefined;
    client?.clear();
    resetSessionStore();
  });

  function tree(children: ReactNode = null) {
    return (
      <QueryProvider>
        <ClientProbe
          onClient={(value) => {
            client = value;
          }}
        />
        {children}
      </QueryProvider>
    );
  }

  async function mount(children: ReactNode = null) {
    const ready = nextSession('authenticated');
    view = await renderWithQuery(tree(children));
    await act(async () => {
      await ready;
    });
  }

  async function changeSession(response: AuthSession) {
    vi.mocked(fetchSession).mockResolvedValueOnce(response);
    const ready = nextSession(
      response.isAuthenticated ? 'authenticated' : 'anonymous',
    );
    await act(async () => {
      refreshSession();
      await ready;
    });
  }

  it('두 컴포넌트가 같은 키를 동시에 읽으면 API를 한 번만 호출한다', async () => {
    const pending =
      Promise.withResolvers<Awaited<ReturnType<typeof getProgramOverview>>>();
    vi.mocked(getProgramOverview).mockReturnValue(pending.promise);

    await mount(
      <>
        <Overview />
        <Overview />
      </>,
    );

    expect(getProgramOverview).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve(overview);
      await pending.promise;
    });
    expect(client.getQueryState(overviewKey)?.status).toBe('success');
  });

  it.each([
    ['nickname', { nickname: 'another-user' }],
    ['memberKind', { memberKind: 'STAFF' }],
    ['hasStaffAccess', { hasStaffAccess: true }],
    ['hasAdminAccess', { hasAdminAccess: true }],
  ] satisfies readonly (readonly [string, Partial<Me>])[])(
    '%s 변경은 캐시를 비우고 다음 조회는 다시 요청한다',
    async (_field, change) => {
      await mount();
      client.setQueryData(overviewKey, 'previous-user-data');

      await changeSession(session({ ...user, ...change }));

      expect(client.getQueryCache().getAll()).toHaveLength(0);
      vi.mocked(getProgramOverview).mockResolvedValue(overview);
      await view?.rerender(tree(<Overview />));
      expect(getProgramOverview).toHaveBeenCalledTimes(1);
    },
  );

  it('anonymous 전환은 쿼리와 mutation 캐시를 비운다', async () => {
    await mount();
    client.setQueryData(overviewKey, 'private-data');
    client.getMutationCache().build(client, { mutationKey: ['private-write'] });

    await changeSession({ isAuthenticated: false });

    expect(client.getQueryCache().getAll()).toHaveLength(0);
    expect(client.getMutationCache().getAll()).toHaveLength(0);
  });

  it('같은 anonymous 갱신은 유지하고 로그인 전환은 캐시를 비운다', async () => {
    await mount();
    await changeSession({ isAuthenticated: false });
    client.setQueryData(overviewKey, 'anonymous-data');

    await changeSession({ isAuthenticated: false });
    expect(client.getQueryData(overviewKey)).toBe('anonymous-data');

    await changeSession(session(user));
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });

  it('loading과 같은 identity의 세션 갱신은 캐시를 유지한다', async () => {
    await mount();
    client.setQueryData(overviewKey, 'cached-data');
    const pending = Promise.withResolvers<AuthSession>();
    vi.mocked(fetchSession).mockReturnValueOnce(pending.promise);
    const ready = nextSession('authenticated');

    await act(async () => {
      refreshSession();
    });
    expect(getSessionSnapshot().status).toBe('loading');
    expect(client.getQueryData(overviewKey)).toBe('cached-data');
    await act(async () => {
      pending.resolve(
        session({
          ...user,
          name: 'Changed name',
          avatarUrl: 'new-avatar',
          email: 'updated@example.test',
          isProfileComplete: false,
        }),
      );
      await ready;
    });
    expect(client.getQueryData(overviewKey)).toBe('cached-data');
  });

  it('세션 조회 오류를 로그아웃으로 해석하지 않는다', async () => {
    await mount();
    client.setQueryData(overviewKey, 'cached-data');
    vi.mocked(fetchSession).mockRejectedValueOnce(new Error('network failure'));
    const ready = nextSession('error');

    await act(async () => {
      refreshSession();
      await ready;
    });

    expect(client.getQueryData(overviewKey)).toBe('cached-data');
  });

  it('브라우저에서는 공급자를 다시 마운트해도 같은 클라이언트를 사용한다', async () => {
    await mount();
    const previous = client;
    await view?.unmount();
    view = await renderWithQuery(tree());
    expect(client).toBe(previous);
    expect(client.getDefaultOptions().queries).toMatchObject({
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 0,
    });
  });

  it('같은 키를 다시 마운트하면 staleTime 0이므로 다시 조회한다', async () => {
    vi.mocked(getProgramOverview).mockResolvedValue(overview);
    await mount(<Overview />);
    expect(client.getQueryData(overviewKey)).toEqual(overview);

    await view?.rerender(tree());
    await view?.rerender(tree(<Overview />));

    expect(getProgramOverview).toHaveBeenCalledTimes(2);
  });

  it('조회 실패는 자동 재시도하지 않는다', async () => {
    vi.mocked(getProgramOverview).mockRejectedValue(new Error('overview failed'));
    await mount(<Overview />);

    expect(client.getQueryState(overviewKey)?.status).toBe('error');
    expect(getProgramOverview).toHaveBeenCalledTimes(1);
  });
});

describe('쿼리 테스트 도구와 키', () => {
  it('테스트마다 독립된 클라이언트를 제공한다', async () => {
    const first = createTestQueryClient();
    const second = createTestQueryClient();
    first.setQueryData(featureKey('ranking', 2026), 'first');
    expect(second.getQueryData(featureKey('ranking', 2026))).toBeUndefined();
    expect(second.getDefaultOptions().queries).toMatchObject({
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 0,
      gcTime: 0,
    });
    const view = await renderWithQuery(
      <ClientProbe
        onClient={(client) => {
          expect(client).toBe(second);
        }}
      />,
      { queryClient: second },
    );
    await view.unmount();
    expect(second.getQueryCache().getAll()).toHaveLength(0);
    first.clear();
  });

  it('program 키는 프로그램 하위 쿼리를 함께 무효화한다', async () => {
    const client = createTestQueryClient();
    client.setQueryData(overviewKey, 'overview');
    client.setQueryData(programFeatureKey('another-program', 'overview'), 'other');

    await client.invalidateQueries({ queryKey: programKey('synthetic-program') });

    expect(client.getQueryState(overviewKey)?.isInvalidated).toBe(true);
    expect(
      client.getQueryState(programFeatureKey('another-program', 'overview'))
        ?.isInvalidated,
    ).toBe(false);
    client.clear();
  });

  it('렌더러는 rerender와 unmount에서 같은 테스트 클라이언트를 사용한다', async () => {
    const clients: QueryClient[] = [];
    const view = await renderWithQuery(
      <ClientProbe
        onClient={(client) => {
          clients.push(client);
        }}
      />,
    );
    await view.rerender(
      <ClientProbe
        onClient={(client) => {
          clients.push(client);
        }}
      />,
    );
    expect(clients).toEqual([view.queryClient, view.queryClient]);
    view.queryClient.setQueryData(['cleanup'], 'data');
    await view.unmount();
    expect(view.container.isConnected).toBe(false);
    expect(view.queryClient.getQueryCache().getAll()).toHaveLength(0);
  });
});
