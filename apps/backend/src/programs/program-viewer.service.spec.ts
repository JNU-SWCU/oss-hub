import { AccountStatus, Role } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { ProgramViewerService } from './program-viewer.service';
import { ProgramsRepository } from './programs.repository';

const githubId = 424242n;

describe('ProgramViewerService', () => {
  it('비활성 교직원은 비공개 조회 권한을 얻지 못한다', async () => {
    // Given
    const findUnique = jest.fn().mockResolvedValue({
      id: 'staff-1',
      role: Role.STAFF,
      accountStatus: AccountStatus.DEACTIVATED,
      roleRequests: [],
    });
    const prisma = { user: { findUnique } } as unknown as PrismaService;
    const service = new ProgramViewerService(new ProgramsRepository(prisma));

    // When
    const viewer = await service.fromGithubId(githubId);

    // Then
    expect(viewer).toEqual({ githubId, userId: null, role: null });
    expect(findUnique).toHaveBeenCalledWith({
      where: { githubId },
      select: {
        id: true,
        accountStatus: true,
        role: true,
        roleRequests: {
          where: { status: 'PENDING' },
          select: { id: true },
          take: 1,
        },
      },
    });
  });
});
