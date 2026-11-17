import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ActionNotice,
  ProvisioningFailedTeam,
  SystemStatus,
} from '../types';
import { SystemStatusView } from './system-status-view';

const NOW = new Date('2026-11-17T00:32:00.000Z');

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
  lastErrorCode: null,
  updatedAt: '2026-11-16T13:40:00.000Z',
};

const base: SystemStatus = {
  collection: {
    health: 'NORMAL',
    trackedRepositoryCount: 42,
    staleRepositoryCount: 0,
    lastSuccessAt: '2026-11-17T00:00:00.000Z',
    nextCycleAt: '2026-11-17T01:00:00.000Z',
    currentRunStatus: 'IDLE',
  },
  provisioning: {
    pending: 3,
    processing: 1,
    retryable: 2,
    failedFinal: 2,
    failedTeams: [teamA, teamB],
  },
  mail: { sent7d: 1280, failed7d: 3, lastSentAt: '2026-11-17T00:00:00.000Z' },
  anomalies: [
    { rule: 'PROVISIONING_FAILED', severity: 'HIGH', count: 2, target: null },
    { rule: 'MAIL_FAILED', severity: 'MEDIUM', count: 3, target: null },
    {
      rule: 'OFF_HOURS_ADMIN_CHANGE',
      severity: 'MEDIUM',
      count: 1,
      target: { kind: 'USER', id: 'user/42' },
    },
  ],
};

const clear: SystemStatus = {
  ...base,
  provisioning: {
    pending: 0,
    processing: 0,
    retryable: 0,
    failedFinal: 0,
    failedTeams: [],
  },
  mail: { sent7d: 0, failed7d: 0, lastSentAt: null },
  anomalies: [],
};

interface Overrides {
  readonly freshness?: 'current' | 'refreshing' | 'stale';
  readonly isTriggering?: boolean;
  readonly retryingTeamIds?: readonly string[];
  readonly notice?: ActionNotice | null;
}

function render(
  state: 'loading' | 'error' | SystemStatus,
  overrides: Overrides = {},
): string {
  return renderToStaticMarkup(
    <SystemStatusView
      state={
        typeof state === 'string'
          ? { kind: state }
          : {
              kind: 'success',
              freshness: overrides.freshness ?? 'current',
              status: state,
            }
      }
      onReload={() => undefined}
      onTrigger={() => undefined}
      isTriggering={overrides.isTriggering ?? false}
      onRetryProvisioning={() => undefined}
      retryingTeamIds={overrides.retryingTeamIds ?? []}
      notice={overrides.notice ?? null}
    />,
  );
}

function text(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

function attentionCard(html: string): string {
  const start = html.indexOf('aria-label="주의 필요"');
  const end = html.indexOf('data-slot="section-heading"');
  if (start === -1 || end === -1) throw new Error('attention card not found');
  return html.slice(start, end);
}

function areaRows(html: string): string[] {
  return html.split('data-slot="list-row"').slice(1);
}

function badgeVariants(fragment: string): string[] {
  return [
    ...fragment.matchAll(
      /data-slot="status-badge"[^>]*data-variant="([a-z]+)"/g,
    ),
  ].map((match) => match[1] ?? '');
}

function openingTags(fragment: string, tag: string): string[] {
  return fragment.match(new RegExp(`<${tag}\\b[^>]*>`, 'g')) ?? [];
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
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loading 상태를 busy skeleton으로 안전하게 표시한다', () => {
    const html = render('loading');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain('undefined');
  });

  it('transport error는 내부 오류를 노출하지 않고 재시도를 표시한다', () => {
    const html = render('error');
    expect(html).toContain('data-slot="failure-state"');
    expect(openingTags(html, 'button')).toHaveLength(1);
    expect(html).not.toContain('aria-label="주의 필요"');
  });

  it('error 상태의 재시도 버튼이 전달된 handler를 호출한다', () => {
    const onReload = vi.fn();
    const outer = SystemStatusView({
      state: { kind: 'error' },
      onReload,
      onTrigger: () => undefined,
      isTriggering: false,
      onRetryProvisioning: () => undefined,
      retryingTeamIds: [],
      notice: null,
    }) as ReactElement;
    const rendered = (outer.type as (props: typeof outer.props) => ReactNode)(
      outer.props,
    );
    const retry = findRetry(rendered);
    expect(retry).toBe(onReload);
    retry?.();
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  describe('주의 필요', () => {
    it('구역 현황보다 먼저 나오고 이상 징후를 받은 순서와 심각도대로 보여준다', () => {
      const html = render(base);
      const card = attentionCard(html);

      expect(html.indexOf('aria-label="주의 필요"')).toBeLessThan(
        html.indexOf('data-slot="section-heading"'),
      );
      expect(badgeVariants(card)).toEqual(['rejected', 'pending', 'pending']);
      const counts = [...text(card).matchAll(/(\d+)건/g)].map(
        (match) => match[1],
      );
      expect(counts).toEqual(['2', '3', '1']);
    });

    it('target이 USER면 사용자 상세 주소를 직접 만들고 null이면 링크를 만들지 않는다', () => {
      const card = attentionCard(render(base));
      const hrefs = [...card.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map(
        (match) => match[1],
      );

      expect(hrefs).toEqual(['/dashboard/users/user%2F42']);
    });

    it('이상 징후가 없으면 목록과 버튼 없이 한 줄만 보여준다', () => {
      const card = attentionCard(render(clear));

      expect(text(card)).toContain('이상 없음');
      expect(openingTags(card, 'li')).toEqual([]);
      expect(openingTags(card, 'button')).toEqual([]);
      expect(openingTags(card, 'h2')).toEqual([]);
    });

    it('저장소 발급 실패 아래에 실패 팀을 나열하고 팀마다 다시 시도 버튼을 둔다', () => {
      const card = attentionCard(render(base));
      const buttons = openingTags(card, 'button');

      expect(buttons).toHaveLength(2);
      expect(buttons[0]).toContain(
        'aria-label="리베이스 저장소 발급 다시 시도"',
      );
      expect(buttons[1]).toContain('aria-label="머지왕 저장소 발급 다시 시도"');
      expect(text(card)).toContain('리베이스 합성 클라우드 캠프');
      expect(text(card)).toContain('NAME_CONFLICT · 11.17 09:12');
      expect(card).toMatch(/datetime="2026-11-16T13:40:00\.000Z"/i);
    });

    it('오류 코드가 없는 팀은 시각만 보여준다', () => {
      const card = attentionCard(render(base));

      expect(openingTags(card, 'code')).toHaveLength(1);
      expect(text(card)).toContain('머지왕 합성 클라우드 캠프11.16 22:40');
    });

    it('다시 시도 중인 팀의 버튼만 비활성으로 표시하고 포커스는 잃지 않게 둔다', () => {
      const card = attentionCard(
        render(base, { retryingTeamIds: [teamA.teamId] }),
      );
      const [first, second] = openingTags(card, 'button');

      expect(first).toContain('aria-disabled="true"');
      expect(first).toContain('aria-label="리베이스 저장소 발급 다시 시도 중"');
      expect(first).not.toContain('disabled=""');
      expect(second).toContain('aria-disabled="false"');
    });

    it('실패 팀 목록이 비어 있는 발급 실패 징후는 버튼 없는 한 줄로 보여준다', () => {
      const card = attentionCard(
        render({
          ...base,
          provisioning: { ...base.provisioning, failedTeams: [] },
        }),
      );

      expect(badgeVariants(card)).toEqual(['rejected', 'pending', 'pending']);
      expect(openingTags(card, 'button')).toEqual([]);
    });
  });

  describe('구역 현황', () => {
    it('저장소 발급, 활동 수집, 알림 메일 순서로 수치를 보여준다', () => {
      const rows = areaRows(render(base)).map(text);

      expect(rows).toHaveLength(3);
      expect(rows[0]).toContain(
        '대기 중 3 · 생성 중 1 · 재시도 대기 2 · 생성 실패 2',
      );
      expect(rows[1]).toContain(
        '추적 저장소 42개 · 지연 저장소 0개 · 마지막 수집 성공 32분 전 · 다음 주기 예상 28분 후',
      );
      expect(rows[2]).toContain(
        '최근 7일 발송 1,280건 · 실패 3건 · 마지막 발송 11.17 09:00',
      );
    });

    it('실패가 있는 구역과 없는 구역을 배지로 구분한다', () => {
      const failing = areaRows(render(base)).map(badgeVariants);
      const healthy = areaRows(render(clear)).map(badgeVariants);

      expect(failing).toEqual([['rejected'], ['approved'], ['pending']]);
      expect(healthy).toEqual([['approved'], ['approved'], ['approved']]);
    });

    it.each([
      ['EMPTY', 'closed'],
      ['NORMAL', 'approved'],
      ['DELAYED', 'pending'],
    ] as const)('활동 수집 %s 상태를 %s 배지로 보여준다', (health, variant) => {
      const rows = areaRows(
        render({ ...base, collection: { ...base.collection, health } }),
      );

      expect(badgeVariants(rows[1] ?? '')).toEqual([variant]);
    });

    it('수집 기록과 다음 주기가 없으면 기록 없음으로 적고 다음 주기는 생략한다', () => {
      const rows = areaRows(
        render({
          ...clear,
          collection: {
            ...base.collection,
            lastSuccessAt: null,
            nextCycleAt: null,
          },
        }),
      ).map(text);

      expect(rows[1]).toContain('마지막 수집 성공 기록 없음');
      expect(rows[1]).not.toContain('다음 주기 예상');
      expect(rows[2]).toContain('마지막 발송 기록 없음');
    });

    it('PROCESSING일 때만 움직이는 수집 중 배지를 더한다', () => {
      const idle = areaRows(render(base));
      const processing = areaRows(
        render({
          ...base,
          collection: { ...base.collection, currentRunStatus: 'PROCESSING' },
        }),
      );

      expect(badgeVariants(idle[1] ?? '')).toEqual(['approved']);
      expect(badgeVariants(processing[1] ?? '')).toEqual([
        'approved',
        'recruiting',
      ]);
      expect(processing[1]).toContain('before:animate-pulse');
      expect(processing[1]).toContain('motion-reduce:before:animate-none');
    });
  });

  describe('지금 수집 실행', () => {
    it('평상시에는 활성화되어 있다', () => {
      const button = buttonTagContaining(render(base), '지금 수집 실행');

      expect(button).not.toContain('disabled=""');
    });

    it('요청이 진행 중이면 비활성화하고 진행 문구를 보여준다', () => {
      const html = render(base, { isTriggering: true });

      expect(buttonTagContaining(html, '실행 요청 중')).toContain(
        'disabled=""',
      );
    });

    it('이미 수집이 진행 중이면 요청 중이 아니어도 비활성화한다', () => {
      const html = render({
        ...base,
        collection: { ...base.collection, currentRunStatus: 'PROCESSING' },
      });

      expect(buttonTagContaining(html, '지금 수집 실행')).toContain(
        'disabled=""',
      );
    });
  });

  describe('알림', () => {
    it('알림이 없으면 status도 alert도 만들지 않는다', () => {
      const html = render(base);

      expect(html).not.toContain('role="status"');
      expect(html).not.toContain('role="alert"');
    });

    it('성공 알림은 status로, 오류 알림은 alert로 알린다', () => {
      const success = render(base, {
        notice: { kind: 'success', message: '합성 성공 알림' },
      });
      const failure = render(base, {
        notice: { kind: 'error', message: '합성 오류 알림' },
      });

      expect(success).toMatch(/<p role="status"[^>]*>합성 성공 알림<\/p>/);
      expect(success).not.toContain('role="alert"');
      expect(failure).toMatch(/role="alert"[^>]*>.*합성 오류 알림/);
      expect(failure).not.toContain('role="status"');
    });

    it('알림은 목록 뒤에 떠서 실패 팀 행을 밀어내지 않는다', () => {
      const html = render(base, {
        notice: { kind: 'error', message: '합성 오류 알림' },
      });

      expect(html.indexOf('합성 오류 알림')).toBeGreaterThan(
        html.lastIndexOf('data-slot="list-row"'),
      );
    });

    it('최신 조회가 실패하면 마지막 상태와 함께 다시 불러오기 버튼을 보여준다', () => {
      const html = render(base, { freshness: 'stale' });

      expect(html).toContain('role="alert"');
      expect(openingTags(attentionCard(html), 'button')).toHaveLength(2);
      expect(buttonTagContaining(html, '상태 다시 불러오기')).not.toContain(
        'disabled=""',
      );
    });

    it('다시 불러오는 동안에는 화면을 밀지 않는 status로만 알린다', () => {
      const html = render(base, { freshness: 'refreshing' });

      expect(html).toMatch(/<p role="status" class="sr-only">/);
    });
  });
});
