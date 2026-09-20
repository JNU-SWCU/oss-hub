import { describe, expect, it, vi } from 'vitest';
import { ApiError, apiPath } from '@/lib/api-client';
import {
  blocksFurtherDecisions,
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
      // Given
      const p = ports(decide, () => Promise.resolve(APPLICATION));

      // When
      const result = await runDecisionWithRefetch(p);

      // Then: 어떤 결과든 그 행을 다시 읽는다 — f-row-decision-refresh.
      expect(p.refetch).toHaveBeenCalledTimes(1);
      expect(result.outcome.kind).toBe(expected);
      expect(result.kind).toBe('refreshed');
    },
  );

  it('성공해도 응답 바디가 아니라 재조회 결과를 행 상태로 쓴다', async () => {
    // Given: 판정 응답은 다른 값을 돌려주지만 화면은 그것을 쓰지 않는다.
    const refreshed = { id: 'synthetic-application' } as ApplicationListItem;
    const p = ports(
      () => Promise.resolve({ status: 'APPROVED' }),
      () => Promise.resolve(refreshed),
    );

    // When
    const result = await runDecisionWithRefetch(p);

    // Then
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
      // Given
      const p = ports(decide, () => Promise.reject(problem(404)));

      // When
      const result = await runDecisionWithRefetch(p);

      // Then
      expect(result.kind).toBe('removed');
    },
  );

  it.each(DECISION_CASES)(
    '판정이 %s 여도 재조회가 깨지면 확인 불가로 둔다',
    async (_label, decide) => {
      // Given
      const p = ports(decide, () => Promise.reject(problem(500)));

      // When
      const result = await runDecisionWithRefetch(p);

      // Then
      expect(result.kind).toBe('refetch-failed');
    },
  );

  it('재조회가 네트워크로 깨져도 확인 불가다 — 404 만 행 제거다', async () => {
    // Given
    const p = ports(
      () => Promise.resolve(undefined),
      () => Promise.reject(new TypeError('network')),
    );

    // When
    const result = await runDecisionWithRefetch(p);

    // Then
    expect(result.kind).toBe('refetch-failed');
  });

  it('판정 5xx 뒤 재조회가 성공하면 실패로 말하지 않는다', async () => {
    // Given: 실제로는 적용됐을 수 있다 — 두 축을 합치면 이 경우를 놓친다.
    const p = ports(
      () => Promise.reject(problem(503)),
      () => Promise.resolve(APPLICATION),
    );

    // When
    const result = await runDecisionWithRefetch(p);

    // Then
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
