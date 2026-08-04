import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { AccountStatus, Role } from '@prisma/client';
import { MilestoneDocumentsErrorCode } from './milestone-documents-error-code.enum';
import { MilestoneDocumentsStaffGuard } from './milestone-documents-staff.guard';
import type { MilestoneDocumentsStaffRequest } from './milestone-documents-staff.guard';

describe('MilestoneDocumentsStaffGuard', () => {
  const findUnique = jest.fn();
  const guard = new MilestoneDocumentsStaffGuard({ user: { findUnique } });

  beforeEach(() => findUnique.mockReset());

  it.each([Role.STAFF, Role.ADMIN])(
    '%s 역할을 허용하고 request에 milestoneDocumentActorId를 붙인다',
    async (role) => {
      // Given: 활성 승인 교직원 또는 관리자다.
      findUnique.mockResolvedValue({
        id: 'staff-1',
        role,
        accountStatus: AccountStatus.ACTIVE,
      });
      const request: Partial<MilestoneDocumentsStaffRequest> = {
        sessionGithubId: 2001n,
      };
      const context = new ExecutionContextHost([request]);
      context.setType('http');

      // When: 서류 항목 CRUD/양식 업로드 endpoint 접근을 확인한다.
      const allowed = await guard.canActivate(context);

      // Then: 접근을 허용하고 내부 actor id를 전달한다.
      expect(allowed).toBe(true);
      expect(request.milestoneDocumentActorId).toBe('staff-1');
    },
  );

  it.each([
    [Role.STUDENT, AccountStatus.ACTIVE],
    [null, AccountStatus.ACTIVE],
    [Role.STAFF, AccountStatus.DEACTIVATED],
    [undefined, AccountStatus.ACTIVE],
  ] as const)(
    '%s/%s 계정은 STAFF_ONLY(403)로 거부한다',
    async (role, accountStatus) => {
      // Given: 학생이거나 비활성 계정이다.
      findUnique.mockResolvedValue(
        role === undefined && accountStatus === AccountStatus.ACTIVE
          ? null
          : { id: 'user-1', role, accountStatus },
      );
      const context = new ExecutionContextHost([{ sessionGithubId: 2002n }]);
      context.setType('http');

      // When: 교직원 전용 endpoint 접근을 시도한다.
      const decision = guard.canActivate(context);

      // Then: 교직원 전용 오류로 거부한다.
      await expect(decision).rejects.toMatchObject({
        errorCode: {
          code: MilestoneDocumentsErrorCode.STAFF_ONLY,
          status: 403,
        },
      });
    },
  );
});
