// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
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
  // 실제 구현(handleTrigger)은 async이고 테스트가 완료를 기다려야 하므로, 공개 prop
  // 타입(`() => void`)이 아니라 런타임 실제 시그니처로 선언한다.
  readonly onTrigger: () => Promise<void>;
  readonly isTriggering: boolean;
  readonly triggerNotice: TriggerNotice | null;
};

const captured = vi.hoisted(() => ({
  props: null as CapturedViewProps | null,
}));

vi.mock('./system-status-view', () => ({
  SystemStatusView: (props: CapturedViewProps) => {
    captured.props = props;
    return null;
  },
}));

import { SystemStatusScreen } from './system-status-screen';

const baseStatus: SystemStatus = {
  health: 'NORMAL',
  dataAsOf: '2026-07-25T11:00:00.000Z',
  trackedRepositoryCount: 2,
  readyStreamCount: 6,
  backfillingStreamCount: 0,
  partialStreamCount: 0,
  retryPendingStreamCount: 0,
  oldestReadyCheckpointAt: '2026-07-25T10:00:00.000Z',
  oldestRetryPendingAt: null,
  lastCycleStartedAt: '2026-07-25T10:55:00.000Z',
  lastCycleCompletedAt: '2026-07-25T11:00:00.000Z',
  nextCycleAt: null,
  currentRunStatus: 'IDLE',
  safeReason: null,
};

const baseCollectionStreams: SystemStatusData['collectionStreams'] = [];
const baseCollectionActivity: SystemStatusData['collectionActivity'] = [];
const baseExternalCollection: SystemStatusData['externalCollection'] = {
  trackedRepositoryCount: 0,
  lastSweep: null,
  cumulativeCommitCount: 0,
  cumulativePullRequestCount: 0,
  cumulativeReleaseCount: 0,
};

function statusData(status: SystemStatus): SystemStatusData {
  return {
    status,
    collectionStreams: baseCollectionStreams,
    collectionActivity: baseCollectionActivity,
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

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    captured.props = null;
    api.fetchSystemStatus.mockReset().mockResolvedValue(statusData(baseStatus));
    api.triggerCollection.mockReset();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function renderScreen(): Promise<void> {
    await act(async () => {
      root.render(<SystemStatusScreen />);
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

    it('COL_008(전환 중) 실패는 일반 문구가 아닌 전용 quiesce 안내를 보여준다', async () => {
      api.triggerCollection.mockRejectedValue(new ApiError(problem('COL_008')));
      await renderScreen();

      await act(async () => {
        await props().onTrigger();
      });

      expect(props().triggerNotice).toEqual({
        kind: 'error',
        message:
          '저장소 전환 작업이 진행 중이라 지금은 수집을 시작할 수 없습니다. 전환이 끝난 뒤 다시 시도해 주세요.',
      });
    });

    it('COL_008이 아닌 ApiError는 일반 오류 문구를 보여준다', async () => {
      api.triggerCollection.mockRejectedValue(new ApiError(problem('COL_099')));
      await renderScreen();

      await act(async () => {
        await props().onTrigger();
      });

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
});
