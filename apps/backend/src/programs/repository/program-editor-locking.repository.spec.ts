import { MilestoneSubmissionType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProgramEditorRepository } from './program-editor.repository';

describe('ProgramEditorRepository locking', () => {
  it('discovers ownership then locks program, milestone, and documents before aggregate edit reads', async () => {
    const operations: string[] = [];
    const transaction = {
      $queryRaw: <T>(query: unknown): Promise<T> => {
        operations.push(sqlText(query));
        const rows =
          operations.length === 1
            ? [{ id: 'program-1' }]
            : operations.length === 2
              ? [{ id: 'milestone-1', programId: 'program-1' }]
              : [];
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
            startAt: new Date('2026-08-16T00:00:00.000Z'),
            dueAt: new Date('2026-08-20T00:00:00.000Z'),
            submissionType: MilestoneSubmissionType.FILE,
            instructions: null,
            updatedAt: new Date('2026-08-16T00:00:00.000Z'),
            program: {
              startAt: new Date('2026-08-15T00:00:00.000Z'),
              endAt: new Date('2026-08-31T00:00:00.000Z'),
            },
          }),
      },
      milestoneDocument: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const prisma = {
      $transaction: <T>(operation: (store: typeof transaction) => Promise<T>) =>
        operation(transaction),
    };
    const repository = new ProgramEditorRepository(
      prisma as unknown as PrismaService,
    );

    const result = await repository.withTransaction((store) =>
      store.lockMilestoneEdit('milestone-1'),
    );

    expect(result?.programId).toBe('program-1');
    expect(operations).toHaveLength(3);
    expect(operations[0]).toContain('FROM "Program"');
    expect(operations[0]).toContain('FOR UPDATE');
    expect(operations[1]).toContain('FROM "Milestone"');
    expect(operations[1]).toContain('FOR UPDATE');
    expect(operations[2]).toContain('FROM "MilestoneDocument"');
    expect(operations[2]).toContain('FOR UPDATE');
  });

  it('returns null when aggregate milestone ownership changes after the parent lock', async () => {
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
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ programId: 'program-1' })
          .mockResolvedValueOnce({ id: 'milestone-1', programId: 'program-2' }),
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
      store.lockMilestoneEdit('milestone-1'),
    );

    expect(result).toBeNull();
    expect(operations[0]).toContain('FROM "Program"');
    expect(operations[1]).toContain('FROM "Milestone"');
    expect(transaction.milestone.findUnique).toHaveBeenCalledTimes(2);
    expect(operations).toHaveLength(2);
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
            program: {
              repositoryProvisioningEnabled: false,
              _count: { milestones: 2 },
            },
          }),
      },
      // 서류 항목의 제출은 Milestone에서 한 단계 더 들어간 테이블이라 _count로 세지 못한다.
      milestoneDocumentSubmission: { count: jest.fn().mockResolvedValue(0) },
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
