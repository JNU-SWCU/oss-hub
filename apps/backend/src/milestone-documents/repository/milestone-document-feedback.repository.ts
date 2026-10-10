import { Injectable } from '@nestjs/common';
import {
  ApplicationStatus,
  type MilestoneDocumentKind,
  Prisma,
  type ReviewDecision,
  type SubmissionStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { programApplicationParticipantWhere } from '../../prisma/program-application-participant';

const RECENT_FEEDBACK_LIMIT = 50;

const recentReviewSelect = {
  id: true,
  decision: true,
  comment: true,
  reviewedAt: true,
  resubmissionDueAt: true,
  milestoneDocumentSubmission: {
    select: {
      id: true,
      status: true,
      applicationId: true,
      milestoneDocument: {
        select: {
          name: true,
          kind: true,
          milestone: { select: { id: true, name: true, programId: true } },
        },
      },
    },
  },
} as const satisfies Prisma.MilestoneDocumentReviewHistorySelect;

type RecentReviewRow = Prisma.MilestoneDocumentReviewHistoryGetPayload<{
  select: typeof recentReviewSelect;
}>;

export interface RecentMilestoneDocumentReview {
  readonly id: string;
  readonly decision: ReviewDecision;
  readonly comment: string | null;
  readonly reviewedAt: Date;
  readonly resubmissionDueAt: Date | null;
  readonly applicationId: string;
  readonly programId: string;
  readonly milestoneId: string;
  readonly milestoneName: string;
  readonly documentName: string;
  readonly documentKind: MilestoneDocumentKind;
  readonly submissionId: string;
  readonly submissionStatus: SubmissionStatus;
}

@Injectable()
export class MilestoneDocumentFeedbackRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findRecentForParticipant(
    sessionGithubId: bigint,
    reviewedSince: Date,
  ): Promise<readonly RecentMilestoneDocumentReview[]> {
    const user = await this.prisma.user.findUnique({
      where: { githubId: sessionGithubId },
      select: { id: true },
    });
    if (user === null) return [];

    const rows = await this.prisma.milestoneDocumentReviewHistory.findMany({
      where: {
        reviewedAt: { gte: reviewedSince },
        milestoneDocumentSubmission: {
          is: {
            application: {
              is: {
                status: ApplicationStatus.APPROVED,
                ...programApplicationParticipantWhere(user.id),
              },
            },
          },
        },
      },
      orderBy: [{ reviewedAt: 'desc' }, { id: 'desc' }],
      take: RECENT_FEEDBACK_LIMIT,
      select: recentReviewSelect,
    });
    return rows.map(toRecentReview);
  }
}

function toRecentReview(row: RecentReviewRow): RecentMilestoneDocumentReview {
  const document = row.milestoneDocumentSubmission.milestoneDocument;
  return {
    id: row.id,
    decision: row.decision,
    comment: row.comment,
    reviewedAt: row.reviewedAt,
    resubmissionDueAt: row.resubmissionDueAt,
    applicationId: row.milestoneDocumentSubmission.applicationId,
    programId: document.milestone.programId,
    milestoneId: document.milestone.id,
    milestoneName: document.milestone.name,
    documentName: document.name,
    documentKind: document.kind,
    submissionId: row.milestoneDocumentSubmission.id,
    submissionStatus: row.milestoneDocumentSubmission.status,
  };
}
