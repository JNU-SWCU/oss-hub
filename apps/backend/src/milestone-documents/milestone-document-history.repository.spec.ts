import {
  MilestoneDocumentSubmissionHistoryEvent,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  InvalidMilestoneDocumentHistoryCursorError,
  MilestoneDocumentsRepository,
} from './milestone-documents.repository';

describe('MilestoneDocumentsRepository history page', () => {
  it('reads at most limit+1 rows, returns chronological items, and exposes a cursor', async () => {
    const findUnique = jest.fn().mockResolvedValue({ id: 'submission-1' });
    const newest = new Date('2026-09-03T00:00:00.000Z');
    const middle = new Date('2026-09-02T00:00:00.000Z');
    const oldest = new Date('2026-09-01T00:00:00.000Z');
    const row = (id: string, createdAt: Date) => ({
      id,
      event: MilestoneDocumentSubmissionHistoryEvent.RESUBMITTED,
      revision: Number(id.at(-1)),
      comment: null,
      content: Prisma.JsonNull,
      createdAt,
      actor: { nickname: 'synthetic-student' },
      files: [],
    });
    const findMany = jest
      .fn()
      .mockResolvedValue([
        row('history-3', newest),
        row('history-2', middle),
        row('history-1', oldest),
      ]);
    const repository = new MilestoneDocumentsRepository({
      milestoneDocumentSubmission: { findUnique },
      milestoneDocumentSubmissionHistory: {
        findFirst: jest.fn().mockResolvedValue({ id: 'history-2' }),
        findMany,
      },
    } as unknown as PrismaService);

    const page = await repository.findSubmissionHistoryPage(
      'document-1',
      'application-1',
      null,
      2,
    );

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 3,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
    expect(page?.items.map((item) => item.id)).toEqual([
      'history-2',
      'history-3',
    ]);
    expect(page?.nextCursor).toBe('history-2');
  });

  it('uses the supplied cursor without returning it again', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const repository = new MilestoneDocumentsRepository({
      milestoneDocumentSubmission: {
        findUnique: jest.fn().mockResolvedValue({ id: 'submission-1' }),
      },
      milestoneDocumentSubmissionHistory: {
        findFirst: jest.fn().mockResolvedValue({ id: 'history-2' }),
        findMany,
      },
    } as unknown as PrismaService);

    await repository.findSubmissionHistoryPage(
      'document-1',
      'application-1',
      'history-2',
      20,
    );

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { id: 'history-2' }, skip: 1 }),
    );
  });

  it('rejects a cursor that does not belong to the requested submission', async () => {
    const findMany = jest.fn();
    const repository = new MilestoneDocumentsRepository({
      milestoneDocumentSubmission: {
        findUnique: jest.fn().mockResolvedValue({ id: 'submission-1' }),
      },
      milestoneDocumentSubmissionHistory: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany,
      },
    } as unknown as PrismaService);

    await expect(
      repository.findSubmissionHistoryPage(
        'document-1',
        'application-1',
        'history-from-another-submission',
        20,
      ),
    ).rejects.toBeInstanceOf(InvalidMilestoneDocumentHistoryCursorError);
    expect(findMany).not.toHaveBeenCalled();
  });
});
