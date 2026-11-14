import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { notifyManager, QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient } from '../../../../test-support/render-with-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiPath, type ProblemDetail } from '@/lib/api-client';
import type {
  SystemStatus,
  SystemStatusData,
  SystemStatusViewState,
  TriggerNotice,
} from '../types';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const api = vi.hoisted(() => ({
  fetchSystemStatus: vi.fn(),
  triggerCollection: vi.fn(),
}));

vi.mock('../api', () => api);

type CapturedViewProps = {
  readonly state: SystemStatusViewState;
  readonly onRetry: () => void;

  readonly onTrigger: () => Promise<void>;
  readonly isTriggering: boolean;
  readonly triggerNotice: TriggerNotice | null;
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

const baseStatus: SystemStatus = {
  health: 'NORMAL',
  trackedRepositoryCount: 2,
  staleRepositoryCount: 0,
  lastSuccessAt: '2026-07-25T11:00:00.000Z',
  nextCycleAt: null,
  currentRunStatus: 'IDLE',
  safeReason: null,
};

const baseCollectionRepositories: SystemStatusData['collectionRepositories'] =
  [];
const baseExternalCollection: SystemStatusData['externalCollection'] = {
  trackedRepositoryCount: 0,
  lastSuccessAt: null,
};

function statusData(status: SystemStatus): SystemStatusData {
  return {
    status,
    collectionRepositories: baseCollectionRepositories,
    externalCollection: baseExternalCollection,
  };
}

function problem(code: string): ProblemDetail {
  return {
    type: 'about:blank',
    title: 'error',
    status: 409,
    detail: 'synthetic problem detail',
    instance: apiPath('admin/collection/trigger'),
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
    api.fetchSystemStatus.mockReset().mockResolvedValue(statusData(baseStatus));
    api.triggerCollection.mockReset();
  });

  afterEach(async () => {
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

  describe('handleTrigger', () => {
    it('202 성공이면 성공 알림을 만들고 최신 상태를 조용히 재조회한다', async () => {
      api.triggerCollection.mockResolvedValue({
        status: 'PENDING',
        runId: 'run-1',
      });
      api.fetchSystemStatus
        .mockResolvedValueOnce(statusData(baseStatus))
        .mockResolvedValueOnce(
          statusData({ ...baseStatus, trackedRepositoryCount: 9 }),
        );
      await renderScreen();

      await act(async () => {
        await props().onTrigger();
      });

      expect(props().triggerNotice?.kind).toBe('success');
      expect(api.fetchSystemStatus).toHaveBeenCalledTimes(2);
      expect(props().state).toMatchObject({
        kind: 'success',
        status: { trackedRepositoryCount: 9 },
      });
    });

    it('ApiError 실패는 일반 오류 문구를 보여주고 상태를 다시 읽지 않는다', async () => {
      api.triggerCollection.mockRejectedValue(new ApiError(problem('COL_006')));
      await renderScreen();

      await act(async () => {
        await props().onTrigger();
      });

      expect(api.fetchSystemStatus).toHaveBeenCalledTimes(1);
      expect(props().triggerNotice).toEqual({
        kind: 'error',
        message: '수집을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      });
    });

    it('ApiError가 아닌 전송 오류도 화면을 깨뜨리지 않고 일반 오류 문구를 보여준다', async () => {
      api.triggerCollection.mockRejectedValue(
        new TypeError('synthetic transport failure'),
      );
      await renderScreen();

      await act(async () => {
        await props().onTrigger();
      });

      expect(props().triggerNotice).toEqual({
        kind: 'error',
        message: '수집을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      });
      expect(props().state.kind).toBe('success');
    });
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
      status: baseStatus,
    });
    expect(container.textContent).toContain('수집 요청을 접수했습니다.');
    expect(container.textContent).toContain('마지막으로 확인한 상태');
    expect(container.textContent).not.toContain(
      '최신 상태를 다시 불러왔습니다',
    );
    api.fetchSystemStatus.mockRejectedValueOnce(new Error('network'));
    await act(async () => props().onRetry());
    expect(container.textContent).toContain('마지막으로 확인한 상태');
    api.fetchSystemStatus.mockResolvedValue(
      statusData({ ...baseStatus, trackedRepositoryCount: 9 }),
    );
    await act(async () => props().onRetry());
    expect(props().state).toMatchObject({
      status: { trackedRepositoryCount: 9 },
    });
    expect(container.textContent).not.toContain('마지막으로 확인한 상태');
    expect(api.triggerCollection).toHaveBeenCalledTimes(1);
    expect(api.fetchSystemStatus).toHaveBeenCalledTimes(4);
  });

  it('수동 조회보다 늦게 시작한 접수 후 조회 결과를 이전 응답이 덮지 않는다', async () => {
    await renderScreen();
    const older = Promise.withResolvers<SystemStatusData>();
    api.fetchSystemStatus.mockReturnValueOnce(older.promise);
    await act(async () => props().onRetry());
    api.triggerCollection.mockResolvedValue({
      status: 'PENDING',
      runId: 'run-1',
    });
    const latest = { ...baseStatus, lastSuccessAt: '2026-07-26T11:00:00.000Z' };
    api.fetchSystemStatus.mockResolvedValueOnce(statusData(latest));
    await act(async () => props().onTrigger());
    await act(async () => older.resolve(statusData(baseStatus)));
    expect(props().state).toMatchObject({ kind: 'success', status: latest });
  });
});
