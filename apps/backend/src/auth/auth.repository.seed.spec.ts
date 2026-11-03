import {
  buildAuthConfig,
  buildProfile,
  buildRepository,
  buildRow,
  upsertUser,
} from './auth.repository.spec-support';

describe('OAuth never grants administrator or staff authority', () => {
  it.each(['ADMIN', 'STAFF', 'STUDENT'] as const)(
    'ignores legacy %s seed configuration for an existing account',
    async (seed) => {
      const config = buildAuthConfig({ AUTH_INITIAL_ROLES: '424242:' + seed });
      expect(config.resolveInitialRole(424242n)).not.toBeNull();
      const { repository, adminCreate } = buildRepository(buildRow());
      const result = await upsertUser(repository, buildProfile());
      expect(result.user).toMatchObject({
        memberKind: null,
        approvalStatus: 'NOT_REQUIRED',
        hasAdminAccess: false,
      });
      expect(adminCreate).not.toHaveBeenCalled();
    },
  );
  it('does not restore revoked staff approval or an absent administrator grant on login', async () => {
    const { repository, adminCreate } = buildRepository(
      buildRow({
        type: 'STAFF',
        approvalStatus: 'REVOKED',
        approvalRequestId: 'revoked-request',
        approvalRequestedAt: new Date('2026-01-01'),
      }),
    );
    const result = await upsertUser(repository, buildProfile());
    expect(result.user).toMatchObject({
      memberKind: 'STAFF',
      approvalStatus: 'REVOKED',
      hasAdminAccess: false,
    });
    expect(adminCreate).not.toHaveBeenCalled();
  });
  it('does not decide a pending request on login', async () => {
    const { repository } = buildRepository(
      buildRow({
        type: 'STAFF',
        approvalStatus: 'PENDING',
        approvalRequestId: 'pending-request',
        approvalRequestedAt: new Date('2026-01-01'),
      }),
    );
    expect(
      (await upsertUser(repository, buildProfile())).user.approvalStatus,
    ).toBe('PENDING');
  });
});
