import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type {
  CollectionActivityEntry,
  CollectionStreamRepository,
  SystemStatus,
  TriggerNotice,
} from '../types';
import { SystemStatusView } from './system-status-view';

const normal: SystemStatus = {
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

/**
 * 이 파일의 `render` 두 번째 인자는 실제 컴포넌트 prop 타입(`SystemStatusViewState`)이
 * 아니라 테스트 편의용 느슨한 타입이다 — success 상태에 `collectionStreams`·
 * `collectionActivity`를 매번 적지 않아도 되도록 기본값([])을 채워 넣는다. 각각을
 * 직접 검증하는 테스트만 해당 필드를 명시적으로 준다.
 */
type LooseViewState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | {
      readonly kind: 'success';
      readonly status: SystemStatus;
      readonly collectionStreams?: readonly CollectionStreamRepository[];
      readonly collectionActivity?: readonly CollectionActivityEntry[];
    };

function render(
  state: LooseViewState,
  overrides: {
    readonly isTriggering?: boolean;
    readonly triggerNotice?: TriggerNotice | null;
  } = {},
): string {
  const resolvedState =
    state.kind === 'success'
      ? {
          ...state,
          collectionStreams: state.collectionStreams ?? [],
          collectionActivity: state.collectionActivity ?? [],
        }
      : state;
  return renderToStaticMarkup(
    <SystemStatusView
      state={resolvedState}
      onRetry={() => undefined}
      onTrigger={() => undefined}
      isTriggering={overrides.isTriggering ?? false}
      triggerNotice={overrides.triggerNotice ?? null}
    />,
  );
}

/** 텍스트 바로 앞의 `<button ...>` 시작 태그만 잘라내 `disabled` 여부를 확인한다. */
function buttonTagContaining(html: string, label: string): string {
  const labelIndex = html.indexOf(label);
  if (labelIndex === -1) throw new Error(`label not found: ${label}`);
  const openIndex = html.lastIndexOf('<button', labelIndex);
  const closeIndex = html.indexOf('>', openIndex);
  return html.slice(openIndex, closeIndex + 1);
}

function findRetry(node: ReactNode): (() => void) | undefined {
  if (!node || typeof node !== 'object' || !('props' in node)) return undefined;
  const element = node as ReactElement<{
    onClick?: () => void;
    children?: ReactNode;
  }>;
  if (element.props.onClick) return element.props.onClick;
  const children = element.props.children;
  const values = Array.isArray(children) ? children : [children];
  for (const child of values) {
    const handler = findRetry(child);
    if (handler) return handler;
  }
  return undefined;
}

describe('SystemStatusView', () => {
  it('loading 상태를 busy skeleton으로 안전하게 표시한다', () => {
    const html = render({ kind: 'loading' });
    expect(html).toContain('aria-label="시스템 상태를 불러오는 중"');
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain('undefined');
  });

  it('추적 중인 저장소가 없는 EMPTY 응답은 빈 상태로 표시한다', () => {
    const html = render({
      kind: 'success',
      status: {
        ...normal,
        health: 'EMPTY',
        trackedRepositoryCount: 0,
        readyStreamCount: 0,
        oldestReadyCheckpointAt: null,
        dataAsOf: null,
        lastCycleStartedAt: null,
        lastCycleCompletedAt: null,
        safeReason: 'NO_TRACKED_REPOSITORIES',
      },
    });
    expect(html).toContain('아직 추적 중인 저장소가 없습니다');
    // 빈 화면은 "없다"로 끝나지 않고 운영자가 어디를 봐야 하는지까지 말한다.
    expect(html).toContain(
      '사업단 GitHub 조직에 수집 연동 앱이 설치되어 있는지, 조직에 저장소가 등록되어 있는지 확인해 주세요.',
    );
    expect(html).not.toContain('시스템 상태 요약');
  });

  it('저장소가 하나도 없으면 GitHub App이 무엇인지 설명한다', () => {
    const html = render({
      kind: 'success',
      status: {
        ...normal,
        health: 'EMPTY',
        trackedRepositoryCount: 0,
        safeReason: 'NO_TRACKED_REPOSITORIES',
      },
    });

    expect(html).toContain('수집 연동 앱(GitHub App)이란');
    // 개인 계정에 붙이는 앱과의 차이 + 확인할 위치가 문구에 있어야 한다.
    expect(html).toContain('개인이 자기 GitHub 계정에 설치하는 앱이 아니라');
    expect(html).toContain('사업단 GitHub 조직에 설치되며');
    expect(html).toContain('Settings → GitHub Apps');
  });

  it('수집이 정상이면 GitHub App 설명을 띄우지 않는다', () => {
    const html = render({ kind: 'success', status: normal });

    expect(html).not.toContain('수집 연동 앱(GitHub App)이란');
  });

  it('transport error는 내부 오류를 노출하지 않고 재시도를 표시한다', () => {
    const html = render({ kind: 'error' });
    expect(html).toContain('시스템 상태를 불러오지 못했습니다');
    expect(html).toContain('잠시 후 다시 시도해 주세요.');
    expect(html).toContain('다시 시도');
    expect(html).not.toContain('synthetic transport failure');
  });

  it('NORMAL 응답은 통합된 수집 상태 카드에 health, 사유, 사이클 시각을 표시한다', () => {
    const html = render({ kind: 'success', status: normal });
    expect(html).toContain('정상');
    expect(html).toContain('데이터 수집이 정상적으로 운영되고 있습니다.');
    expect(html).toContain('이번 사이클 시작');
    expect(html).toContain('최근 사이클 완료');
    expect(html).toContain('2026');
  });

  it('IDLE일 때는 run 상태 배지("수집 중")를 표시하지 않는다', () => {
    const html = render({ kind: 'success', status: normal });
    expect(html).not.toContain('수집 중');
  });

  it('PROCESSING일 때는 애니메이션 점과 함께 "수집 중" 배지를 표시한다', () => {
    const html = render({
      kind: 'success',
      status: { ...normal, currentRunStatus: 'PROCESSING' },
    });
    expect(html).toContain('수집 중');
    expect(html).toContain('before:animate-pulse');
    expect(html).toContain('motion-reduce:before:animate-none');
  });

  it.each([
    [
      'DELAYED',
      'STALE_DATA',
      '지연',
      '최근 데이터 수집이 지연되고 있습니다.',
      '아래 ‘데이터 기준 시각’이 얼마나 오래됐는지 먼저 확인하고, 지연이 이어지면 수집 연동 앱의 설치·권한 상태를 점검해 주세요.',
    ],
    [
      'PARTIAL',
      'RUN_INCOMPLETE',
      '부분 진행',
      '일부 저장소의 수집이 아직 완료되지 않았습니다.',
      '아래 ‘Stream 진행 상황’에서 ‘부분/대기’ 수가 줄고 있는지 확인하고, 다음 수집 주기 뒤에도 그대로면 사업단 관리자에게 알려 주세요.',
    ],
    [
      'FAILED',
      'UPSTREAM_RATE_LIMITED',
      '실패',
      '재시도 대기 중인 stream이 있습니다.',
      'GitHub 호출 한도가 풀리면 다음 수집 주기에 자동으로 다시 시도하므로 지금 손댈 것은 없습니다.',
    ],
  ] as const)(
    '%s 상태는 안전한 사유와 다음 행동을 함께 표시한다',
    (health, safeReason, label, copy, nextAction) => {
      const html = render({
        kind: 'success',
        status: { ...normal, health, safeReason },
      });
      expect(html).toContain(label);
      expect(html).toContain(copy);
      // 상태 서술만으로 끝나면 운영자는 다음에 무엇을 할지 알 수 없다.
      expect(html).toContain(nextAction);
      // 정상이 아닌 상태에서는 GitHub App 설명이 함께 붙는다.
      expect(html).toContain('수집 연동 앱(GitHub App)이란');
      expect(html).not.toContain('token');
      expect(html).not.toContain('githubId');
    },
  );

  it('재시도 대기 checkpoint가 있으면 표시하고 없으면 생략한다', () => {
    const withRetry = render({
      kind: 'success',
      status: {
        ...normal,
        health: 'FAILED',
        safeReason: 'UPSTREAM_RATE_LIMITED',
        retryPendingStreamCount: 1,
        oldestRetryPendingAt: '2026-07-24T00:00:00.000Z',
      },
    });
    expect(withRetry).toContain('가장 오래된 재시도 대기');

    const withoutRetry = render({ kind: 'success', status: normal });
    expect(withoutRetry).not.toContain('가장 오래된 재시도 대기');
  });

  it('다음 주기 예상 시각이 있으면 상대·절대 시각을 함께 표시하고, 없으면 생략한다', () => {
    const withNextCycle = render({
      kind: 'success',
      status: { ...normal, nextCycleAt: '2026-07-25T12:00:00.000Z' },
    });
    expect(withNextCycle).toContain('다음 주기 예상');
    expect(withNextCycle).toContain('2026');

    const withoutNextCycle = render({ kind: 'success', status: normal });
    expect(withoutNextCycle).not.toContain('다음 주기 예상');
  });

  it('요약 카드 아래에 「수집 대상 상세」 표 section을 렌더링한다', () => {
    const html = render({
      kind: 'success',
      status: normal,
      collectionStreams: [
        {
          repositoryName: 'jnu-oss/example',
          streams: [
            {
              streamType: 'COMMIT',
              bucket: 'READY',
              lastSuccessAt: '2026-07-25T10:59:00.000Z',
              lastErrorCode: null,
              lastErrorAt: null,
            },
          ],
        },
      ],
    });
    expect(html).toContain('aria-label="수집 대상 상세"');
    expect(html).toContain('jnu-oss/example');
  });

  it('「수집 대상 상세」 표 아래에 「최근 수집 활동」 피드 section을 렌더링한다', () => {
    const html = render({
      kind: 'success',
      status: normal,
      collectionActivity: [
        {
          sweepFinishedAt: '2026-08-10T09:00:00.000Z',
          cycleStartedAt: '2026-08-10T08:55:00.000Z',
          scope: 'ORG',
          insertedCommitCount: 12,
          insertedPullRequestCount: 3,
          insertedReleaseCount: 1,
          attemptedRepositoryCount: 8,
          processedRepositoryCount: 8,
          failedRepositoryCount: 0,
          cycleCompleted: true,
          stoppedForBudget: false,
        },
      ],
    });
    const streamsIndex = html.indexOf('aria-label="수집 대상 상세"');
    const activityIndex = html.indexOf('aria-label="최근 수집 활동"');
    expect(streamsIndex).toBeGreaterThan(-1);
    expect(activityIndex).toBeGreaterThan(streamsIndex);
    expect(html).toContain('커밋 12');
  });

  it('error 상태의 재시도 버튼이 전달된 handler를 호출한다', () => {
    const onRetry = vi.fn();
    const outer = SystemStatusView({
      state: { kind: 'error' },
      onRetry,
      onTrigger: () => undefined,
      isTriggering: false,
      triggerNotice: null,
    }) as ReactElement;
    const rendered = (outer.type as (props: typeof outer.props) => ReactNode)(
      outer.props,
    );
    const retry = findRetry(rendered);
    expect(retry).toBe(onRetry);
    retry?.();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('평상시에는 수집 트리거 버튼이 활성화되어 있다', () => {
    const html = render({ kind: 'success', status: normal });
    const button = buttonTagContaining(html, '지금 수집 실행');
    // Tailwind class에도 `disabled:` variant 문자열이 섞여 있어 속성 형태(`disabled=""`)로
    // 정확히 확인한다 — 부분 문자열 `disabled`만 보면 class 때문에 항상 참이 된다.
    expect(button).not.toContain('disabled=""');
  });

  it('트리거 요청이 진행 중이면 버튼을 비활성화하고 진행 문구를 보여준다', () => {
    const html = render(
      { kind: 'success', status: normal },
      { isTriggering: true },
    );
    const button = buttonTagContaining(html, '실행 요청 중');
    expect(button).toContain('disabled=""');
  });

  it('이미 수집이 진행 중(PROCESSING)이면 요청 중이 아니어도 버튼을 비활성화한다', () => {
    const html = render({
      kind: 'success',
      status: { ...normal, currentRunStatus: 'PROCESSING' },
    });
    const button = buttonTagContaining(html, '지금 수집 실행');
    expect(button).toContain('disabled=""');
  });

  it('트리거 성공 알림은 role="alert"로 즉시 통지되고 원문 오류를 노출하지 않는다', () => {
    const html = render(
      { kind: 'success', status: normal },
      {
        triggerNotice: {
          kind: 'success',
          message: '수집을 시작했습니다. 최신 상태를 다시 불러왔습니다.',
        },
      },
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('수집 요청을 보냈습니다');
    expect(html).toContain(
      '수집을 시작했습니다. 최신 상태를 다시 불러왔습니다.',
    );
  });

  it('전환(quiesce) 사유의 트리거 실패는 안내 문구를 사람이 읽을 수 있게 보여준다', () => {
    const html = render(
      { kind: 'success', status: normal },
      {
        triggerNotice: {
          kind: 'error',
          message:
            '저장소 전환 작업이 진행 중이라 지금은 수집을 시작할 수 없습니다. 전환이 끝난 뒤 다시 시도해 주세요.',
        },
      },
    );
    expect(html).toContain('수집을 시작하지 못했습니다');
    expect(html).toContain('저장소 전환 작업이 진행 중');
    expect(html).not.toContain('COL_008');
  });

  it('조직 밖 public 저장소 탐색 패널을 더 이상 렌더링하지 않는다', () => {
    const html = render({ kind: 'success', status: normal });
    expect(html).not.toContain('조직 밖 public 저장소 탐색');
    expect(html).not.toContain('discover-external-github-login');
    expect(html).not.toContain('학생 GitHub 로그인');
    expect(html).not.toContain('지금 탐색 실행');
  });

  describe('Stream 진행 상황 진행률', () => {
    it('완료율 0%: 모든 stream이 대기/backfill 상태면 0%로 표시하고 세그먼트 바를 채운다', () => {
      const html = render({
        kind: 'success',
        status: {
          ...normal,
          readyStreamCount: 0,
          backfillingStreamCount: 3,
          partialStreamCount: 2,
          retryPendingStreamCount: 1,
        },
      });
      expect(html).toContain('완료 0 / 6 stream (0%)');
      expect(html).toContain('추적 저장소 2개 × commit·PR·release 3종 stream');
    });

    it('완료율 100%: 모든 stream이 완료면 100%로 표시한다', () => {
      const html = render({
        kind: 'success',
        status: {
          ...normal,
          readyStreamCount: 6,
          backfillingStreamCount: 0,
          partialStreamCount: 0,
          retryPendingStreamCount: 0,
        },
      });
      expect(html).toContain('완료 6 / 6 stream (100%)');
    });

    it('혼합 진행률: 4구간이 섞여 있으면 반올림한 비율과 role="img" aria-label을 함께 표시한다', () => {
      const html = render({
        kind: 'success',
        status: {
          ...normal,
          readyStreamCount: 3,
          backfillingStreamCount: 2,
          partialStreamCount: 1,
          retryPendingStreamCount: 2,
        },
      });
      // 3 / 8 = 37.5% → round(37.5) = 38%
      expect(html).toContain('완료 3 / 8 stream (38%)');
      expect(html).toContain('role="img"');
      expect(html).toContain(
        'aria-label="전체 8개 stream 중 완료(READY) 3개, Backfill 중 2개, 부분·대기 1개, 재시도 대기 2개입니다."',
      );
      // 범례는 0인 구간도 표시한다.
      expect(html).toContain('완료(READY)');
      expect(html).toContain('Backfill 중');
      expect(html).toContain('부분·대기');
      expect(html).toContain('재시도 대기');
    });
  });
});
