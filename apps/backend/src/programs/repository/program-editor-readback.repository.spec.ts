import { MilestoneSubmissionType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProgramEditorRepository } from './program-editor.repository';

const milestone = {
  id: 'm',
  programId: 'p',
  name: 'Final',
  startAt: null,
  dueAt: new Date('2026-08-20T00:00:00Z'),
  submissionType: MilestoneSubmissionType.FILE,
  instructions: null,
  updatedAt: new Date('2026-08-16T00:00:00Z'),
  program: { startAt: null, endAt: new Date('2026-08-31T00:00:00Z') },
};

describe('milestone edit transaction readback', () => {
  it('keeps projections and document ordering while removing only repeated locks', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'm', programId: 'p' }]),
      milestone: { findUnique: jest.fn().mockResolvedValue(milestone) },
      milestoneDocument: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'a',
            name: 'Second',
            required: false,
            sortOrder: 2,
            updatedAt: milestone.updatedAt,
            templateFile: null,
          },
          {
            id: 'b',
            name: 'First',
            required: true,
            sortOrder: 1,
            updatedAt: milestone.updatedAt,
            templateFile: {
              storageKey: 'synthetic',
              originalFileName: 'template.pdf',
            },
          },
        ]),
      },
    };
    const repository = new ProgramEditorRepository({
      $transaction: async (
        operation: (client: typeof tx) => Promise<unknown>,
      ) => operation(tx),
    } as unknown as PrismaService);
    await repository.withTransaction(async (store) => {
      const before = await store.lockMilestoneEdit('m');
      const after = await store.readMilestoneEdit('m');
      expect(after).toEqual(before);
      expect(after?.view.documents.map((document) => document.id)).toEqual([
        'b',
        'a',
      ]);
      expect(
        after?.fingerprintDocuments.map((document) => document.id),
      ).toEqual(['a', 'b']);
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
    expect(tx.milestone.findUnique.mock.calls.slice(0, 2)).toEqual(
      tx.milestone.findUnique.mock.calls.slice(2),
    );
    expect(tx.milestoneDocument.findMany.mock.calls[0]).toEqual(
      tx.milestoneDocument.findMany.mock.calls[1],
    );
  });

  it.each(['ownership', 'read', 'mismatch'])(
    'preserves the %s null exit without SQL locks',
    async (missing) => {
      const tx = {
        $queryRaw: jest.fn(),
        milestone: {
          findUnique: jest
            .fn()
            .mockResolvedValueOnce(
              missing === 'ownership' ? null : { programId: 'p' },
            )
            .mockResolvedValueOnce(
              missing === 'read' ? null : { ...milestone, programId: 'other' },
            ),
        },
        milestoneDocument: { findMany: jest.fn() },
      };
      const repository = new ProgramEditorRepository({
        $transaction: async (
          operation: (client: typeof tx) => Promise<unknown>,
        ) => operation(tx),
      } as unknown as PrismaService);
      await expect(
        repository.withTransaction((store) => store.readMilestoneEdit('m')),
      ).resolves.toBeNull();
      expect(tx.$queryRaw).not.toHaveBeenCalled();
      expect(tx.milestoneDocument.findMany).not.toHaveBeenCalled();
    },
  );
});
