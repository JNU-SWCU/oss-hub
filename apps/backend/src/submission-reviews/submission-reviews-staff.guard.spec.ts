import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { AccountStatus } from '@prisma/client';
import { SubmissionReviewsErrorCode } from './submission-reviews-error-code.enum';
import { SubmissionReviewsStaffGuard } from './submission-reviews-staff.guard';

describe('SubmissionReviewsStaffGuard', () => {
  const findUnique = jest.fn();
  const guard = new SubmissionReviewsStaffGuard({
    user: { findUnique },
  });

  beforeEach(() => findUnique.mockReset());

  it.each([
    ['staff', { hasStaffAccess: true, hasAdminAccess: false }],
    ['admin', { hasStaffAccess: false, hasAdminAccess: true }],
  ])('%s 역할을 허용하고 reviewer id를 붙인다', async (_label, access) => {
    findUnique.mockResolvedValue({
      id: 'reviewer-1',
      ...access,
      accountStatus: AccountStatus.ACTIVE,
    });
    const request: {
      sessionGithubId: bigint;
      submissionReviewerId?: string;
    } = { sessionGithubId: 1001n };
    const context = new ExecutionContextHost([request]);
    context.setType('http');

    const allowed = await guard.canActivate(context);

    expect(allowed).toBe(true);
    expect(request.submissionReviewerId).toBe('reviewer-1');
  });

  it.each([
    ['STUDENT', AccountStatus.ACTIVE],
    [null, AccountStatus.ACTIVE],
    ['STAFF', AccountStatus.DEACTIVATED],
  ] as const)('%s/%s 계정은 403으로 거부한다', async (role, accountStatus) => {
    findUnique.mockResolvedValue({ id: 'user-1', role, accountStatus });
    const context = new ExecutionContextHost([{ sessionGithubId: 1002n }]);
    context.setType('http');

    const decision = guard.canActivate(context);

    await expect(decision).rejects.toMatchObject({
      errorCode: {
        code: SubmissionReviewsErrorCode.STAFF_APPROVAL_REQUIRED,
        status: 403,
      },
    });
  });
});
