import { SubmissionsRepository } from './submissions.repository';
import { PlatformRepository } from '../platform/platform.repository';
import { Injectable } from '@nestjs/common';
import {
  MilestoneDocumentKind,
  MilestoneDocumentSubmissionHistoryEvent,
  Prisma,
  SubmissionStatus,
  type Prisma as PrismaTypes,
  type ReviewDecision,
  RepositoryVisibility,
  type MilestoneSubmissionType,
  type RepositoryProvisionJobStatus,
} from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import type { PublishBlockedReason } from '../github/repository-publish.config';
import { USER_PROFILE_NAME_SELECT } from '../platform/user-profile-read.config';
import type { SubmissionCompletionTargetRow } from './submission-completion.config';

type JsonObject = { [key in string]?: JsonValue };

type JsonArray = JsonValue[];

type JsonValue = string | number | boolean | null | JsonObject | JsonArray;

export type SubmissionRevisionContent = JsonValue;

type ApplicationMode = 'PERSONAL' | 'TEAM';

export interface SubmissionReviewRecord {
  readonly id: string;
  readonly decision: ReviewDecision;
  readonly comment: string | null;
  readonly reviewedAt: Date;
}

export interface SubmissionReviewFileRecord {
  readonly fileId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly size: number;
  readonly expiresAt: Date;
  readonly downloadUrl: string;
}

export interface SubmissionRevisionRecord {
  readonly number: number;
  readonly content: SubmissionRevisionContent;
  readonly comment: string | null;
  readonly submittedAt: Date;
  readonly files: readonly SubmissionReviewFileRecord[];
  readonly review: SubmissionReviewRecord | null;
}

export interface SubmissionReviewContext {
  readonly submissionId: string;
  readonly application: {
    readonly id: string;
    readonly applicationMode: ApplicationMode;
    readonly displayName: string;
  };
  readonly milestone: { readonly id: string; readonly name: string };
  readonly currentRevision: SubmissionRevisionRecord;
  readonly history: readonly SubmissionRevisionRecord[];
  readonly repository: {
    readonly id: string;
    readonly url: string;
    readonly visibility: RepositoryVisibility;
    readonly publishEligible: boolean;
    readonly blockedReasons: readonly PublishBlockedReason[];
  } | null;
}

export interface CreateSubmissionReviewInput {
  readonly revision: number;
  readonly decision: ReviewDecision;
  readonly comment: string | null;
}

interface SubmissionReviewTarget {
  readonly id: string;
  readonly currentRevision: number;
  readonly status: SubmissionStatus;
  readonly revision: {
    readonly id: string;
    readonly reviewId: string | null;
  };
}

export interface SubmissionReviewResult {
  readonly reviewId: string;
  readonly submissionStatus: SubmissionStatus;
}

export interface RepositoryPublishResult {
  readonly repositoryId: string;
  readonly visibility: typeof RepositoryVisibility.PUBLIC;
  readonly publishedAt: Date;
}

export interface PublishEligibilitySource {
  readonly milestoneDocumentSubmissions: readonly SubmissionCompletionTargetRow[];
  readonly isRepositoryPublicationPlanned: boolean;
  readonly provisionJob: {
    readonly status: RepositoryProvisionJobStatus;
    readonly repositoryId: string | null;
  } | null;
  readonly program: {
    readonly endAt: Date;
    readonly milestones: readonly {
      readonly id: string;
      readonly submissionType?: MilestoneSubmissionType | null;
      readonly documents: readonly { readonly id: string }[];
    }[];
  };
}

export interface PublishEligibilityRow {
  readonly id: string;
  readonly visibility: RepositoryVisibility;
  readonly application: PublishEligibilitySource;
}

export type ReviewContextRow = Prisma.MilestoneDocumentSubmissionGetPayload<{
  select: typeof SubmissionReviewsRepository.REVIEW_CONTEXT_SELECT;
}>;

interface CreateReviewRecordInput {
  readonly submissionHistoryId: string;
  readonly milestoneDocumentSubmissionId: string;
  readonly revision: number;
  readonly reviewerId: string;
  readonly decision: ReviewDecision;
  readonly comment: string | null;
  readonly reviewedAt: Date;
}

interface TransitionSubmissionInput {
  readonly submissionId: string;
  readonly expectedRevision: number;
  readonly nextStatus: SubmissionStatus;
}

export interface SubmissionReviewTransactionStore {
  isSubmissionParticipant(
    submissionId: string,
    userId: string,
  ): Promise<boolean>;

  findReviewTarget(
    submissionId: string,
  ): Promise<SubmissionReviewTarget | null>;
  createReview(
    input: CreateReviewRecordInput,
  ): Promise<{ readonly id: string }>;
  transitionSubmission(input: TransitionSubmissionInput): Promise<boolean>;
}

export interface SubmissionReviewsRepositoryPort {
  withTransaction<T>(
    operation: (store: SubmissionReviewTransactionStore) => Promise<T>,
  ): Promise<T>;
  findReviewContext(submissionId: string): Promise<ReviewContextRow | null>;
  findPublishEligibility(
    repositoryId: string,
  ): Promise<PublishEligibilityRow | null>;
}

class PrismaSubmissionReviewTransactionRepository implements SubmissionReviewTransactionStore {
  constructor(private readonly transaction: PrismaTypes.TransactionClient) {}

  async isSubmissionParticipant(
    submissionId: string,
    userId: string,
  ): Promise<boolean> {
    const submission =
      await this.transaction.milestoneDocumentSubmission.findFirst({
        where: {
          id: submissionId,
          application:
            PlatformRepository.programApplicationParticipantWhere(userId),
        },
        select: { id: true },
      });
    return submission !== null;
  }

  async findReviewTarget(
    submissionId: string,
  ): Promise<SubmissionReviewTarget | null> {
    const submissions =
      await this.transaction.milestoneDocumentSubmission.findMany({
        where: {
          ...SubmissionsRepository.submissionPublicIdWhere(submissionId),
          milestoneDocument: {
            kind: MilestoneDocumentKind.LEGACY_MILESTONE_SUBMISSION,
          },
        },
        take: 2,
        select: { id: true },
      });
    const resolved =
      SubmissionsRepository.exactSubmissionByPublicId(submissions);
    if (resolved === null) return null;
    const targetId = resolved.id;
    await this.transaction.$queryRaw<readonly { id: string }[]>(Prisma.sql`
      SELECT "id"
      FROM "MilestoneDocumentSubmission"
      WHERE "id" = ${targetId}
      FOR UPDATE
    `);
    const submission =
      await this.transaction.milestoneDocumentSubmission.findUnique({
        where: { id: targetId },
        select: { id: true, revision: true, status: true },
      });
    if (submission === null) return null;
    const history =
      await this.transaction.milestoneDocumentSubmissionHistory.findFirst({
        where: {
          milestoneDocumentSubmissionId: targetId,
          revision: submission.revision,
          event: {
            in: [
              MilestoneDocumentSubmissionHistoryEvent.SUBMITTED,
              MilestoneDocumentSubmissionHistoryEvent.RESUBMITTED,
            ],
          },
        },
        orderBy: { id: 'desc' },
        select: {
          id: true,
          reviewHistories: {
            where: { milestoneDocumentSubmissionId: targetId },
            take: 1,
            select: { id: true },
          },
        },
      });
    if (history === null) return null;
    return {
      id: submission.id,
      currentRevision: submission.revision,
      status: submission.status,
      revision: {
        id: history.id,
        reviewId: history.reviewHistories[0]?.id ?? null,
      },
    };
  }

  async createReview(
    input: CreateReviewRecordInput,
  ): Promise<{ readonly id: string }> {
    const review = await PlatformRepository.appendSubmissionReview(
      this.transaction,
      input,
      {
        id: true,
      },
    );
    await PlatformRepository.appendSubmissionReviewEvent(
      this.transaction,
      input,
    );
    return review;
  }

  async transitionSubmission(
    input: TransitionSubmissionInput,
  ): Promise<boolean> {
    const result =
      await this.transaction.milestoneDocumentSubmission.updateMany({
        where: {
          id: input.submissionId,
          revision: input.expectedRevision,
        },
        data: { status: input.nextStatus },
      });
    return result.count === 1;
  }
}

@Injectable()
export class SubmissionReviewsRepository implements SubmissionReviewsRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async withTransaction<T>(
    operation: (store: SubmissionReviewTransactionStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((transaction) =>
      operation(new PrismaSubmissionReviewTransactionRepository(transaction)),
    );
  }

  async findReviewContext(
    submissionId: string,
  ): Promise<ReviewContextRow | null> {
    const submissions = await this.prisma.milestoneDocumentSubmission.findMany({
      where: {
        ...SubmissionsRepository.submissionPublicIdWhere(submissionId),
        milestoneDocument: {
          kind: MilestoneDocumentKind.LEGACY_MILESTONE_SUBMISSION,
        },
      },
      take: 2,
      select: SubmissionReviewsRepository.REVIEW_CONTEXT_SELECT,
    });
    const submission =
      SubmissionsRepository.exactSubmissionByPublicId(submissions);
    return submission ?? null;
  }

  async findPublishEligibility(
    repositoryId: string,
  ): Promise<PublishEligibilityRow | null> {
    const repository = await this.prisma.githubRepository.findUnique({
      where: { id: repositoryId },
      select: {
        id: true,
        visibility: true,
        application: {
          select: {
            isRepositoryPublicationPlanned: true,
            provisionJob: { select: { status: true, repositoryId: true } },
            program: {
              select: {
                endAt: true,
                milestones: {
                  select: {
                    id: true,
                    submissionType: true,

                    documents: {
                      where: {
                        required: true,
                        kind: MilestoneDocumentKind.DOCUMENT,
                      },
                      select: { id: true },
                    },
                  },
                },
              },
            },
            milestoneDocumentSubmissions: {
              select: {
                status: true,
                milestoneDocument: {
                  select: { id: true, milestoneId: true, kind: true },
                },
              },
            },
          },
        },
      },
    });

    if (repository === null || repository.application === null) return null;
    return { ...repository, application: repository.application };
  }

  static readonly REVIEW_CONTEXT_SELECT = {
    id: true,
    legacySubmissionId: true,
    revision: true,
    application: {
      select: {
        id: true,
        teamId: true,
        applicant: {
          select: { nickname: true, ...USER_PROFILE_NAME_SELECT },
        },
        team: { select: { name: true } },
        isRepositoryPublicationPlanned: true,
        provisionJob: { select: { status: true, repositoryId: true } },
        program: {
          select: {
            endAt: true,
            milestones: {
              select: {
                id: true,
                submissionType: true,
                documents: {
                  where: {
                    required: true,
                    kind: MilestoneDocumentKind.DOCUMENT,
                  },
                  select: { id: true },
                },
              },
            },
          },
        },
        milestoneDocumentSubmissions: {
          select: {
            status: true,
            milestoneDocument: {
              select: { id: true, milestoneId: true, kind: true },
            },
          },
        },
        repository: {
          select: {
            id: true,
            nameWithOwner: true,
            visibility: true,
          },
        },
      },
    },
    milestoneDocument: {
      select: { milestone: { select: { id: true, name: true } } },
    },
    histories: {
      where: {
        event: {
          in: [
            MilestoneDocumentSubmissionHistoryEvent.SUBMITTED,
            MilestoneDocumentSubmissionHistoryEvent.RESUBMITTED,
          ],
        },
      },
      orderBy: [{ revision: 'desc' as const }, { id: 'desc' as const }],
      select: {
        id: true,
        revision: true,
        content: true,
        comment: true,
        createdAt: true,
        files: {
          orderBy: { id: 'asc' as const },
          select: {
            id: true,
            originalFileName: true,
            mimeType: true,
            sizeBytes: true,
            expiresAt: true,
            lifecycle: true,
          },
        },
        reviewHistories: {
          orderBy: [{ reviewedAt: 'desc' as const }, { id: 'desc' as const }],
          take: 1,
          select: {
            id: true,
            decision: true,
            comment: true,
            reviewedAt: true,
          },
        },
      },
    },
  } satisfies Prisma.MilestoneDocumentSubmissionSelect;
}
