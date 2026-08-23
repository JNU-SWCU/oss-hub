import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { AccountStatus } from '@prisma/client';
import { TeamsErrorCode } from './teams-error-code.enum';
import { ProgramTeamsStaffGuard } from './program-teams-staff.guard';

describe('ProgramTeamsStaffGuard', () => {
  const findUnique = jest.fn();
  const prisma = { user: { findUnique } };
  const guard = new ProgramTeamsStaffGuard(prisma);

  beforeEach(() => findUnique.mockReset());

  it.each([
    ['staff', { hasStaffAccess: true, hasAdminAccess: false }],
    ['admin', { hasStaffAccess: false, hasAdminAccess: true }],
  ])(
    'ACTIVE %s 역할을 허용하고 actor id 를 요청에 붙인다',
    async (_label, access) => {
      // Given
      findUnique.mockResolvedValue({
        id: 'synthetic-staff',
        ...access,
        accountStatus: AccountStatus.ACTIVE,
      });
      const request: {
        sessionGithubId: bigint;
        programTeamsActorId?: string;
      } = { sessionGithubId: 3001n };
      const context = new ExecutionContextHost([request]);
      context.setType('http');

      // When
      const allowed = await guard.canActivate(context);

      // Then
      expect(allowed).toBe(true);
      expect(request.programTeamsActorId).toBe('synthetic-staff');
    },
  );

  it('두 접근권이 모두 없으면 거부한다', async () => {
    // Given
    findUnique.mockResolvedValue({
      id: 'synthetic-actor',
      hasStaffAccess: false,
      hasAdminAccess: false,
      accountStatus: AccountStatus.ACTIVE,
    });
    const context = new ExecutionContextHost([{ sessionGithubId: 3002n }]);
    context.setType('http');

    // When · Then
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      errorCode: { code: TeamsErrorCode.STAFF_ONLY, status: 403 },
    });
  });

  it('비활성(DEACTIVATED) STAFF 계정은 TEAM_003 403 으로 거부한다', async () => {
    // Given
    findUnique.mockResolvedValue({
      id: 'synthetic-staff',
      hasStaffAccess: true,
      hasAdminAccess: false,
      accountStatus: AccountStatus.DEACTIVATED,
    });
    const context = new ExecutionContextHost([{ sessionGithubId: 3003n }]);
    context.setType('http');

    // When · Then
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      errorCode: { code: TeamsErrorCode.STAFF_ONLY, status: 403 },
    });
  });

  it('세션 githubId 에 해당하는 사용자가 없으면 TEAM_003 403 으로 거부한다', async () => {
    // Given
    findUnique.mockResolvedValue(null);
    const context = new ExecutionContextHost([{ sessionGithubId: 3004n }]);
    context.setType('http');

    // When · Then
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      errorCode: { code: TeamsErrorCode.STAFF_ONLY, status: 403 },
    });
  });
});
