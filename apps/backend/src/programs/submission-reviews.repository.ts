import { SUBMISSION_REVIEW_EVENTS } from './submission-history.config';
import { PlatformRepository } from '../platform/platform.repository';
import { Injectable } from '@nestjs/common';
import {
  SubmissionHistoryEvent,
  Prisma,
  SubmissionStatus,
  type Prisma as PrismaTypes,
  type ReviewDecision,
  RepositoryVisibility,
  type RepositoryProvisionJobStatus,
} from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import type { PublishBlockedReason } from '../github/repository-publish.config';
import { USER_PROFILE_NAME_SELECT } from '../platform/user-profile-read.config';
import type { SubmissionCompletionTargetRow } from './submission-completion.config';
type JsonObject = {
  [key in string]?: JsonValue;
};
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
  readonly latestReviewId: string | null;
  readonly requirementId: string;
  readonly submissionId: string;
  readonly application: {
    readonly id: string;
    readonly applicationMode: ApplicationMode;
    readonly displayName: string;
  };
  readonly milestone: {
    readonly id: string;
    readonly name: string;
  };
  readonly currentRevision: SubmissionRevisionRecord;
  readonly history: readonly SubmissionRevisionRecord[];
  readonly unversionedReviews?: readonly SubmissionReviewRecord[];
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
  readonly submissions: readonly SubmissionCompletionTargetRow[];
  readonly isRepositoryPublicationPlanned: boolean;
  readonly provisionJob: {
    readonly status: RepositoryProvisionJobStatus;
    readonly repositoryId: string | null;
  } | null;
  readonly program: {
    readonly endAt: Date;
    readonly milestones: readonly {
      readonly id: string;
      readonly requirements: readonly {
        readonly id: string;
      }[];
    }[];
  };
}
export interface PublishEligibilityRow {
  readonly id: string;
  readonly visibility: RepositoryVisibility;
  readonly application: PublishEligibilitySource;
}
export type ReviewContextRow = Prisma.SubmissionGetPayload<{
  select: SubmissionReviewsRepository['REVIEW_CONTEXT_SELECT'];
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
  createReview(input: CreateReviewRecordInput): Promise<{
    readonly id: string;
  }>;
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
@Injectable()
export class SubmissionReviewsRepository implements SubmissionReviewsRepositoryPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platformRepository: PlatformRepository,
  ) {}
  async withTransaction<T>(
    operation: (store: SubmissionReviewTransactionStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((transaction) =>
      operation(this.submissionReviewTransactionStore(transaction)),
    );
  }
  async findReviewContext(
    submissionId: string,
  ): Promise<ReviewContextRow | null> {
    return this.prisma.submission.findUnique({
      where: {
        id: submissionId,
        team: { program: { lifecycle: { not: 'DELETED' } } },
      },
      select: this.REVIEW_CONTEXT_SELECT,
    });
  }
  async findPublishEligibility(
    repositoryId: string,
  ): Promise<PublishEligibilityRow | null> {
    const repository = await this.prisma.githubRepository.findUnique({
      where: {
        id: repositoryId,
        team: { program: { lifecycle: { not: 'DELETED' } } },
      },
      select: {
        id: true,
        visibility: true,
        team: {
          select: {
            isRepositoryPublicationPlanned: true,
            provisionJob: { select: { status: true, repositoryId: true } },
            program: {
              select: {
                endAt: true,
                milestones: {
                  select: {
                    id: true,
                    requirements: {
                      where: {
                        required: true,
                      },
                      select: { id: true },
                    },
                  },
                },
              },
            },
            submissions: {
              select: {
                status: true,
                requirement: {
                  select: { id: true, milestoneId: true },
                },
              },
            },
          },
        },
      },
    });

    if (repository === null || repository.team === null) return null;
    return { ...repository, application: repository.team };
  }
  readonly REVIEW_CONTEXT_SELECT = {
    id: true,
    revision: true,
    team: {
      select: {
        id: true,
        applicant: {
          select: { nickname: true, ...USER_PROFILE_NAME_SELECT },
        },
        name: true,
        isRepositoryPublicationPlanned: true,
        provisionJob: { select: { status: true, repositoryId: true } },
        program: {
          select: {
            endAt: true,
            milestones: {
              select: {
                id: true,
                requirements: {
                  where: {
                    required: true,
                  },
                  select: { id: true },
                },
              },
            },
          },
        },
        submissions: {
          select: {
            status: true,
            requirement: {
              select: { id: true, milestoneId: true },
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
    requirement: {
      select: { id: true, milestone: { select: { id: true, name: true } } },
    },
    histories: {
      orderBy: [
        { revision: 'desc' as const },
        { createdAt: 'desc' as const },
        { id: 'desc' as const },
      ],
      select: {
        id: true,
        event: true,
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
      },
    },
  } satisfies Prisma.SubmissionSelect;
  private submissionReviewTransactionStore(
    transaction: PrismaTypes.TransactionClient,
  ): SubmissionReviewTransactionStore {
    return {
      isSubmissionParticipant: this.isSubmissionParticipantIn.bind(
        this,
        transaction,
      ),
      findReviewTarget: this.findReviewTargetIn.bind(this, transaction),
      createReview: this.createReviewIn.bind(this, transaction),
      transitionSubmission: this.transitionSubmissionIn.bind(this, transaction),
    };
  }
  private async isSubmissionParticipantIn(
    transaction: PrismaTypes.TransactionClient,
    submissionId: string,
    userId: string,
  ): Promise<boolean> {
    const submission = await transaction.submission.findFirst({
      where: {
        id: submissionId,
        team: this.platformRepository.programApplicationParticipantWhere(
          userId,
        ),
      },
      select: { id: true },
    });
    return submission !== null;
  }
  private async findReviewTargetIn(
    transaction: PrismaTypes.TransactionClient,
    submissionId: string,
  ): Promise<SubmissionReviewTarget | null> {
    const resolved = await transaction.submission.findUnique({
      where: {
        id: submissionId,
      },
      select: { id: true, team: { select: { programId: true } } },
    });
    if (resolved === null) return null;
    const targetId = resolved.id;
    const programs = await transaction.$queryRaw<
      readonly {
        id: string;
      }[]
    >(Prisma.sql`
        SELECT "id"
        FROM "Program"
        WHERE "id" = ${resolved.team.programId}
          AND "lifecycle" <> 'DELETED'
        FOR SHARE
      `);
    if (programs.length === 0) return null;
    await transaction.$queryRaw<
      readonly {
        id: string;
      }[]
    >(Prisma.sql`
      SELECT "id"
      FROM "MilestoneDocumentSubmission"
      WHERE "id" = ${targetId}
      FOR UPDATE
    `);
    const submission = await transaction.submission.findUnique({
      where: {
        id: targetId,
        team: { program: { lifecycle: { not: 'DELETED' } } },
      },
      select: { id: true, revision: true, status: true },
    });
    if (submission === null) return null;
    const history = await transaction.submissionHistory.findFirst({
      where: {
        submissionId: targetId,
        revision: submission.revision,
        event: {
          in: [
            SubmissionHistoryEvent.SUBMITTED,
            SubmissionHistoryEvent.RESUBMITTED,
          ],
        },
      },
      orderBy: { id: 'desc' },
      select: {
        id: true,
      },
    });
    if (history === null) return null;
    const review = await transaction.submissionHistory.findFirst({
      where: {
        submissionId: targetId,
        revision: submission.revision,
        event: { in: SUBMISSION_REVIEW_EVENTS },
      },
      select: { id: true },
    });
    return {
      id: submission.id,
      currentRevision: submission.revision,
      status: submission.status,
      revision: {
        id: history.id,
        reviewId: review?.id ?? null,
      },
    };
  }
  private async createReviewIn(
    transaction: PrismaTypes.TransactionClient,
    input: CreateReviewRecordInput,
  ): Promise<{
    readonly id: string;
  }> {
    return this.platformRepository.appendSubmissionReviewEvent(
      transaction,
      input,
    );
  }
  private async transitionSubmissionIn(
    transaction: PrismaTypes.TransactionClient,
    input: TransitionSubmissionInput,
  ): Promise<boolean> {
    const result = await transaction.submission.updateMany({
      where: {
        id: input.submissionId,
        revision: input.expectedRevision,
      },
      data: { status: input.nextStatus },
    });
    return result.count === 1;
  }
}
