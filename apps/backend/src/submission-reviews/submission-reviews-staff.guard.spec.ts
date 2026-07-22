import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { AccountStatus, Role } from '@prisma/client';
import { SubmissionReviewsErrorCode } from './submission-reviews-error-code.enum';
import { SubmissionReviewsStaffGuard } from './submission-reviews-staff.guard';

describe('SubmissionReviewsStaffGuard', () => {
  const findUnique = jest.fn();
  const guard = new SubmissionReviewsStaffGuard({
    user: { findUnique },
  });

  beforeEach(() => findUnique.mockReset());

  it.each([Role.STAFF, Role.ADMIN])(
    '%s 역할을 허용하고 reviewer id를 붙인다',
    async (role) => {
      // Given: 활성 승인 교직원 또는 관리자다.
      findUnique.mockResolvedValue({
        id: 'reviewer-1',
        role,
        accountStatus: AccountStatus.ACTIVE,
      });
      const request: {
        sessionGithubId: bigint;
        submissionReviewerId?: string;
      } = { sessionGithubId: 1001n };
      const context = new ExecutionContextHost([request]);
      context.setType('http');

      // When: 검토 API 접근을 확인한다.
      const allowed = await guard.canActivate(context);

      // Then: 접근을 허용하고 내부 reviewer id를 전달한다.
      expect(allowed).toBe(true);
      expect(request.submissionReviewerId).toBe('reviewer-1');
    },
  );

  it.each([
    [Role.STUDENT, AccountStatus.ACTIVE],
    [null, AccountStatus.ACTIVE],
    [Role.STAFF, AccountStatus.DEACTIVATED],
  ] as const)('%s/%s 계정은 403으로 거부한다', async (role, accountStatus) => {
    // Given: 승인되지 않았거나 비활성인 사용자다.
    findUnique.mockResolvedValue({ id: 'user-1', role, accountStatus });
    const context = new ExecutionContextHost([{ sessionGithubId: 1002n }]);
    context.setType('http');

    // When: 검토 API 접근을 시도한다.
    const decision = guard.canActivate(context);

    // Then: STAFF 승인 필요 오류를 반환한다.
    await expect(decision).rejects.toMatchObject({
      errorCode: {
        code: SubmissionReviewsErrorCode.STAFF_APPROVAL_REQUIRED,
        status: 403,
      },
    });
  });
});
