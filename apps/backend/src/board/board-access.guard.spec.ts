import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { AccountStatus, ApplicationStatus } from '@prisma/client';
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

  it.each([
    ['staff', { hasStaffAccess: true, hasAdminAccess: false }],
    ['admin', { hasStaffAccess: false, hasAdminAccess: true }],
  ])(
    '%s 역할은 참여 여부와 무관하게 허용하고 boardActorIsStaff=true를 붙인다',
    async (_label, access) => {
      // Given
      findUniqueUser.mockResolvedValue({
        id: 'synthetic-staff-user',
        ...access,
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

  it('APPROVED 신청 팀의 현재 팀원은 허용하고 boardActorIsStaff=false를 붙인다', async () => {
    // Given
    findUniqueUser.mockResolvedValue({
      id: 'synthetic-student-user',
      hasStaffAccess: false,
      hasAdminAccess: false,
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
        team: { members: { some: { userId: 'synthetic-student-user' } } },
      },
      select: { id: true },
    });
  });

  // 게시판 읽기 권한은 「지금 그 팀 사람인가」 하나로만 갈린다 — 최초 신청자 절이나 맨
  // leaderId 절이 남아 있으면 팀을 떠난 사람이 옛 프로그램 게시판을 계속 읽는다(#1269).
  it('참여 판정 조건에 최초 신청자·맨 leaderId 절을 남기지 않는다', async () => {
    // Given: 팀에서 빠진 사람 — DB는 멤버십 절로 걸러 아무 행도 주지 않는다.
    findUniqueUser.mockResolvedValue({
      id: 'synthetic-ex-member',
      hasStaffAccess: false,
      hasAdminAccess: false,
      accountStatus: AccountStatus.ACTIVE,
    });
    findFirstApplication.mockResolvedValue(null);
    const request = {
      sessionGithubId: syntheticGithubId,
      params: { programId: syntheticProgramId },
    };

    // When / Then: 옛 팀의 게시판은 더 이상 열리지 않는다.
    await expect(
      guard.canActivate(buildContext(request)),
    ).rejects.toMatchObject({
      errorCode: { code: BoardErrorCode.ACCESS_FORBIDDEN, status: 403 },
    });
    expect(request).not.toHaveProperty('boardActorId');

    const [{ where }] = findFirstApplication.mock.calls[0] as [
      { where: Record<string, unknown> },
    ];
    expect(Object.keys(where).sort()).toEqual(['programId', 'status', 'team']);
    expect(where).not.toHaveProperty('OR');
    expect(where).not.toHaveProperty('applicantId');
    expect(where.team).toEqual({
      members: { some: { userId: 'synthetic-ex-member' } },
    });
  });

  // 승인 전 신청은 게시판을 열지 않는다 — 팀원이어도 status 절이 함께 걸려야 한다.
  it('참여 판정은 APPROVED 상태 절을 팀 멤버십과 함께 건다', async () => {
    // Given
    findUniqueUser.mockResolvedValue({
      id: 'synthetic-pending-member',
      hasStaffAccess: false,
      hasAdminAccess: false,
      accountStatus: AccountStatus.ACTIVE,
    });
    findFirstApplication.mockResolvedValue(null);

    // When / Then
    await expect(
      guard.canActivate(
        buildContext({
          sessionGithubId: syntheticGithubId,
          params: { programId: syntheticProgramId },
        }),
      ),
    ).rejects.toMatchObject({
      errorCode: { code: BoardErrorCode.ACCESS_FORBIDDEN },
    });
    expect(findFirstApplication).toHaveBeenCalledWith({
      where: {
        programId: syntheticProgramId,
        status: ApplicationStatus.APPROVED,
        team: { members: { some: { userId: 'synthetic-pending-member' } } },
      },
      select: { id: true },
    });
  });

  it('참여자가 아닌 학생은 403으로 거부한다', async () => {
    // Given
    findUniqueUser.mockResolvedValue({
      id: 'synthetic-outsider-user',
      hasStaffAccess: false,
      hasAdminAccess: false,
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
      hasStaffAccess: true,
      hasAdminAccess: false,
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
