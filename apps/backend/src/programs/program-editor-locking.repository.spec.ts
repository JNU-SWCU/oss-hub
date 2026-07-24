import { MilestoneSubmissionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProgramEditorRepository } from './program-editor.repository';

describe('ProgramEditorRepository locking', () => {
  it('discovers ownership then locks program before milestone update reads', async () => {
    const operations: string[] = [];
    const transaction = {
      $queryRaw: <T>(query: unknown): Promise<T> => {
        operations.push(sqlText(query));
        const rows =
          operations.length === 1
            ? [{ id: 'program-1' }]
            : [{ id: 'milestone-1', programId: 'program-1' }];
        return Promise.resolve(rows as T);
      },
      milestone: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ programId: 'program-1' })
          .mockResolvedValueOnce({
            id: 'milestone-1',
            programId: 'program-1',
            name: 'Final',
            dueAt: new Date('2026-08-20T00:00:00.000Z'),
            submissionType: MilestoneSubmissionType.FILE,
            instructions: null,
            program: {
              applicationEndAt: new Date('2026-08-15T00:00:00.000Z'),
            },
          }),
      },
    };
    const prisma = {
      $transaction: <T>(operation: (store: typeof transaction) => Promise<T>) =>
        operation(transaction),
    };
    const repository = new ProgramEditorRepository(
      prisma as unknown as PrismaService,
    );

    const result = await repository.withTransaction((store) =>
      store.findMilestoneForUpdate('milestone-1'),
    );

    expect(result?.programId).toBe('program-1');
    expect(operations).toHaveLength(2);
    expect(operations[0]).toContain('FROM "Program"');
    expect(operations[0]).toContain('FOR UPDATE');
    expect(operations[1]).toContain('FROM "Milestone"');
    expect(operations[1]).toContain('FOR UPDATE');
    expect(transaction.milestone.findUnique).toHaveBeenNthCalledWith(1, {
      where: { id: 'milestone-1' },
      select: { programId: true },
    });
    expect(transaction.milestone.findUnique).toHaveBeenNthCalledWith(2, {
      where: { id: 'milestone-1' },
      include: { program: { select: { applicationEndAt: true } } },
    });
  });

  it('returns null when milestone ownership changes after the parent lock', async () => {
    const operations: string[] = [];
    const transaction = {
      $queryRaw: <T>(query: unknown): Promise<T> => {
        operations.push(sqlText(query));
        const rows =
          operations.length === 1
            ? [{ id: 'program-1' }]
            : [{ id: 'milestone-1', programId: 'program-2' }];
        return Promise.resolve(rows as T);
      },
      milestone: {
        findUnique: jest.fn().mockResolvedValue({ programId: 'program-1' }),
      },
    };
    const prisma = {
      $transaction: <T>(operation: (store: typeof transaction) => Promise<T>) =>
        operation(transaction),
    };
    const repository = new ProgramEditorRepository(
      prisma as unknown as PrismaService,
    );

    const result = await repository.withTransaction((store) =>
      store.findMilestoneForUpdate('milestone-1'),
    );

    expect(result).toBeNull();
    expect(operations[0]).toContain('FROM "Program"');
    expect(operations[1]).toContain('FROM "Milestone"');
    expect(transaction.milestone.findUnique).toHaveBeenCalledTimes(1);
  });

  it('uses the same parent-first lock order for milestone delete reads', async () => {
    const operations: string[] = [];
    const transaction = {
      $queryRaw: <T>(query: unknown): Promise<T> => {
        operations.push(sqlText(query));
        const rows =
          operations.length === 1
            ? [{ id: 'program-1' }]
            : [{ id: 'milestone-1', programId: 'program-1' }];
        return Promise.resolve(rows as T);
      },
      milestone: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ programId: 'program-1' })
          .mockResolvedValueOnce({
            id: 'milestone-1',
            programId: 'program-1',
            _count: { submissions: 0 },
            program: {
              repositoryProvisioningEnabled: false,
              _count: { milestones: 2 },
            },
          }),
      },
    };
    const prisma = {
      $transaction: <T>(operation: (store: typeof transaction) => Promise<T>) =>
        operation(transaction),
    };
    const repository = new ProgramEditorRepository(
      prisma as unknown as PrismaService,
    );

    const result = await repository.withTransaction((store) =>
      store.findMilestoneForDelete('milestone-1'),
    );

    expect(result?.programId).toBe('program-1');
    expect(operations[0]).toContain('FROM "Program"');
    expect(operations[1]).toContain('FROM "Milestone"');
  });
});

function sqlText(value: unknown): string {
  if (typeof value === 'object' && value !== null) {
    const strings: unknown = Reflect.get(value, 'strings');
    if (Array.isArray(strings)) return strings.join('');
  }
  return String(value);
}
