import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type {
  CollectionRepositoryStatus,
  ExternalCollectionStatus,
  SystemStatus,
  TriggerNotice,
} from '../types';
import { SystemStatusView } from './system-status-view';

const normal: SystemStatus = {
  health: 'NORMAL',
  trackedRepositoryCount: 2,
  staleRepositoryCount: 0,
  lastSuccessAt: '2026-07-25T11:00:00.000Z',
  nextCycleAt: null,
  currentRunStatus: 'IDLE',
  safeReason: null,
};

const emptyExternalCollection: ExternalCollectionStatus = {
  trackedRepositoryCount: 0,
  lastSuccessAt: null,
};

type LooseViewState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | {
      readonly kind: 'success';
      readonly status: SystemStatus;
      readonly collectionRepositories?: readonly CollectionRepositoryStatus[];
      readonly externalCollection?: ExternalCollectionStatus;
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
          freshness: 'current' as const,
          collectionRepositories: state.collectionRepositories ?? [],
          externalCollection:
            state.externalCollection ?? emptyExternalCollection,
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
    onRetry?: () => void;
    children?: ReactNode;
  }>;

  if (element.props.onRetry) return element.props.onRetry;
  if (element.props.onClick) return element.props.onClick;
  const children = element.props.children;
  const values = Array.isArray(children)
    ? (children as readonly ReactNode[])
    : [children];
  for (const child of values) {
    const handler = findRetry(child);
    if (handler) return handler;
  }
  return undefined;
}

describe('SystemStatusView', () => {
  it('loading 상태를 busy skeleton으로 안전하게 표시한다', () => {
    const html = render({ kind: 'loading' });
    expect(html).toContain('role="status"');
    expect(html).toContain('시스템 상태를 불러오는 중');
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
        lastSuccessAt: null,
        safeReason: 'NO_TRACKED_REPOSITORIES',
      },
    });
    expect(html).toContain('아직 추적 중인 저장소가 없습니다');

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

    expect(html).toContain('수집 앱 설치·권한 확인');

    expect(html).toContain('개인 계정이 아닌 조직에 설치');
    expect(html).toContain('사업단 GitHub 조직의 Settings');
    expect(html).toContain('Settings → GitHub Apps');
  });

  it('수집이 정상이면 GitHub App 설명을 띄우지 않는다', () => {
    const html = render({ kind: 'success', status: normal });

    expect(html).not.toContain('수집 앱 설치·권한 확인');
  });

  it('transport error는 내부 오류를 노출하지 않고 재시도를 표시한다', () => {
    const html = render({ kind: 'error' });
    expect(html).toContain('시스템 상태를 불러오지 못했습니다');
    expect(html).toContain('잠시 후 다시 시도해 주세요.');
    expect(html).toContain('다시 시도');
    expect(html).not.toContain('synthetic transport failure');
  });

  it('NORMAL 응답은 통합된 수집 상태 카드에 health, 사유, 추적·지연 저장소 수를 표시한다', () => {
    const html = render({ kind: 'success', status: normal });
    expect(html).toContain('정상');
    expect(html).toContain('데이터 수집이 정상적으로 운영되고 있습니다.');
    expect(html).toContain('추적 저장소');
    expect(html).toContain('지연 저장소');
    expect(html).not.toContain('전체 순회');
  });

  it('IDLE일 때는 run 상태 배지("수집 중")를 표시하지 않는다', () => {
    const html = render({ kind: 'success', status: normal });
    expect(html).not.toMatch(/data-slot="status-badge"[^>]*>수집 중<\/span>/);
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

  it('DELAYED 상태는 지연 사유와 다음 행동을 함께 표시한다', () => {
    const html = render({
      kind: 'success',
      status: {
        ...normal,
        health: 'DELAYED',
        staleRepositoryCount: 1,
        safeReason: 'STALE_DATA',
      },
    });
    expect(html).toContain('지연');
    expect(html).toContain(
      '마지막 수집 성공이 2시간보다 오래된 저장소가 있습니다.',
    );
    expect(html).toContain(
      '아래 ‘수집 대상 상세’에서 지연된 저장소를 확인하고',
    );
    expect(html).toContain('수집 앱 설치·권한 확인');
    expect(html).not.toContain('token');
    expect(html).not.toContain('githubId');
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

  it('요약 카드 아래에 저장소별 마지막 수집 성공과 지연을 지연 먼저 보여준다', () => {
    const html = render({
      kind: 'success',
      status: { ...normal, health: 'DELAYED', staleRepositoryCount: 1 },
      collectionRepositories: [
        {
          repositoryName: 'jnu-oss/fresh',
          programName: '오픈소스 입문 프로그램',
          lastSuccessAt: '2026-07-25T10:59:00.000Z',
          stale: false,
        },
        {
          repositoryName: 'jnu-oss/late',
          programName: null,
          lastSuccessAt: '2026-07-25T07:00:00.000Z',
          stale: true,
        },
        {
          repositoryName: 'jnu-oss/new',
          programName: null,
          lastSuccessAt: null,
          stale: false,
        },
      ],
    });
    expect(html).toContain('aria-label="수집 대상 상세"');
    expect(html).toContain('지연 1 / 전체 3');
    expect(html.indexOf('jnu-oss/late')).toBeLessThan(
      html.indexOf('jnu-oss/fresh'),
    );
    expect(html).toContain('수집 전');
    expect(html).toContain('아직 성공한 수집 없음');
    expect(html).not.toContain('Commit');
  });

  it('마지막 수집 성공 시각을 상대 나이와 함께 표시하고, 없으면 아직 없다고 표시한다', () => {
    const succeeded = render({ kind: 'success', status: normal });
    expect(succeeded).toContain('마지막 수집 성공');
    expect(succeeded).toContain('2026');
    expect(succeeded).not.toContain('최근 수집 활동');

    const never = render({
      kind: 'success',
      status: { ...normal, lastSuccessAt: null },
    });
    expect(never).toContain('아직 성공한 수집 없음');
  });

  describe('외부 저장소 수집 section', () => {
    it('연결된 external 저장소가 0개면 이유와 다음 행동을 설명하는 빈 상태를 보여준다', () => {
      const html = render({ kind: 'success', status: normal });
      expect(html).toContain('aria-label="외부 저장소 수집"');
      expect(html).toContain('수집 대상 학생 개인 저장소가 없습니다');

      expect(html).not.toContain('매시 정각 자동으로 실행되고 있습니다');
      expect(html).toContain('저장소를 연결하면 바로 수집을 시작합니다');

      expect(html).toContain(
        '팀장이나 교직원이 프로그램 팀 화면에서 조직 밖 공개 저장소 주소를',
      );
      expect(html).not.toContain('>OWN<');
      expect(html).not.toContain('저장소 탐색을 실행');

      expect(html).toContain('수집 대상 학생 개인 저장소가 없습니다');
      expect(html).not.toContain('탐색을 실행한 학생이 없어');
    });

    it('org가 EMPTY 상태여도 external 섹션은 계속 렌더링한다(서로 독립된 파이프라인)', () => {
      const html = render({
        kind: 'success',
        status: {
          ...normal,
          health: 'EMPTY',
          safeReason: 'NO_TRACKED_REPOSITORIES',
        },
      });
      expect(html).toContain('aria-label="외부 저장소 수집"');
    });

    it('연결된 external 저장소가 있으면 추적 수와 마지막 수집 성공 시각을 표시한다', () => {
      const html = render({
        kind: 'success',
        status: normal,
        externalCollection: {
          trackedRepositoryCount: 5,
          lastSuccessAt: '2026-08-10T09:00:00.000Z',
        },
      });
      expect(html).toContain('5개 추적 중');
      expect(html).toContain('5개');
      expect(html).toContain('마지막 수집 성공');
      expect(html).not.toContain('Commit 40');
      expect(html).not.toContain('수집 대상 학생 개인 저장소가 없습니다');
    });

    it('org 요약 카드의 추적 저장소 수는 external 값과 섞이지 않는다', () => {
      const html = render({
        kind: 'success',
        status: { ...normal, trackedRepositoryCount: 2 },
        externalCollection: {
          trackedRepositoryCount: 5,
          lastSuccessAt: null,
        },
      });

      expect(html).toMatch(/추적 저장소<\/dt><dd[^>]*>2(<!-- -->)?개/);
      expect(html).toContain('5개 추적 중');
    });
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
});
