import { describe, expect, it } from 'vitest';
import { canonicalLocalReviewSessionBody } from './session-contract';

describe('canonicalLocalReviewSessionBody', () => {
  it.each([
    ['STUDENT', 'STUDENT', false, false],
    ['STAFF', 'STAFF', true, false],
    ['ADMIN', null, false, true],
    [null, null, false, false],
  ] as const)(
    '%s legacy fixture projection',
    (role, memberKind, hasStaffAccess, hasAdminAccess) => {
      expect(
        canonicalLocalReviewSessionBody('auth/session', {
          isAuthenticated: true,
          user: { nickname: 'synthetic', role },
        }),
      ).toMatchObject({
        user: { memberKind, hasStaffAccess, hasAdminAccess },
      });
    },
  );

  it('does not alter unrelated fixture responses', () => {
    const body = { role: 'STAFF' };
    expect(canonicalLocalReviewSessionBody('users/me/profile', body)).toBe(
      body,
    );
  });
});
