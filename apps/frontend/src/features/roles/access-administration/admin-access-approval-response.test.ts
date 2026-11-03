import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseAdminAccessMutationResponse } from './admin-access-api';
import { applyAdminAccessConflictProjection } from './admin-access-mutation-policy';
import { patchAdminAuthority } from './independent-authority-api';
import { adminDetail } from './admin-access-detail-test-fixture';

afterEach(() => vi.unstubAllGlobals());

describe('approval state in mutation responses', () => {
  it.each([
    { approvalStatus: 'NOT_REQUIRED', approvalRequestId: null },
    { approvalStatus: 'PENDING', approvalRequestId: 'pending-request' },
    { approvalStatus: 'APPROVED', approvalRequestId: 'approved-request' },
    { approvalStatus: 'REJECTED', approvalRequestId: 'rejected-request' },
    { approvalStatus: 'REVOKED', approvalRequestId: 'revoked-request' },
  ] as const)(
    'preserves the authoritative tuple $approvalStatus',
    (approval) => {
      const result = parseAdminAccessMutationResponse({
        id: 'target',
        role: 'STAFF',
        accountStatus: 'ACTIVE',
        pendingRequest: null,
        decidedRequest: null,
        ...approval,
      });

      const updated = applyAdminAccessConflictProjection(adminDetail(), result);

      expect(result).toMatchObject(approval);
      expect(updated).toMatchObject(approval);
    },
  );

  it.each([
    { approvalStatus: undefined, approvalRequestId: null },
    { approvalStatus: 'APPROVED', approvalRequestId: undefined },
    { approvalStatus: 'UNKNOWN', approvalRequestId: null },
  ])('rejects an incomplete success response %j', (approval) => {
    expect(() =>
      parseAdminAccessMutationResponse({
        id: 'target',
        role: 'STAFF',
        accountStatus: 'ACTIVE',
        pendingRequest: null,
        decidedRequest: null,
        ...approval,
      }),
    ).toThrow();
  });

  it('requires the same tuple on independent authority responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          id: 'target',
          role: 'ADMIN',
          memberKind: 'STAFF',
          hasStaffAccess: true,
          hasAdminAccess: true,
        }),
      ),
    );

    await expect(
      patchAdminAuthority('target', 'GRANT_ADMIN_ACCESS'),
    ).rejects.toThrow();
  });
});
