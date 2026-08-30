import {
  MilestoneDocumentKind,
  MilestoneDocumentSubmissionHistoryEvent,
  ReviewDecision,
  SubmissionFileLifecycle,
  SubmissionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LegacySubmissionPublicIdCollisionError } from './legacy-submission-target';
import { LegacySubmissionTargetRepository } from './legacy-submission-target.repository';

const submittedAt = new Date('2026-08-01T00:00:00.000Z');

function targetRow(
  overrides: Partial<{
    id: string;
    legacySubmissionId: string | null;
  }> = {},
) {
  return {
    id: overrides.id ?? 'target-header',
    legacySubmissionId:
      overrides.legacySubmissionId === undefined
        ? 'legacy-submission'
        : overrides.legacySubmissionId,
    applicationId: 'synthetic-application',
    revision: 2,
    status: SubmissionStatus.CHANGES_REQUESTED,
    content: null,
    submittedById: 'synthetic-student',
    submittedAt,
    milestoneDocument: { milestoneId: 'synthetic-milestone' },
  };
}

function setup() {
  const findSubmissions = jest.fn();
  const findHistories = jest.fn();
  const queryRaw = jest.fn();
  const prisma = {
    milestoneDocumentSubmission: { findMany: findSubmissions },
    milestoneDocumentSubmissionHistory: { findMany: findHistories },
    $queryRaw: queryRaw,
  } as unknown as PrismaService;
  return {
    repository: new LegacySubmissionTargetRepository(prisma),
    findSubmissions,
    findHistories,
    queryRaw,
  };
}

describe('LegacySubmissionTargetRepository', () => {
  it('resolves both migrated and target-created public ids inside the internal kind', async () => {
    const { repository, findSubmissions } = setup();
    findSubmissions
      .mockResolvedValueOnce([targetRow()])
      .mockResolvedValueOnce([targetRow({ legacySubmissionId: null })]);

    await expect(
      repository.resolveByPublicId('legacy-submission'),
    ).resolves.toEqual(
      expect.objectContaining({ publicSubmissionId: 'legacy-submission' }),
    );
    await expect(
      repository.resolveByPublicId('target-header'),
    ).resolves.toEqual(
      expect.objectContaining({ publicSubmissionId: 'target-header' }),
    );

    expect(findSubmissions).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          milestoneDocument: {
            is: {
              kind: MilestoneDocumentKind.LEGACY_MILESTONE_SUBMISSION,
            },
          },
          OR: [
            { id: 'legacy-submission' },
            { legacySubmissionId: 'legacy-submission' },
          ],
        },
        take: 2,
      }),
    );
  });

  it('returns null for no row and fails closed for cross-key ambiguity', async () => {
    const { repository, findSubmissions } = setup();
    findSubmissions
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        targetRow({ id: 'first' }),
        targetRow({ id: 'second', legacySubmissionId: 'other' }),
      ]);

    await expect(repository.resolveByPublicId('missing')).resolves.toBeNull();
    await expect(
      repository.resolveByPublicId('ambiguous'),
    ).rejects.toBeInstanceOf(LegacySubmissionPublicIdCollisionError);
  });

  it('returns every file in every revision without a single-file take', async () => {
    const { repository, findSubmissions, findHistories } = setup();
    findSubmissions.mockResolvedValue([targetRow()]);
    findHistories.mockResolvedValue([
      {
        id: 'history-2',
        event: MilestoneDocumentSubmissionHistoryEvent.RESUBMITTED,
        revision: 2,
        content: null,
        comment: 'synthetic resubmission',
        createdAt: new Date('2026-08-02T00:00:00.000Z'),
        files: [
          {
            id: 'file-2a',
            originalFileName: 'synthetic-2a.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 2,
            lifecycle: SubmissionFileLifecycle.ATTACHED,
            expiresAt: null,
          },
          {
            id: 'file-2b',
            originalFileName: 'synthetic-2b.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 3,
            lifecycle: SubmissionFileLifecycle.ATTACHED,
            expiresAt: null,
          },
        ],
        reviewHistories: [
          {
            id: 'review-2',
            decision: ReviewDecision.CHANGES_REQUESTED,
            comment: 'synthetic review',
            reviewedAt: new Date('2026-08-03T00:00:00.000Z'),
          },
        ],
      },
      {
        id: 'history-1',
        event: MilestoneDocumentSubmissionHistoryEvent.SUBMITTED,
        revision: 1,
        content: null,
        comment: null,
        createdAt: submittedAt,
        files: [
          {
            id: 'file-1',
            originalFileName: 'synthetic-1.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 1,
            lifecycle: SubmissionFileLifecycle.ATTACHED,
            expiresAt: null,
          },
        ],
        reviewHistories: [],
      },
    ]);

    const result = await repository.findHistoryWithFiles('legacy-submission');

    expect(result?.histories.map((history) => history.files.length)).toEqual([
      2, 1,
    ]);
    const calls = findHistories.mock.calls as readonly (readonly unknown[])[];
    const query = calls[0]?.[0] as {
      select: { files: Record<string, unknown> };
    };
    expect(query.select.files).not.toHaveProperty('take');
    expect(query.select.files).toHaveProperty('orderBy');
  });

  it('returns only the safe aggregate cross-key collision count', async () => {
    const { repository, queryRaw } = setup();
    queryRaw.mockResolvedValue([{ count: 2n }]);

    await expect(repository.countCrossKeyCollisions()).resolves.toBe(2);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });
});
