import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { AccountStatus, ApplicationStatus, Role } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { BoardAccessGuard } from './board-access.guard';
import { BoardErrorCode } from './board-error-code.enum';

// 합성 데이터만 사용한다 (docs/rules/security.md)
const syntheticProgramId = 'cuid-synthetic-program';
const syntheticGithubId = 5001n;

function buildContext(request: Record<string, unknown>) {
  const context = new ExecutionContextHost([request]);
  context.setType('http');
  return context;
}

describe('BoardAccessGuard', () => {
  const findUniqueUser = jest.fn();
  const findFirstApplication = jest.fn();
  const prisma = {
    user: { findUnique: findUniqueUser },
    application: { findFirst: findFirstApplication },
  } as unknown as PrismaService;
  const guard = new BoardAccessGuard(prisma);

  beforeEach(() => {
    findUniqueUser.mockReset();
    findFirstApplication.mockReset();
  });

  it.each([Role.STAFF, Role.ADMIN])(
    '%s 역할은 참여 여부와 무관하게 허용하고 boardActorIsStaff=true를 붙인다',
    async (role) => {
      // Given
      findUniqueUser.mockResolvedValue({
        id: 'synthetic-staff-user',
        role,
        accountStatus: AccountStatus.ACTIVE,
      });
      const request = {
        sessionGithubId: syntheticGithubId,
        params: { programId: syntheticProgramId },
      };

      // When
      const allowed = await guard.canActivate(buildContext(request));

      // Then
      expect(allowed).toBe(true);
      expect(request).toMatchObject({
        boardActorId: 'synthetic-staff-user',
        boardActorIsStaff: true,
      });
      expect(findFirstApplication).not.toHaveBeenCalled();
    },
  );

  it('APPROVED 신청을 가진 학생은 허용하고 boardActorIsStaff=false를 붙인다', async () => {
    // Given
    findUniqueUser.mockResolvedValue({
      id: 'synthetic-student-user',
      role: Role.STUDENT,
      accountStatus: AccountStatus.ACTIVE,
    });
    findFirstApplication.mockResolvedValue({
      id: 'cuid-synthetic-application',
    });
    const request = {
      sessionGithubId: syntheticGithubId,
      params: { programId: syntheticProgramId },
    };

    // When
    const allowed = await guard.canActivate(buildContext(request));

    // Then
    expect(allowed).toBe(true);
    expect(request).toMatchObject({
      boardActorId: 'synthetic-student-user',
      boardActorIsStaff: false,
    });
    expect(findFirstApplication).toHaveBeenCalledWith({
      where: {
        programId: syntheticProgramId,
        status: ApplicationStatus.APPROVED,
        OR: [
          { applicantId: 'synthetic-student-user' },
          { team: { leaderId: 'synthetic-student-user' } },
          {
            team: {
              members: { some: { userId: 'synthetic-student-user' } },
            },
          },
        ],
      },
      select: { id: true },
    });
  });

  it('참여자가 아닌 학생은 403으로 거부한다', async () => {
    // Given
    findUniqueUser.mockResolvedValue({
      id: 'synthetic-outsider-user',
      role: Role.STUDENT,
      accountStatus: AccountStatus.ACTIVE,
    });
    findFirstApplication.mockResolvedValue(null);
    const request = {
      sessionGithubId: syntheticGithubId,
      params: { programId: syntheticProgramId },
    };

    // When / Then
    await expect(
      guard.canActivate(buildContext(request)),
    ).rejects.toMatchObject({
      errorCode: { code: BoardErrorCode.ACCESS_FORBIDDEN, status: 403 },
    });
  });

  it('세션은 유효해도 User 행이 없으면 403으로 거부한다', async () => {
    // Given
    findUniqueUser.mockResolvedValue(null);
    const request = {
      sessionGithubId: syntheticGithubId,
      params: { programId: syntheticProgramId },
    };

    // When / Then
    await expect(
      guard.canActivate(buildContext(request)),
    ).rejects.toMatchObject({
      errorCode: { code: BoardErrorCode.ACCESS_FORBIDDEN },
    });
    expect(findFirstApplication).not.toHaveBeenCalled();
  });

  it('비활성 계정은 STAFF 역할이어도 403으로 거부한다', async () => {
    // Given
    findUniqueUser.mockResolvedValue({
      id: 'synthetic-deactivated-staff',
      role: Role.STAFF,
      accountStatus: AccountStatus.DEACTIVATED,
    });
    const request = {
      sessionGithubId: syntheticGithubId,
      params: { programId: syntheticProgramId },
    };

    // When / Then
    await expect(
      guard.canActivate(buildContext(request)),
    ).rejects.toMatchObject({
      errorCode: { code: BoardErrorCode.ACCESS_FORBIDDEN },
    });
  });
});
