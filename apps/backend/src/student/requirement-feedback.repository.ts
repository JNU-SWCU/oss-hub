import { SUBMISSION_REVIEW_EVENTS } from '../programs/submission-history.config';
import { Injectable } from '@nestjs/common';
import {
  ApplicationStatus,
  Prisma,
  type SubmissionStatus,
} from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { PlatformRepository } from '../platform/platform.repository';
import type { SubmissionReviewDecision } from '../programs/submissions.repository';
const FEEDBACK_PAGE_SIZE = 50;
const recentReviewSelect = {
  id: true,
  event: true,
  comment: true,
  createdAt: true,
  submission: {
    select: {
      id: true,
      status: true,
      teamId: true,
      requirement: {
        select: {
          name: true,
          milestone: { select: { id: true, name: true, programId: true } },
        },
      },
    },
  },
} satisfies Prisma.SubmissionHistorySelect;
type RecentReviewRow = Prisma.SubmissionHistoryGetPayload<{
  select: typeof recentReviewSelect;
}>;
export interface RecentRequirementReview {
  readonly id: string;
  readonly decision: SubmissionReviewDecision;
  readonly comment: string | null;
  readonly reviewedAt: Date;
  readonly teamId: string;
  readonly programId: string;
  readonly milestoneId: string;
  readonly milestoneName: string;
  readonly documentName: string;
  readonly submissionId: string;
  readonly submissionStatus: SubmissionStatus;
}
export interface RecentRequirementReviewPage {
  readonly reviews: readonly RecentRequirementReview[];
  readonly nextCursor: string | null;
}
@Injectable()
export class RequirementFeedbackRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platformRepository: PlatformRepository,
  ) {}
  async findRecentForParticipant(
    sessionGithubId: bigint,
    reviewedSince: Date,
    cursor: string | null,
  ): Promise<RecentRequirementReviewPage> {
    const user = await this.prisma.user.findUnique({
      where: { githubId: sessionGithubId },
      select: { id: true },
    });
    if (user === null) return { reviews: [], nextCursor: null };
    const rows = await this.prisma.submissionHistory.findMany({
      where: {
        createdAt: { gte: reviewedSince },
        event: { in: SUBMISSION_REVIEW_EVENTS },
        submission: {
          is: {
            team: {
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
      take: FEEDBACK_PAGE_SIZE + 1,
      ...(cursor === null ? {} : { cursor: { id: cursor }, skip: 1 }),
      select: recentReviewSelect,
    });
    const page = rows.slice(0, FEEDBACK_PAGE_SIZE);
    return {
      reviews: page.map(toRecentReview),
      nextCursor:
        rows.length > FEEDBACK_PAGE_SIZE ? (page.at(-1)?.id ?? null) : null,
    };
  }
}
function toRecentReview(row: RecentReviewRow): RecentRequirementReview {
  const document = row.submission.requirement;
  return {
    id: row.id,
    decision: submissionReviewDecision(row.event),
    comment: row.comment,
    reviewedAt: row.createdAt,
    teamId: row.submission.teamId,
    programId: document.milestone.programId,
    milestoneId: document.milestone.id,
    milestoneName: document.milestone.name,
    documentName: document.name,
    submissionId: row.submission.id,
    submissionStatus: row.submission.status,
  };
}
function submissionReviewDecision(event: string): SubmissionReviewDecision {
  const decision = SUBMISSION_REVIEW_EVENTS.find(
    (candidate) => candidate === event,
  );
  if (decision === undefined)
    throw new TypeError('Expected a submission review event');
  return decision;
}
