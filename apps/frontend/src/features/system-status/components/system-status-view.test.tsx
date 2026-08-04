import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type {
  DiscoveryNotice,
  SystemStatus,
  SystemStatusViewState,
  TriggerNotice,
} from '../types';
import { SystemStatusView } from './system-status-view';

// 실제 학생 계정이 아닌 합성 fixture — PUBLIC repo에 실명/실제 계정을 남기지 않는다.
const SYNTHETIC_GITHUB_LOGIN = 'synthetic-test-login';

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
  currentRunStatus: 'IDLE',
  safeReason: null,
};

function render(
  state: SystemStatusViewState,
  overrides: {
    readonly isTriggering?: boolean;
    readonly triggerNotice?: TriggerNotice | null;
    readonly isDiscovering?: boolean;
    readonly discoveryNotice?: DiscoveryNotice | null;
    readonly onDiscover?: (githubLogin: string) => void;
  } = {},
): string {
  return renderToStaticMarkup(
    <SystemStatusView
      state={state}
      onRetry={() => undefined}
      onTrigger={() => undefined}
      isTriggering={overrides.isTriggering ?? false}
      triggerNotice={overrides.triggerNotice ?? null}
      onDiscover={overrides.onDiscover ?? (() => undefined)}
      isDiscovering={overrides.isDiscovering ?? false}
      discoveryNotice={overrides.discoveryNotice ?? null}
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

  it('NORMAL 응답의 상태, 현재 작업, 시각, stream count를 표시한다', () => {
    const html = render({ kind: 'success', status: normal });
    expect(html).toContain('정상');
    expect(html).toContain('대기 중');
    expect(html).toContain('데이터 수집이 정상적으로 운영되고 있습니다.');
    expect(html).toContain('2026');
    expect(html).toContain('추적 저장소');
    expect(html).toContain('완료(READY)');
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

  it('error 상태의 재시도 버튼이 전달된 handler를 호출한다', () => {
    const onRetry = vi.fn();
    const outer = SystemStatusView({
      state: { kind: 'error' },
      onRetry,
      onTrigger: () => undefined,
      isTriggering: false,
      triggerNotice: null,
      onDiscover: () => undefined,
      isDiscovering: false,
      discoveryNotice: null,
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

  it('탐색 패널은 GitHub 로그인 입력을 위한 label과 input을 함께 렌더링한다', () => {
    const html = render({ kind: 'success', status: normal });
    expect(html).toContain('for="discover-external-github-login"');
    expect(html).toContain('id="discover-external-github-login"');
    expect(html).toContain('학생 GitHub 로그인');
  });

  it('탐색 입력이 비어 있으면 탐색 버튼을 비활성화한다', () => {
    const html = render({ kind: 'success', status: normal });
    const button = buttonTagContaining(html, '지금 탐색 실행');
    expect(button).toContain('disabled=""');
  });

  it('탐색이 진행 중이면 버튼을 비활성화하고 진행 문구를 보여준다', () => {
    const html = render(
      { kind: 'success', status: normal },
      { isDiscovering: true },
    );
    const button = buttonTagContaining(html, '탐색 중');
    expect(button).toContain('disabled=""');
  });

  it('탐색 성공 알림은 4개 집계 필드를 모두 표시한다', () => {
    const html = render(
      { kind: 'success', status: normal },
      {
        discoveryNotice: {
          kind: 'success',
          githubLogin: SYNTHETIC_GITHUB_LOGIN,
          discoveredCount: 5,
          upsertedCount: 3,
          skippedOrgProvisionedCount: 2,
        },
      },
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('저장소 탐색을 완료했습니다');
    expect(html).toContain(SYNTHETIC_GITHUB_LOGIN);
    expect(html).toContain('>5<');
    expect(html).toContain('>3<');
    expect(html).toContain('>2<');
  });

  it('탐색 실패(학생 없음)는 사람이 읽을 수 있는 안내만 보여주고 원문 코드를 노출하지 않는다', () => {
    const html = render(
      { kind: 'success', status: normal },
      {
        discoveryNotice: {
          kind: 'error',
          message: '해당 GitHub 계정으로 등록된 학생을 찾을 수 없습니다.',
        },
      },
    );
    expect(html).toContain('저장소 탐색에 실패했습니다');
    expect(html).toContain(
      '해당 GitHub 계정으로 등록된 학생을 찾을 수 없습니다.',
    );
    expect(html).not.toContain('COL_009');
  });
});
