import { USER_AUTHORITY_SELECT } from '../platform/user-profile-read.config';
import { ProgramCoverRepository } from './program-cover.repository';
import { ProgramAuthoringUploadTransactionRepository } from './program-authoring-upload-transaction.repository';
import { ProgramDeletionScopeRepository } from './programs.repository';
import { LockProgramTreeRepository } from '../platform/lock-program-tree.repository';
import { ProgramCategory, ProgramTrackType } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { ProgramEditorRepository } from './program-editor.repository';

describe('ProgramEditorRepository authority', () => {
  it('loads pending staff-role requests with editor authority', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      id: 'staff-101',
      accountStatus: 'ACTIVE',
      type: 'STAFF',
      approvalStatus: 'PENDING',
      name: 'Synthetic user',
      department: 'Synthetic department',
      profileCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
      profileUpdatedAt: null,
      departmentType: null,
      studentId: null,
      admin: null,
    });
    const transaction = { user: { findUnique } };
    const prisma = {
      $transaction: <T>(operation: (store: typeof transaction) => Promise<T>) =>
        operation(transaction),
    };
    const repository = new ProgramEditorRepository(
      prisma as unknown as PrismaService,
      new LockProgramTreeRepository(),
      new ProgramDeletionScopeRepository(),
      new ProgramAuthoringUploadTransactionRepository(),
      new ProgramCoverRepository(
        prisma as unknown as PrismaService,
        new ProgramAuthoringUploadTransactionRepository(),
      ),
    );

    const result = await repository.withTransaction((store) =>
      store.findUserAuthorityByGithubId(101n),
    );

    expect(result?.id).toBe('staff-101');
    expect(result?.approvalStatus).toBe('PENDING');
    expect(findUnique).toHaveBeenCalledWith({
      where: { githubId: 101n },
      select: {
        id: true,
        accountStatus: true,
        ...USER_AUTHORITY_SELECT,
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
      trackType: ProgramTrackType.EXTRACURRICULAR,
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
      _count: { teams: 2, boardPosts: 3 },
      milestones: [],
    });
    const queryRaw = jest.fn().mockResolvedValue([
      {
        applications: 2n,
        teams: 2n,
        boardPosts: 3n,
        submissions: 4n,
        submissionEvents: 5n,
      },
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
      new LockProgramTreeRepository(),
      new ProgramDeletionScopeRepository(),
      new ProgramAuthoringUploadTransactionRepository(),
      new ProgramCoverRepository(
        prisma as unknown as PrismaService,
        new ProgramAuthoringUploadTransactionRepository(),
      ),
    );

    const result = await repository.withTransaction((store) =>
      store.findEditableProgramById('program-1'),
    );

    expect(result).toMatchObject({
      applicationCount: 2,
      teamCount: 2,
      deletionScopeCounts: {
        applications: 2,
        teams: 2,
        boardPosts: 3,
        submissions: 4,
        submissionEvents: 5,
      },
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'program-1', lifecycle: { not: 'DELETED' } },
      include: {
        cover: { select: { id: true, imageUrl: true, sourceUrl: true } },
        _count: {
          select: { teams: true, boardPosts: true },
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
    expect(query.strings.join('')).toContain('SELECT count(*) FROM "Team"');
    expect(query.strings.join('')).toContain(
      'SELECT count(*) FROM "MilestoneDocumentSubmission"',
    );
    expect(query.values).toHaveLength(30);
    expect(query.values).toEqual(Array(30).fill('program-1'));
  });
});
