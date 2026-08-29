import { PrismaService } from '../../prisma/prisma.service';
import { ProgramEditorRepository } from './program-editor.repository';

describe('ProgramEditorRepository milestone create', () => {
  it('creates one required default submission item with an edit-created milestone', async () => {
    const milestone = {
      id: 'milestone-1',
      programId: 'program-1',
      name: '결과 제출',
      startAt: new Date('2026-08-20T00:00:00.000Z'),
      dueAt: new Date('2026-08-25T00:00:00.000Z'),
      submissionType: null,
      instructions: null,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    };
    const create = jest.fn().mockResolvedValue(milestone);
    const transaction = { milestone: { create } };
    const prisma = {
      $transaction: <T>(operation: (store: typeof transaction) => Promise<T>) =>
        operation(transaction),
    };
    const repository = new ProgramEditorRepository(
      prisma as unknown as PrismaService,
    );

    await repository.withTransaction((store) =>
      store.createMilestone({
        programId: 'program-1',
        name: '결과 제출',
        startAt: milestone.startAt,
        dueAt: milestone.dueAt,
        submissionType: null,
        instructions: null,
      }),
    );

    expect(create).toHaveBeenCalledWith({
      data: {
        programId: 'program-1',
        name: '결과 제출',
        startAt: milestone.startAt,
        dueAt: milestone.dueAt,
        submissionType: null,
        instructions: null,
        documents: {
          create: {
            name: '제출 항목 1',
            required: true,
            sortOrder: 1,
          },
        },
      },
    });
  });
});
