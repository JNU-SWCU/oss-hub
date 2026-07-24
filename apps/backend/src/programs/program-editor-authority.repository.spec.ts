import { ProgramCategory, RoleRequestStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProgramEditorRepository } from './program-editor.repository';

describe('ProgramEditorRepository authority', () => {
  it('loads pending staff-role requests with editor authority', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      role: null,
      accountStatus: 'ACTIVE',
      roleRequests: [{ status: RoleRequestStatus.PENDING }],
    });
    const transaction = { user: { findUnique } };
    const prisma = {
      $transaction: <T>(operation: (store: typeof transaction) => Promise<T>) =>
        operation(transaction),
    };
    const repository = new ProgramEditorRepository(
      prisma as unknown as PrismaService,
    );

    const result = await repository.withTransaction((store) =>
      store.findUserAuthorityByGithubId(101n),
    );

    expect(result?.roleRequests).toEqual([
      { status: RoleRequestStatus.PENDING },
    ]);
    expect(findUnique).toHaveBeenCalledWith({
      where: { githubId: 101n },
      select: {
        role: true,
        accountStatus: true,
        roleRequests: {
          where: { status: RoleRequestStatus.PENDING },
          select: { status: true },
          take: 1,
        },
      },
    });
  });
});

describe('ProgramEditorRepository edit counts', () => {
  it('maps explicit application and team counts on editable program reads', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      id: 'program-1',
      name: 'OSS',
      organizer: 'Center',
      category: ProgramCategory.BASIC,
      applicationTemplateKey: 'basic',
      applicationTemplateVersion: 1,
      applicationStartAt: new Date('2026-08-01T00:00:00.000Z'),
      applicationEndAt: new Date('2026-08-15T00:00:00.000Z'),
      teamMinSize: null,
      teamMaxSize: null,
      repositoryProvisioningEnabled: false,
      description: 'overview',
      _count: { applications: 2, teams: 1 },
      milestones: [],
    });
    const transaction = { program: { findUnique } };
    const prisma = {
      $transaction: <T>(operation: (store: typeof transaction) => Promise<T>) =>
        operation(transaction),
    };
    const repository = new ProgramEditorRepository(
      prisma as unknown as PrismaService,
    );

    const result = await repository.withTransaction((store) =>
      store.findEditableProgramById('program-1'),
    );

    expect(result).toMatchObject({
      applicationCount: 2,
      teamCount: 1,
      categoryLocked: {
        locked: true,
        byApplications: true,
        byTeams: true,
        applicationCount: 2,
        teamCount: 1,
      },
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'program-1' },
      include: {
        _count: { select: { applications: true, teams: true } },
        milestones: { orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }] },
      },
    });
  });
});
