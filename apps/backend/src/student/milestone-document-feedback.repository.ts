import { SUBMISSION_REVIEW_EVENTS } from '../programs/submission-history.config';
import { Injectable } from '@nestjs/common';
import {
  ApplicationStatus,
  Prisma,
  type ReviewDecision,
  type SubmissionStatus,
} from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { PlatformRepository } from '../platform/platform.repository';
const RECENT_FEEDBACK_LIMIT = 50;
const recentReviewSelect = {
  id: true,
  event: true,
  comment: true,
  createdAt: true,
  submission: {
    select: {
      id: true,
      status: true,
      applicationId: true,
      milestoneDocument: {
        select: {
          name: true,
          milestone: { select: { id: true, name: true, programId: true } },
        },
      },
    },
  },
} satisfies Prisma.MilestoneDocumentSubmissionHistorySelect;
type RecentReviewRow = Prisma.MilestoneDocumentSubmissionHistoryGetPayload<{
  select: typeof recentReviewSelect;
}>;
export interface RecentMilestoneDocumentReview {
  readonly id: string;
  readonly decision: ReviewDecision;
  readonly comment: string | null;
  readonly reviewedAt: Date;
  readonly applicationId: string;
  readonly programId: string;
  readonly milestoneId: string;
  readonly milestoneName: string;
  readonly documentName: string;
  readonly submissionId: string;
  readonly submissionStatus: SubmissionStatus;
}
@Injectable()
export class MilestoneDocumentFeedbackRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platformRepository: PlatformRepository,
  ) {}
  async findRecentForParticipant(
    sessionGithubId: bigint,
    reviewedSince: Date,
  ): Promise<readonly RecentMilestoneDocumentReview[]> {
    const user = await this.prisma.user.findUnique({
      where: { githubId: sessionGithubId },
      select: { id: true },
    });
    if (user === null) return [];
    const rows = await this.prisma.milestoneDocumentSubmissionHistory.findMany({
      where: {
        createdAt: { gte: reviewedSince },
        event: { in: SUBMISSION_REVIEW_EVENTS },
        submission: {
          is: {
            application: {
              is: {
                status: ApplicationStatus.APPROVED,
                ...this.platformRepository.programApplicationParticipantWhere(
                  user.id,
                ),
              },
            },
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: RECENT_FEEDBACK_LIMIT,
      select: recentReviewSelect,
    });
    return rows.map(toRecentReview);
  }
}
function toRecentReview(row: RecentReviewRow): RecentMilestoneDocumentReview {
  const document = row.submission.milestoneDocument;
  return {
    id: row.id,
    decision: submissionReviewDecision(row.event),
    comment: row.comment,
    reviewedAt: row.createdAt,
    applicationId: row.submission.applicationId,
    programId: document.milestone.programId,
    milestoneId: document.milestone.id,
    milestoneName: document.milestone.name,
    documentName: document.name,
    submissionId: row.submission.id,
    submissionStatus: row.submission.status,
  };
}
function submissionReviewDecision(event: string): ReviewDecision {
  if (
    event === 'APPROVED' ||
    event === 'REJECTED' ||
    event === 'CHANGES_REQUESTED'
  )
    return event;
  throw new TypeError('Expected a submission review event');
}
