import {
  MilestoneDocumentKind,
  Prisma,
  MilestoneDocumentSubmissionHistoryEvent,
  SubmissionFileLifecycle,
  type ApplicationStatus,
  type SubmissionStatus,
  type ReviewDecision,
  type MilestoneSubmissionType,
} from '@prisma/client';
import { ProgramApplicationParticipantRepository } from '../platform/program-application-participant.repository';
import { SubmissionPublicIdCollisionError } from './submissions.error';

const CANONICAL_CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.pdf': 'application/pdf',
  '.hwp': 'application/x-hwp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.zip': 'application/zip',
};

export function submissionFileExtension(fileName: string): string | null {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) return null;
  return fileName.slice(dot).toLowerCase();
}

export function safeSubmissionFileContentType(fileName: string): string {
  const extension = submissionFileExtension(fileName);
  return extension === null
    ? 'application/octet-stream'
    : (CANONICAL_CONTENT_TYPES[extension] ?? 'application/octet-stream');
}

export interface SubmissionApplication {
  readonly id: string;
  readonly programId: string;
  readonly teamId: string | null;

  readonly teamMemberCount: number;
  readonly status: ApplicationStatus;
  readonly existingSubmission: {
    readonly id: string;
    readonly status: SubmissionStatus;
  } | null;
}

interface ChecklistLatestReview {
  readonly decision: ReviewDecision;
  readonly reviewedAt: Date;
  readonly comment: string | null;
}

export interface SubmissionFileMetadata {
  readonly fileId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly size: number;
  readonly expiresAt: Date;
}

export interface ChecklistMilestone {
  readonly id: string;
  readonly name: string;
  readonly dueAt: Date;
  readonly submissionType: MilestoneSubmissionType;
  readonly submission: {
    readonly id: string;
    readonly status: SubmissionStatus;
    readonly currentRevision: number;
    readonly latestReview: ChecklistLatestReview | null;
    readonly file: SubmissionFileMetadata | null;
  } | null;
}

export interface SubmissionPublicIdentity {
  readonly id: string;
  readonly legacySubmissionId: string | null;
}

export function publicSubmissionId(identity: SubmissionPublicIdentity): string {
  return identity.legacySubmissionId ?? identity.id;
}

export function submissionPublicIdWhere(publicId: string) {
  return { OR: [{ id: publicId }, { legacySubmissionId: publicId }] };
}

export function exactSubmissionByPublicId<T>(rows: readonly T[]): T | null {
  if (rows.length > 1) {
    throw new SubmissionPublicIdCollisionError(
      'Ambiguous submission public id',
    );
  }
  return rows[0] ?? null;
}

export class SubmissionChecklistRecordRepository {
  static submissionParticipantWhere(
    userId: string,
  ): Prisma.ApplicationWhereInput {
    return ProgramApplicationParticipantRepository.programApplicationParticipantWhere(
      userId,
    );
  }

  static toSubmissionApplication(
    application: ApplicationRecord,
  ): SubmissionApplication {
    return {
      id: application.id,
      programId: application.programId,
      teamId: application.teamId,
      teamMemberCount: application.team._count.members,
      status: application.status,
      existingSubmission: application.milestoneDocumentSubmissions[0]
        ? {
            id: publicSubmissionId(application.milestoneDocumentSubmissions[0]),
            status: application.milestoneDocumentSubmissions[0].status,
          }
        : null,
    };
  }

  static toChecklistMilestone(
    record: ChecklistMilestoneRecord,
  ): ChecklistMilestone | null {
    if (record.submissionType === null) return null;
    const submission = record.documents[0]?.submissions[0] ?? null;
    return {
      id: record.id,
      name: record.name,
      dueAt: record.dueAt,
      submissionType: record.submissionType,
      submission: submission
        ? {
            id: publicSubmissionId(submission),
            status: submission.status,
            currentRevision: submission.revision,
            latestReview: submission.reviewHistories[0] ?? null,
            file: currentRevisionFile(submission),
          }
        : null,
    };
  }
}

export const submissionApplicationSelect = (milestoneId: string) =>
  ({
    id: true,
    programId: true,
    teamId: true,

    team: { select: { _count: { select: { members: true } } } },
    status: true,
    milestoneDocumentSubmissions: {
      where: {
        milestoneDocument: {
          milestoneId,
          kind: MilestoneDocumentKind.LEGACY_MILESTONE_SUBMISSION,
        },
      },
      take: 1,
      select: { id: true, legacySubmissionId: true, status: true },
    },
  }) as const;

type ApplicationRecord = Prisma.ApplicationGetPayload<{
  select: ReturnType<typeof submissionApplicationSelect>;
}>;

const SUBMISSION_HISTORY_EVENTS: MilestoneDocumentSubmissionHistoryEvent[] = [
  MilestoneDocumentSubmissionHistoryEvent.SUBMITTED,
  MilestoneDocumentSubmissionHistoryEvent.RESUBMITTED,
];

export const checklistMilestoneOrderBy = [
  { dueAt: 'asc' as const },
  { createdAt: 'asc' as const },
];

export const checklistMilestoneSelect = (applicationId: string, now: Date) =>
  ({
    id: true,
    name: true,
    dueAt: true,
    submissionType: true,
    documents: {
      where: { kind: MilestoneDocumentKind.LEGACY_MILESTONE_SUBMISSION },
      take: 1,
      select: {
        submissions: {
          where: { applicationId },
          take: 1,
          select: {
            id: true,
            legacySubmissionId: true,
            status: true,
            revision: true,
            reviewHistories: {
              orderBy: { reviewedAt: 'desc' as const },
              take: 1,
              select: {
                decision: true,
                reviewedAt: true,
                comment: true,
              },
            },
            histories: {
              where: {
                event: {
                  in: SUBMISSION_HISTORY_EVENTS,
                },
              },
              orderBy: { revision: 'desc' as const },
              take: 1,
              select: {
                revision: true,
                files: {
                  where: {
                    lifecycle: SubmissionFileLifecycle.ATTACHED,
                    expiresAt: { gt: now },
                  },
                  orderBy: { id: 'asc' as const },
                  take: 1,
                  select: {
                    id: true,
                    originalFileName: true,
                    mimeType: true,
                    sizeBytes: true,
                    expiresAt: true,
                  },
                },
              },
            },
          },
        },
      },
    },
  }) as const;

type ChecklistMilestoneRecord = Prisma.MilestoneGetPayload<{
  select: ReturnType<typeof checklistMilestoneSelect>;
}>;

type ChecklistTargetSubmission = NonNullable<
  ChecklistMilestoneRecord['documents'][number]['submissions'][number]
>;

function currentRevisionFile(
  submission: ChecklistTargetSubmission,
): SubmissionFileMetadata | null {
  const currentHistory = submission.histories[0] ?? null;
  if (currentHistory?.revision !== submission.revision) return null;
  const file = currentHistory?.files[0] ?? null;
  if (file === null || file.expiresAt === null) return null;
  return {
    fileId: file.id,
    fileName: file.originalFileName,
    contentType: safeSubmissionFileContentType(file.originalFileName),
    size: file.sizeBytes,
    expiresAt: file.expiresAt,
  };
}
