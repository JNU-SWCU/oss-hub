import { ProgramCategory, StaffAccessRequestStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProgramEditorRepository } from './program-editor.repository';

describe('ProgramEditorRepository authority', () => {
  it('loads pending staff-role requests with editor authority', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      role: null,
      accountStatus: 'ACTIVE',
      staffAccessRequests: [{ status: StaffAccessRequestStatus.PENDING }],
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

    expect(result?.staffAccessRequests).toEqual([
      { status: StaffAccessRequestStatus.PENDING },
    ]);
    expect(findUnique).toHaveBeenCalledWith({
      where: { githubId: 101n },
      select: {
        role: true,
        accountStatus: true,
        staffAccessRequests: {
          where: { status: StaffAccessRequestStatus.PENDING },
          select: { status: true },
          take: 1,
        },
      },
    });
  });
});

describe('ProgramEditorRepository edit counts', () => {
  it('maps all deletion counts from one snapshot query on editable program reads', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      id: 'program-1',
      name: 'OSS',
      organizer: 'Center',
      category: ProgramCategory.BASIC,
      applicationTemplateKey: 'basic',
      applicationTemplateVersion: 1,
      applicationStartAt: new Date('2026-08-01T00:00:00.000Z'),
      applicationEndAt: new Date('2026-08-15T00:00:00.000Z'),
      startAt: new Date('2026-08-16T00:00:00.000Z'),
      endAt: new Date('2026-08-31T00:00:00.000Z'),
      teamMinSize: 1,
      teamMaxSize: 1,
      repositoryProvisioningEnabled: false,
      description: 'overview',
      _count: { applications: 2, teams: 1, boardPosts: 3 },
      milestones: [],
    });
    const queryRaw = jest
      .fn()
      .mockResolvedValue([
        { applications: 2n, teams: 1n, boardPosts: 3n, submissions: 4n },
      ]);
    const transaction = {
      program: { findUnique },
      $queryRaw: queryRaw,
    };
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
      deletionScopeCounts: {
        applications: 2,
        teams: 1,
        boardPosts: 3,
        submissions: 4,
      },
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
        _count: {
          select: { applications: true, teams: true, boardPosts: true },
        },
        milestones: { orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }] },
      },
    });
    expect(queryRaw).toHaveBeenCalledTimes(1);
    const calls = queryRaw.mock.calls as unknown as readonly (readonly [
      unknown,
    ])[];
    const [scopeQuery] = calls[0] ?? [];
    const query = scopeQuery as {
      readonly strings: readonly string[];
      readonly values: readonly string[];
    };
    expect(query.strings.join('')).toContain(
      'SELECT count(*) FROM "Application"',
    );
    expect(query.strings.join('')).toContain(
      'SELECT count(*) FROM "Submission"',
    );
    expect(query.values).toEqual([
      'program-1',
      'program-1',
      'program-1',
      'program-1',
    ]);
  });
});
