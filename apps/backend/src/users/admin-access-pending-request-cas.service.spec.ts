import { AccountStatus } from '@prisma/client';
import { RolesErrorCode } from './roles-error-code.error';
import { AdminAccessService } from './admin-access.service';
import {
  ADMIN_GITHUB_ID,
  InMemoryAdminAccessRepository,
  PENDING_REQUEST,
  accessUser,
  auditLogHarness,
} from './admin-access.service.spec-support';
import { ADMIN_ACCESS_REQUEST_DECISIONS } from './admin-access-query.config';
import { AuditLogMetadataService } from '../platform/audit-log-metadata.service';
import { AdminAccessMutationService } from './admin-access-mutation.service';

describe('AdminAccessService pending request CAS', () => {
  it('returns the re-read projection when the pending-request CAS loses', async () => {
    const repository = new InMemoryAdminAccessRepository();
    repository.requestCasSucceeds = false;
    repository.target = accessUser({
      role: null,
      pendingRequest: PENDING_REQUEST,
    });
    repository.authoritativeTarget = accessUser({ role: null });
    const audit = auditLogHarness();
    const service = new AdminAccessService(
      repository,
      audit.service,
      new AdminAccessMutationService(new AuditLogMetadataService()),
    );

    await expect(
      service.patchAccess(ADMIN_GITHUB_ID, 'target', {
        expectedRole: null,
        desiredRole: 'STAFF',
        expectedAccountStatus: AccountStatus.ACTIVE,
        desiredAccountStatus: AccountStatus.ACTIVE,
        expectedPendingRequest: {
          id: PENDING_REQUEST.id,
          status: PENDING_REQUEST.status,
        },
        requestDecision: {
          decision: ADMIN_ACCESS_REQUEST_DECISIONS.APPROVE,
        },
      }),
    ).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.ACCESS_STATE_MISMATCH, status: 409 },
      extensions: {
        currentAccess: {
          id: 'target',
          role: null,
          accountStatus: AccountStatus.ACTIVE,
          pendingRequest: null,
        },
      },
    });
    expect(audit.record).not.toHaveBeenCalled();
  });
});
