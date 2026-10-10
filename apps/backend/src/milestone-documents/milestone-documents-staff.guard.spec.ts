import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { AccountStatus } from '@prisma/client';
import { MilestoneDocumentsErrorCode } from './domain/milestone-documents-error-code.enum';
import { MilestoneDocumentsStaffGuard } from './milestone-documents-staff.guard';
import type { MilestoneDocumentsStaffRequest } from './milestone-documents-staff.guard';

describe('MilestoneDocumentsStaffGuard', () => {
  const findUnique = jest.fn();
  const guard = new MilestoneDocumentsStaffGuard({ user: { findUnique } });

  beforeEach(() => findUnique.mockReset());

  it.each([
    ['staff', { hasStaffAccess: true, hasAdminAccess: false }],
    ['admin', { hasStaffAccess: false, hasAdminAccess: true }],
  ])(
    '%s 역할을 허용하고 request에 milestoneDocumentActorId를 붙인다',
    async (_label, access) => {
      findUnique.mockResolvedValue({
        id: 'staff-1',
        ...access,
        accountStatus: AccountStatus.ACTIVE,
      });
      const request: Partial<MilestoneDocumentsStaffRequest> = {
        sessionGithubId: 2001n,
      };
      const context = new ExecutionContextHost([request]);
      context.setType('http');

      const allowed = await guard.canActivate(context);

      expect(allowed).toBe(true);
      expect(request.milestoneDocumentActorId).toBe('staff-1');
    },
  );

  it.each([
    ['STUDENT', AccountStatus.ACTIVE],
    [null, AccountStatus.ACTIVE],
    ['STAFF', AccountStatus.DEACTIVATED],
    [undefined, AccountStatus.ACTIVE],
  ] as const)(
    '%s/%s 계정은 STAFF_ONLY(403)로 거부한다',
    async (role, accountStatus) => {
      findUnique.mockResolvedValue(
        role === undefined && accountStatus === AccountStatus.ACTIVE
          ? null
          : { id: 'user-1', role, accountStatus },
      );
      const context = new ExecutionContextHost([{ sessionGithubId: 2002n }]);
      context.setType('http');

      const decision = guard.canActivate(context);

      await expect(decision).rejects.toMatchObject({
        errorCode: {
          code: MilestoneDocumentsErrorCode.STAFF_ONLY,
          status: 403,
        },
      });
    },
  );
});
