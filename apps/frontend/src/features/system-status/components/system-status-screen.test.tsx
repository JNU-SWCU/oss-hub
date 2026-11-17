import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { notifyManager, QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient } from '../../../../test-support/render-with-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiPath, type ProblemDetail } from '@/lib/api-client';
import type {
  ActionNotice,
  ProvisioningFailedTeam,
  SystemStatus,
  SystemStatusViewState,
} from '../types';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const api = vi.hoisted(() => ({
  fetchSystemStatus: vi.fn(),
  triggerCollection: vi.fn(),
  retryProvisioning: vi.fn(),
}));

vi.mock('../api', () => api);

type CapturedViewProps = {
  readonly state: SystemStatusViewState;
  readonly onReload: () => void;
  readonly onTrigger: () => void;
  readonly isTriggering: boolean;
  readonly onRetryProvisioning: (team: ProvisioningFailedTeam) => void;
  readonly retryingTeamIds: readonly string[];
  readonly notice: ActionNotice | null;
};

const captured = vi.hoisted(() => ({
  props: null as CapturedViewProps | null,
}));

vi.mock('./system-status-view', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('./system-status-view')>();
  return {
    SystemStatusView: (props: CapturedViewProps) => {
      captured.props = props;
      return <original.SystemStatusView {...props} />;
    },
  };
});

import { SystemStatusScreen } from './system-status-screen';

const teamA: ProvisioningFailedTeam = {
  teamId: 'team-a',
  teamName: '리베이스',
  programName: '합성 클라우드 캠프',
  lastErrorCode: 'NAME_CONFLICT',
  updatedAt: '2026-11-17T00:12:00.000Z',
};
const teamB: ProvisioningFailedTeam = {
  teamId: 'team-b',
  teamName: '머지왕',
  programName: '합성 클라우드 캠프',
  lastErrorCode: 'ORG_PERMISSION_DENIED',
  updatedAt: '2026-11-16T13:40:00.000Z',
};

function statusWith(
  failedTeams: readonly ProvisioningFailedTeam[],
  trackedRepositoryCount = 2,
): SystemStatus {
  return {
    collection: {
      health: 'NORMAL',
      trackedRepositoryCount,
      staleRepositoryCount: 0,
      lastSuccessAt: '2026-07-25T11:00:00.000Z',
      nextCycleAt: null,
      currentRunStatus: 'IDLE',
    },
    provisioning: {
      pending: 0,
      processing: 0,
      retryable: 0,
      failedFinal: failedTeams.length,
      failedTeams,
    },
    mail: { sent7d: 0, failed7d: 0, lastSentAt: null },
    anomalies:
      failedTeams.length === 0
        ? []
        : [
            {
              rule: 'PROVISIONING_FAILED',
              severity: 'HIGH',
              count: failedTeams.length,
              target: null,
            },
          ],
    collectionRepositories: [],
    externalCollection: { trackedRepositoryCount: 0, lastSuccessAt: null },
  };
}

const baseStatus = statusWith([teamA, teamB]);

function problem(status: number, code: string): ProblemDetail {
  return {
    type: 'about:blank',
    title: 'error',
    status,
    detail: 'synthetic problem detail',
    instance: apiPath('synthetic'),
    code,
  };
}

function props(): CapturedViewProps {
  if (captured.props === null) {
    throw new Error('expected SystemStatusView props');
  }
  return captured.props;
}

describe('SystemStatusScreen', () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: ReturnType<typeof createTestQueryClient>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    queryClient = createTestQueryClient();
    notifyManager.setScheduler(queueMicrotask);
    captured.props = null;
    api.fetchSystemStatus.mockReset().mockResolvedValue(baseStatus);
    api.triggerCollection.mockReset();
    api.retryProvisioning.mockReset();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await act(async () => root.unmount());
    queryClient.clear();
    notifyManager.setScheduler((callback) => setTimeout(callback, 0));
    container.remove();
  });

  async function renderScreen(): Promise<void> {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <SystemStatusScreen />
        </QueryClientProvider>,
      );
    });
  }

  function retryButton(team: ProvisioningFailedTeam): HTMLButtonElement {
    const button = container.querySelector<HTMLButtonElement>(
      `button[aria-label^="${team.teamName} 저장소 발급 다시 시도"]`,
    );
    if (button === null)
      throw new Error(`retry button not found: ${team.teamId}`);
    return button;
  }

  function hasRetryButton(team: ProvisioningFailedTeam): boolean {
    return (
      container.querySelector(
        `button[aria-label^="${team.teamName} 저장소 발급 다시 시도"]`,
      ) !== null
    );
  }

  describe('handleTrigger', () => {
    it('202 성공이면 성공 알림을 만들고 최신 상태를 조용히 재조회한다', async () => {
      api.triggerCollection.mockResolvedValue({
        status: 'PENDING',
        runId: 'run-1',
      });
      api.fetchSystemStatus
        .mockResolvedValueOnce(baseStatus)
        .mockResolvedValueOnce(statusWith([teamA, teamB], 9));
      await renderScreen();

      await act(async () => props().onTrigger());

      expect(props().notice?.kind).toBe('success');
      expect(api.triggerCollection).toHaveBeenCalledTimes(1);
      expect(api.fetchSystemStatus).toHaveBeenCalledTimes(2);
      expect(props().state).toMatchObject({
        kind: 'success',
        status: { collection: { trackedRepositoryCount: 9 } },
      });
    });

    it('연달아 눌러도 수집을 한 번만 요청한다', async () => {
      const pending = Promise.withResolvers<unknown>();
      api.triggerCollection.mockReturnValue(pending.promise);
      await renderScreen();

      await act(async () => {
        props().onTrigger();
        props().onTrigger();
      });

      expect(api.triggerCollection).toHaveBeenCalledTimes(1);
      expect(props().isTriggering).toBe(true);
      await act(async () => pending.resolve({ status: 'PENDING', runId: 'r' }));
      expect(props().isTriggering).toBe(false);
    });

    it('ApiError 실패는 서버 원문을 드러내지 않는 오류 알림을 보이고 상태를 다시 읽지 않는다', async () => {
      api.triggerCollection.mockRejectedValue(
        new ApiError(problem(409, 'COL_006')),
      );
      await renderScreen();

      await act(async () => props().onTrigger());

      expect(api.fetchSystemStatus).toHaveBeenCalledTimes(1);
      expect(props().notice?.kind).toBe('error');
      expect(props().notice?.message).not.toContain('synthetic problem detail');
    });

    it('ApiError가 아닌 전송 오류도 화면을 깨뜨리지 않고 오류 알림으로 보인다', async () => {
      api.triggerCollection.mockRejectedValue(
        new TypeError('synthetic transport failure'),
      );
      await renderScreen();

      await act(async () => props().onTrigger());

      expect(props().notice?.kind).toBe('error');
      expect(props().notice?.message).not.toContain('synthetic transport');
      expect(props().state.kind).toBe('success');
    });

    it('접수 뒤 조회가 두 번 실패해도 마지막 데이터와 접수 결과를 보존하고 조회만 재시도한다', async () => {
      await renderScreen();
      api.triggerCollection.mockResolvedValue({
        status: 'PENDING',
        runId: 'run-1',
      });
      api.fetchSystemStatus.mockRejectedValueOnce(new Error('network'));
      await act(async () => props().onTrigger());
      expect(props().state).toMatchObject({
        kind: 'success',
        freshness: 'stale',
        status: baseStatus,
      });
      expect(props().notice?.kind).toBe('success');

      api.fetchSystemStatus.mockRejectedValueOnce(new Error('network'));
      await act(async () => props().onReload());
      expect(props().state).toMatchObject({ freshness: 'stale' });

      api.fetchSystemStatus.mockResolvedValue(statusWith([teamA, teamB], 9));
      await act(async () => props().onReload());
      expect(props().state).toMatchObject({
        freshness: 'current',
        status: { collection: { trackedRepositoryCount: 9 } },
      });
      expect(api.triggerCollection).toHaveBeenCalledTimes(1);
      expect(api.fetchSystemStatus).toHaveBeenCalledTimes(4);
    });

    it('수동 조회보다 늦게 시작한 접수 후 조회 결과를 이전 응답이 덮지 않는다', async () => {
      await renderScreen();
      const older = Promise.withResolvers<SystemStatus>();
      api.fetchSystemStatus.mockReturnValueOnce(older.promise);
      await act(async () => props().onReload());
      api.triggerCollection.mockResolvedValue({
        status: 'PENDING',
        runId: 'run-1',
      });
      const latest = statusWith([teamA, teamB], 7);
      api.fetchSystemStatus.mockResolvedValueOnce(latest);
      await act(async () => props().onTrigger());
      await act(async () => older.resolve(baseStatus));
      expect(props().state).toMatchObject({ kind: 'success', status: latest });
    });
  });

  describe('handleRetry', () => {
    it('다시 시도를 연타해도 한 번만 요청하고 성공하면 상태를 다시 읽어 행을 지운다', async () => {
      const pending = Promise.withResolvers<void>();
      api.retryProvisioning.mockReturnValue(pending.promise);
      await renderScreen();

      const button = retryButton(teamA);
      await act(async () => {
        button.click();
        button.click();
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(api.retryProvisioning).toHaveBeenCalledTimes(1);
      expect(api.retryProvisioning).toHaveBeenCalledWith(teamA.teamId);
      expect(props().retryingTeamIds).toEqual([teamA.teamId]);
      expect(retryButton(teamA).getAttribute('aria-disabled')).toBe('true');
      expect(retryButton(teamB).getAttribute('aria-disabled')).toBe('false');

      await act(async () => {
        retryButton(teamA).click();
        props().onRetryProvisioning(teamA);
      });
      expect(api.retryProvisioning).toHaveBeenCalledTimes(1);

      api.fetchSystemStatus.mockResolvedValue(statusWith([teamB]));
      await act(async () => pending.resolve());

      expect(api.retryProvisioning).toHaveBeenCalledTimes(1);
      expect(api.fetchSystemStatus).toHaveBeenCalledTimes(2);
      expect(props().notice?.kind).toBe('success');
      expect(props().retryingTeamIds).toEqual([]);
      expect(hasRetryButton(teamA)).toBe(false);
      expect(hasRetryButton(teamB)).toBe(true);
    });

    it('다시 시도할 수 없다는 409면 오류를 알리고 행을 남긴 채 상태를 다시 읽는다', async () => {
      api.retryProvisioning.mockRejectedValue(
        new ApiError(problem(409, 'APP_037')),
      );
      await renderScreen();

      await act(async () => retryButton(teamA).click());

      expect(api.retryProvisioning).toHaveBeenCalledTimes(1);
      expect(api.fetchSystemStatus).toHaveBeenCalledTimes(2);
      expect(props().notice?.kind).toBe('error');
      expect(props().notice?.message).not.toContain('synthetic problem detail');
      expect(container.querySelector('[role="alert"]')?.textContent).toBe(
        props().notice?.message,
      );
      expect(hasRetryButton(teamA)).toBe(true);
      expect(retryButton(teamA).getAttribute('aria-disabled')).toBe('false');
    });

    it('접수된 뒤 상태 조회가 실패하면 접수 결과와 오래된 목록임을 함께 알린다', async () => {
      api.retryProvisioning.mockResolvedValue(undefined);
      await renderScreen();
      api.fetchSystemStatus.mockRejectedValueOnce(new Error('network'));

      await act(async () => retryButton(teamA).click());

      expect(api.retryProvisioning).toHaveBeenCalledTimes(1);
      expect(props().notice?.kind).toBe('success');
      expect(props().state).toMatchObject({
        kind: 'success',
        freshness: 'stale',
      });
      expect(props().retryingTeamIds).toEqual([]);
      expect(hasRetryButton(teamA)).toBe(true);
    });

    it('팀이 사라졌다는 404여도 상태를 다시 읽어 목록을 맞춘다', async () => {
      api.retryProvisioning.mockRejectedValue(
        new ApiError(problem(404, 'APP_017')),
      );
      await renderScreen();
      api.fetchSystemStatus.mockResolvedValue(statusWith([teamB]));

      await act(async () => retryButton(teamA).click());

      expect(api.fetchSystemStatus).toHaveBeenCalledTimes(2);
      expect(props().notice?.kind).toBe('error');
      expect(hasRetryButton(teamA)).toBe(false);
    });

    it('전송 오류면 오류를 알리고 행을 남기며 상태를 다시 읽지 않고, 다시 누르면 새로 요청한다', async () => {
      api.retryProvisioning.mockRejectedValue(
        new TypeError('synthetic transport failure'),
      );
      await renderScreen();

      await act(async () => retryButton(teamA).click());

      expect(api.fetchSystemStatus).toHaveBeenCalledTimes(1);
      expect(props().notice?.kind).toBe('error');
      expect(props().notice?.message).not.toContain('synthetic transport');
      expect(props().state.kind).toBe('success');
      expect(retryButton(teamA).getAttribute('aria-disabled')).toBe('false');

      await act(async () => retryButton(teamA).click());
      expect(api.retryProvisioning).toHaveBeenCalledTimes(2);
    });

    it('서로 다른 팀은 동시에 다시 시도하고 팀마다 따로 잠근다', async () => {
      const first = Promise.withResolvers<void>();
      const second = Promise.withResolvers<void>();
      api.retryProvisioning
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise);
      await renderScreen();

      await act(async () => {
        retryButton(teamA).click();
        retryButton(teamB).click();
        retryButton(teamA).click();
      });

      expect(api.retryProvisioning.mock.calls).toEqual([
        [teamA.teamId],
        [teamB.teamId],
      ]);
      expect(props().retryingTeamIds).toEqual([teamA.teamId, teamB.teamId]);

      api.fetchSystemStatus.mockResolvedValue(statusWith([teamB]));
      await act(async () => first.resolve());
      expect(props().retryingTeamIds).toEqual([teamB.teamId]);
      expect(retryButton(teamB).getAttribute('aria-disabled')).toBe('true');
    });

    it('포커스를 쥔 행이 성공해 사라지면 포커스를 주의 필요 카드로 넘긴다', async () => {
      api.retryProvisioning.mockResolvedValue(undefined);
      await renderScreen();
      api.fetchSystemStatus.mockResolvedValue(statusWith([teamB]));
      const button = retryButton(teamA);
      button.focus();
      expect(document.activeElement).toBe(button);

      await act(async () => button.click());

      expect(hasRetryButton(teamA)).toBe(false);
      expect(document.activeElement).toBe(
        container.querySelector('[aria-label="주의 필요"]'),
      );
    });

    it('실패한 다시 시도는 포커스를 버튼에 그대로 둔다', async () => {
      api.retryProvisioning.mockRejectedValue(
        new TypeError('synthetic transport failure'),
      );
      await renderScreen();
      const button = retryButton(teamA);
      button.focus();

      await act(async () => button.click());

      expect(props().notice?.kind).toBe('error');
      expect(document.activeElement).toBe(retryButton(teamA));
    });
  });

  describe('지연 저장소', () => {
    it('더 보기를 누르면 접어 둔 지연 저장소를 펼치고 다시 누르면 접는다', async () => {
      const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(
        (name) => `jnu-oss/${name}`,
      );
      api.fetchSystemStatus.mockResolvedValue({
        ...statusWith([]),
        anomalies: [
          {
            rule: 'COLLECTION_STALE',
            severity: 'MEDIUM',
            count: names.length,
            target: null,
          },
        ],
        collectionRepositories: names.map((repositoryName, index) => ({
          repositoryName,
          programName: null,
          lastSuccessAt: new Date(Date.UTC(2026, 10, 16, index)).toISOString(),
          stale: true,
        })),
      } satisfies SystemStatus);
      await renderScreen();
      const listed = () =>
        names.filter((name) => container.textContent?.includes(name));
      const toggle = (): HTMLButtonElement => {
        const button = container.querySelector<HTMLButtonElement>(
          'button[aria-expanded]',
        );
        if (button === null) throw new Error('stale repository toggle missing');
        return button;
      };

      expect(listed()).toEqual(names.slice(0, 5));
      expect(toggle().getAttribute('aria-expanded')).toBe('false');

      await act(async () => toggle().click());
      expect(listed()).toEqual(names);
      expect(toggle().getAttribute('aria-expanded')).toBe('true');

      await act(async () => toggle().click());
      expect(listed()).toEqual(names.slice(0, 5));
      expect(toggle().getAttribute('aria-expanded')).toBe('false');
    });
  });

  describe('알림 수명', () => {
    it('성공 알림은 4초 뒤에 사라진다', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      api.retryProvisioning.mockResolvedValue(undefined);
      await renderScreen();

      await act(async () => retryButton(teamA).click());
      expect(props().notice?.kind).toBe('success');

      await act(async () => {
        vi.advanceTimersByTime(3_999);
      });
      expect(props().notice?.kind).toBe('success');
      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      expect(props().notice).toBeNull();
    });

    it('오류 알림은 시간이 지나도 남고 다음 동작을 시작할 때 지워진다', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      api.retryProvisioning.mockRejectedValueOnce(
        new TypeError('synthetic transport failure'),
      );
      await renderScreen();

      await act(async () => retryButton(teamA).click());
      await act(async () => {
        vi.advanceTimersByTime(60_000);
      });
      expect(props().notice?.kind).toBe('error');

      const pending = Promise.withResolvers<void>();
      api.retryProvisioning.mockReturnValue(pending.promise);
      await act(async () => retryButton(teamB).click());
      expect(props().notice).toBeNull();
      await act(async () => pending.resolve());
    });
  });
});
