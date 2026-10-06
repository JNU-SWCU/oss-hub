import { describe, expect, it, vi } from 'vitest';
import { ApiError, apiPath } from '@/lib/api-client';
import {
  blocksFurtherDecisions,
  decisionInputFor,
  decisionNoticeFor,
  DECISION_OPTIONS,
  runDecisionWithRefetch,
  type DecisionRefetchResult,
} from './application-decision-refetch';
import type { ApplicationListItem } from './types';

const APPLICATION = { id: 'synthetic-application' } as ApplicationListItem;

function problem(status: number, code = 'APP_000') {
  return new ApiError({
    type: 'about:blank',
    title: 'Synthetic',
    status,
    detail: 'Synthetic problem',
    instance: apiPath('applications/synthetic-application'),
    code,
  });
}

function ports(
  decide: () => Promise<unknown>,
  refetch: () => Promise<ApplicationListItem>,
) {
  return { decide: vi.fn(decide), refetch: vi.fn(refetch) };
}

const DECISION_CASES = [
  ['2xx', () => Promise.resolve(undefined), 'applied'],
  ['409', () => Promise.reject(problem(409)), 'stale'],
  ['404', () => Promise.reject(problem(404, 'APP_001')), 'gone'],
  ['5xx', () => Promise.reject(problem(500)), 'unknown'],
  ['network', () => Promise.reject(new TypeError('network')), 'unknown'],
] as const;

describe('runDecisionWithRefetch — 판정 결과 축', () => {
  it.each(DECISION_CASES)(
    '판정이 %s 로 끝나도 재조회는 무조건 한다',
    async (_label, decide, expected) => {
      const p = ports(decide, () => Promise.resolve(APPLICATION));

      const result = await runDecisionWithRefetch(p);

      expect(p.refetch).toHaveBeenCalledTimes(1);
      expect(result.outcome.kind).toBe(expected);
      expect(result.kind).toBe('refreshed');
    },
  );

  it('성공해도 응답 바디가 아니라 재조회 결과를 행 상태로 쓴다', async () => {
    const refreshed = { id: 'synthetic-application' } as ApplicationListItem;
    const p = ports(
      () => Promise.resolve({ status: 'APPROVED' }),
      () => Promise.resolve(refreshed),
    );

    const result = await runDecisionWithRefetch(p);

    expect(result.kind).toBe('refreshed');
    if (result.kind === 'refreshed') {
      expect(result.application).toBe(refreshed);
    }
  });
});

describe('runDecisionWithRefetch — 재조회 결과 축', () => {
  it.each(DECISION_CASES)(
    '판정이 %s 여도 재조회 404 면 행을 거둔다',
    async (_label, decide) => {
      const p = ports(decide, () => Promise.reject(problem(404)));

      const result = await runDecisionWithRefetch(p);

      expect(result.kind).toBe('removed');
    },
  );

  it.each(DECISION_CASES)(
    '판정이 %s 여도 재조회가 깨지면 확인 불가로 둔다',
    async (_label, decide) => {
      const p = ports(decide, () => Promise.reject(problem(500)));

      const result = await runDecisionWithRefetch(p);

      expect(result.kind).toBe('refetch-failed');
    },
  );

  it('재조회가 네트워크로 깨져도 확인 불가다 — 404 만 행 제거다', async () => {
    const p = ports(
      () => Promise.resolve(undefined),
      () => Promise.reject(new TypeError('network')),
    );

    const result = await runDecisionWithRefetch(p);

    expect(result.kind).toBe('refetch-failed');
  });

  it('판정 5xx 뒤 재조회가 성공하면 실패로 말하지 않는다', async () => {
    const p = ports(
      () => Promise.reject(problem(503)),
      () => Promise.resolve(APPLICATION),
    );

    const result = await runDecisionWithRefetch(p);

    expect(result.kind).toBe('refreshed');
    expect(result.outcome.kind).toBe('unknown');
  });
});

describe('blocksFurtherDecisions', () => {
  it('재조회가 실패했을 때만 다음 판정을 막는다', () => {
    const blocked: DecisionRefetchResult = {
      kind: 'refetch-failed',
      outcome: { kind: 'applied' },
      error: problem(500),
    };

    expect(blocksFurtherDecisions(blocked)).toBe(true);
  });

  it.each([
    [
      'refreshed',
      {
        kind: 'refreshed',
        outcome: { kind: 'stale' },
        application: APPLICATION,
      } satisfies DecisionRefetchResult,
    ],
    [
      'removed',
      {
        kind: 'removed',
        outcome: { kind: 'gone' },
      } satisfies DecisionRefetchResult,
    ],
  ])('%s 는 막지 않는다 — 화면이 진짜 상태를 들고 있다', (_label, result) => {
    expect(blocksFurtherDecisions(result)).toBe(false);
  });
});

describe('DECISION_OPTIONS', () => {
  it('세 상태를 담고 목록·상세가 같은 배열을 쓴다', () => {
    expect(DECISION_OPTIONS).toEqual(['SUBMITTED', 'APPROVED', 'REJECTED']);
  });
});

describe('decisionInputFor', () => {
  it('승인과 검토 대기 복귀는 사유 없이 바로 보낸다', () => {
    expect(decisionInputFor('APPROVED', '')).toEqual({ action: 'APPROVE' });
    expect(decisionInputFor('SUBMITTED', '')).toEqual({ action: 'REVERT' });
  });

  it.each(['', '   ', '\n\t'])(
    '반려는 사유가 비면(%j) 요청을 만들지 않는다',
    (reason) => {
      expect(decisionInputFor('REJECTED', reason)).toBeNull();
    },
  );

  it('반려 사유는 앞뒤 공백을 접어 보낸다', () => {
    expect(decisionInputFor('REJECTED', '  서류가 비었습니다  ')).toEqual({
      action: 'REJECT',
      reason: '서류가 비었습니다',
    });
  });
});

describe('decisionNoticeFor', () => {
  it('요청한 대로 됐으면 할 말이 없다', () => {
    expect(
      decisionNoticeFor({
        kind: 'refreshed',
        outcome: { kind: 'applied' },
        application: APPLICATION,
      }),
    ).toBeNull();
  });

  it.each([
    [
      'refetch-failed',
      {
        kind: 'refetch-failed',
        outcome: { kind: 'applied' },
        error: problem(500),
      } satisfies DecisionRefetchResult,
      '확인하지 못했습니다',
    ],
    [
      'removed',
      {
        kind: 'removed',
        outcome: { kind: 'gone' },
      } satisfies DecisionRefetchResult,
      '더 이상 없습니다',
    ],
    [
      'stale',
      {
        kind: 'refreshed',
        outcome: { kind: 'stale' },
        application: APPLICATION,
      } satisfies DecisionRefetchResult,
      '다른 사람이 먼저 판정했습니다',
    ],
    [
      'unknown',
      {
        kind: 'refreshed',
        outcome: { kind: 'unknown', error: problem(500) },
        application: APPLICATION,
      } satisfies DecisionRefetchResult,
      '다시 시도해 주세요',
    ],
  ])('%s 는 그 상황에 맞는 한 줄을 준다', (_label, result, expected) => {
    expect(decisionNoticeFor(result)).toContain(expected);
  });
});
