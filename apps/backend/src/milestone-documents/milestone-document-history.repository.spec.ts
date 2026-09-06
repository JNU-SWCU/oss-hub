import {
  MilestoneDocumentSubmissionHistoryEvent,
  Prisma,
  SubmissionFileLifecycle,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  InvalidMilestoneDocumentHistoryCursorError,
  MilestoneDocumentsRepository,
} from './milestone-documents.repository';

function firstCallArgument<T>(mock: jest.Mock): T {
  const calls = mock.mock.calls as readonly (readonly unknown[])[];
  return calls[0]?.[0] as T;
}

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

  it('첨부의 id·보관 상태·만료 시각을 함께 읽어 살아 있는 파일만 내려받을 수 있게 한다', async () => {
    const now = new Date('2026-09-20T00:00:00.000Z');
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'history-1',
        event: MilestoneDocumentSubmissionHistoryEvent.SUBMITTED,
        revision: 1,
        comment: null,
        content: Prisma.JsonNull,
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        actor: { nickname: 'synthetic-student' },
        files: [
          {
            id: 'file-1',
            originalFileName: '1차_계획서.pdf',
            lifecycle: SubmissionFileLifecycle.ATTACHED,
            expiresAt: new Date('2027-09-01T00:00:00.000Z'),
          },
        ],
      },
    ]);
    const repository = new MilestoneDocumentsRepository({
      milestoneDocumentSubmission: {
        findUnique: jest.fn().mockResolvedValue(submissionRecord(1, 1)),
      },
      milestoneDocumentSubmissionHistory: {
        findFirst: jest.fn(),
        findMany,
      },
    } as unknown as PrismaService);

    const page = await repository.findSubmissionHistoryPage(
      'document-1',
      'application-1',
      null,
      20,
      now,
    );

    const call = firstCallArgument<{
      select: { files: { select: Record<string, unknown> } };
    }>(findMany);
    expect(call.select.files.select).toEqual({
      id: true,
      originalFileName: true,
      lifecycle: true,
      expiresAt: true,
    });
    expect(page?.items[0]).toEqual(
      expect.objectContaining({
        fileName: '1차_계획서.pdf',
        downloadableFileId: 'file-1',
      }),
    );
  });

  it('보관 기한이 지난 첨부는 이름만 남기고 내려받을 id를 주지 않는다', async () => {
    const now = new Date('2026-09-20T00:00:00.000Z');
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'history-1',
        event: MilestoneDocumentSubmissionHistoryEvent.SUBMITTED,
        revision: 1,
        comment: null,
        content: Prisma.JsonNull,
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        actor: { nickname: 'synthetic-student' },
        files: [
          {
            id: 'file-expired',
            originalFileName: '만료된_계획서.pdf',
            lifecycle: SubmissionFileLifecycle.ATTACHED,
            expiresAt: new Date('2026-09-19T00:00:00.000Z'),
          },
        ],
      },
    ]);
    const repository = new MilestoneDocumentsRepository({
      milestoneDocumentSubmission: {
        findUnique: jest.fn().mockResolvedValue(submissionRecord(1, 1)),
      },
      milestoneDocumentSubmissionHistory: {
        findFirst: jest.fn(),
        findMany,
      },
    } as unknown as PrismaService);

    const page = await repository.findSubmissionHistoryPage(
      'document-1',
      'application-1',
      null,
      20,
      now,
    );

    expect(page?.items[0]).toEqual(
      expect.objectContaining({
        fileName: '만료된_계획서.pdf',
        downloadableFileId: null,
      }),
    );
  });

  it('아직 붙지 않은 첨부에도 내려받을 id를 주지 않는다', async () => {
    const now = new Date('2026-09-20T00:00:00.000Z');
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'history-1',
        event: MilestoneDocumentSubmissionHistoryEvent.SUBMITTED,
        revision: 1,
        comment: null,
        content: Prisma.JsonNull,
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        actor: { nickname: 'synthetic-student' },
        files: [
          {
            id: 'file-pending',
            originalFileName: '올리는_중.pdf',
            lifecycle: SubmissionFileLifecycle.PENDING,
            expiresAt: null,
          },
        ],
      },
    ]);
    const repository = new MilestoneDocumentsRepository({
      milestoneDocumentSubmission: {
        findUnique: jest.fn().mockResolvedValue(submissionRecord(1, 1)),
      },
      milestoneDocumentSubmissionHistory: {
        findFirst: jest.fn(),
        findMany,
      },
    } as unknown as PrismaService);

    const page = await repository.findSubmissionHistoryPage(
      'document-1',
      'application-1',
      null,
      20,
      now,
    );

    expect(page?.items[0]).toEqual(
      expect.objectContaining({
        fileName: '올리는_중.pdf',
        downloadableFileId: null,
      }),
    );
  });
});
