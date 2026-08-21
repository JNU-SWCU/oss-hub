import { expect } from 'vitest';
import type { LocalReviewFixtureId } from '../fixture-contract';
import { resolveLocalReviewResponse } from '../fixture-response';

export function call(
  fixture: LocalReviewFixtureId,
  method: string,
  path: string,
  search = '',
) {
  return resolveLocalReviewResponse({
    fixture,
    method,
    path,
    searchParams: new URLSearchParams(search),
  });
}

export function callWithBody(
  fixture: LocalReviewFixtureId,
  method: string,
  path: string,
  body: unknown,
) {
  return resolveLocalReviewResponse({
    fixture,
    method,
    path,
    searchParams: new URLSearchParams(),
    body,
  });
}

export function jsonBody(
  plan: ReturnType<typeof resolveLocalReviewResponse>,
  status = 200,
): unknown {
  if (plan.kind !== 'json') throw new Error('expected a json fixture plan');
  expect(plan.status).toBe(status);
  return plan.body;
}

export const CONSENT_POLICY_VERSION = '2026-08-11';

export const AUTHENTICATED_FIXTURES = [
  'student',
  'staff',
  'admin',
  'settings',
  'wrong-role',
  'unassigned',
] as const satisfies readonly LocalReviewFixtureId[];
