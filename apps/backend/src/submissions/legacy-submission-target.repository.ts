import { Injectable } from '@nestjs/common';
import { MilestoneDocumentKind, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  LegacySubmissionPublicIdCollisionError,
  type LegacyTargetSubmissionHistory,
  type LegacyTargetSubmissionRecord,
  publicLegacySubmissionId,
  requiredLegacySubmissionPublicId,
} from './legacy-submission-target';

const legacyTargetSubmissionSelect = {
  id: true,
  legacySubmissionId: true,
  applicationId: true,
  revision: true,
  status: true,
  content: true,
  submittedById: true,
  submittedAt: true,
  milestoneDocument: { select: { milestoneId: true } },
} satisfies Prisma.MilestoneDocumentSubmissionSelect;

type LegacyTargetSubmissionRow = Prisma.MilestoneDocumentSubmissionGetPayload<{
  select: typeof legacyTargetSubmissionSelect;
}>;

const legacyTargetHistorySelect = {
  id: true,
  event: true,
  revision: true,
  content: true,
  comment: true,
  createdAt: true,
  files: {
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
    select: {
      id: true,
      originalFileName: true,
      mimeType: true,
      sizeBytes: true,
      lifecycle: true,
      expiresAt: true,
    },
  },
  reviewHistories: {
    orderBy: [{ reviewedAt: 'asc' as const }, { id: 'asc' as const }],
    select: {
      id: true,
      decision: true,
      comment: true,
      reviewedAt: true,
    },
  },
} satisfies Prisma.MilestoneDocumentSubmissionHistorySelect;

function toSubmissionRecord(
  row: LegacyTargetSubmissionRow,
): LegacyTargetSubmissionRecord {
  return {
    id: row.id,
    legacySubmissionId: row.legacySubmissionId,
    publicSubmissionId: publicLegacySubmissionId(row),
    applicationId: row.applicationId,
    milestoneId: row.milestoneDocument.milestoneId,
    revision: row.revision,
    status: row.status,
    content: row.content,
    submittedById: row.submittedById,
    submittedAt: row.submittedAt,
  };
}

/**
 * Phase 1 dormant adapter. Runtime routing stays on the legacy repositories until the bridge
 * transaction has populated and reconciled this target ledger.
 */
@Injectable()
export class LegacySubmissionTargetRepository {
  constructor(private readonly prisma: PrismaService) {}

  async resolveByPublicId(
    value: unknown,
  ): Promise<LegacyTargetSubmissionRecord | null> {
    const publicId = requiredLegacySubmissionPublicId(value);
    const rows = await this.prisma.milestoneDocumentSubmission.findMany({
      where: {
        milestoneDocument: {
          is: { kind: MilestoneDocumentKind.LEGACY_MILESTONE_SUBMISSION },
        },
        OR: [{ id: publicId }, { legacySubmissionId: publicId }],
      },
      orderBy: { id: 'asc' },
      take: 2,
      select: legacyTargetSubmissionSelect,
    });
    if (rows.length > 1) {
      throw new LegacySubmissionPublicIdCollisionError(
        'Ambiguous legacy submission public id',
      );
    }
    return rows[0] ? toSubmissionRecord(rows[0]) : null;
  }

  async findHistoryWithFiles(
    value: unknown,
  ): Promise<LegacyTargetSubmissionHistory | null> {
    const submission = await this.resolveByPublicId(value);
    if (submission === null) return null;

    const histories =
      await this.prisma.milestoneDocumentSubmissionHistory.findMany({
        where: { milestoneDocumentSubmissionId: submission.id },
        // milestone-document-history.ts의 공개 cursor 계약과 같은 안정 순서다.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: legacyTargetHistorySelect,
      });

    return {
      submission,
      histories: histories.map((history) => ({
        id: history.id,
        event: history.event,
        revision: history.revision,
        content: history.content,
        comment: history.comment,
        createdAt: history.createdAt,
        files: history.files,
        reviews: history.reviewHistories,
      })),
    };
  }

  async countCrossKeyCollisions(): Promise<number> {
    const rows = await this.prisma.$queryRaw<readonly { count: bigint }[]>(
      Prisma.sql`
        SELECT COUNT(*)::bigint AS "count"
        FROM "MilestoneDocumentSubmission" AS primary_row
        JOIN "MilestoneDocumentSubmission" AS provenance_row
          ON primary_row."id" = provenance_row."legacySubmissionId"
         AND primary_row."id" <> provenance_row."id"
      `,
    );
    return Number(rows[0]?.count ?? 0n);
  }
}
