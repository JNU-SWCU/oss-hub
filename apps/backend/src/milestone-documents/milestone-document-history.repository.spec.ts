import {
  MilestoneDocumentSubmissionHistoryEvent,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  InvalidMilestoneDocumentHistoryCursorError,
  MilestoneDocumentsRepository,
} from './milestone-documents.repository';

const submissionRecord = (revision = 2, historyCount = revision) => ({
  id: 'submission-1',
  revision,
  _count: { histories: historyCount },
});

describe('MilestoneDocumentsRepository history page', () => {
  it('reads at most limit+1 rows, returns chronological items, and exposes a cursor', async () => {
    const findUnique = jest.fn().mockResolvedValue(submissionRecord(3, 2));
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
    expect(page?.isComplete).toBe(false);
  });

  it('uses the supplied cursor without returning it again', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const repository = new MilestoneDocumentsRepository({
      milestoneDocumentSubmission: {
        findUnique: jest.fn().mockResolvedValue(submissionRecord()),
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
        findUnique: jest.fn().mockResolvedValue(submissionRecord()),
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

  it('동률 이관 사건도 결정적 순서로 cursor 경계를 잇는다', async () => {
    const tied = new Date('2026-09-03T00:00:00.000Z');
    const older = new Date('2026-09-02T00:00:00.000Z');
    const row = (
      id: string,
      event: MilestoneDocumentSubmissionHistoryEvent,
      createdAt: Date,
    ) => ({
      id,
      event,
      revision: 1,
      comment: null,
      content: Prisma.JsonNull,
      createdAt,
      actor: { nickname: 'synthetic-user' },
      files: [],
    });
    const submission = row(
      'history-submission',
      MilestoneDocumentSubmissionHistoryEvent.RESUBMITTED,
      tied,
    );
    const decision = row(
      'history-decision',
      MilestoneDocumentSubmissionHistoryEvent.APPROVED,
      tied,
    );
    const olderSubmission = row(
      'history-older',
      MilestoneDocumentSubmissionHistoryEvent.SUBMITTED,
      older,
    );
    const findMany = jest
      .fn()
      .mockResolvedValueOnce([decision, submission, olderSubmission])
      .mockResolvedValueOnce([olderSubmission]);
    const repository = new MilestoneDocumentsRepository({
      milestoneDocumentSubmission: {
        findUnique: jest.fn().mockResolvedValue(submissionRecord()),
      },
      milestoneDocumentSubmissionHistory: {
        findFirst: jest.fn().mockResolvedValue({ id: 'history-submission' }),
        findMany,
      },
    } as unknown as PrismaService);

    const firstPage = await repository.findSubmissionHistoryPage(
      'document-1',
      'application-1',
      null,
      2,
    );
    const secondPage = await repository.findSubmissionHistoryPage(
      'document-1',
      'application-1',
      firstPage?.nextCursor ?? null,
      2,
    );

    expect(firstPage?.items.map((item) => item.id)).toEqual([
      'history-submission',
      'history-decision',
    ]);
    expect(firstPage?.nextCursor).toBe('history-submission');
    expect(findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        cursor: { id: 'history-submission' },
        skip: 1,
      }),
    );
    expect(secondPage?.items.map((item) => item.id)).toEqual(['history-older']);
    expect(secondPage?.nextCursor).toBeNull();
  });
});
