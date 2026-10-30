import {
  Prisma,
  ApplicationStatus,
  RepositoryConnectionMode,
  MemberKind,
  StaffAccessRequestStatus,
  type ReviewDecision,
  type AffiliationKind,
} from '@prisma/client';
import { programApplicationParticipantWhere } from './program-application-participant.repository';

export function linkedRepositoryFilter(): Prisma.GithubRepositoryWhereInput {
  return {
    OR: [
      { source: 'ORG_PROVISIONED' },
      { source: 'EXTERNAL_PUBLIC', applicationId: { not: null } },
    ],
  };
}

export function repositoryAccessSyncTargetWhere(
  teamId: string,
): Prisma.ApplicationWhereInput {
  return {
    teamId,
    status: ApplicationStatus.APPROVED,
    repositoryConnectionMode: RepositoryConnectionMode.NEW,
    program: { repositoryProvisioningEnabled: true },
  };
}

export type StaffAccessRequestTarget = {
  readonly id: string;
  readonly memberKind: MemberKind;
  readonly hasStaffAccess: boolean;
};

export type StaffAccessRequestOutcome = {
  readonly requestStatus: StaffAccessRequestStatus | null;
};

type StaffAccessRequestTransaction = {
  readonly staffAccessRequest: Pick<
    Prisma.TransactionClient['staffAccessRequest'],
    'findFirst' | 'create'
  >;
};

const NOTHING_REQUESTED: StaffAccessRequestOutcome = { requestStatus: null };

export async function requestStaffAccess(
  transaction: StaffAccessRequestTransaction,
  target: StaffAccessRequestTarget,
): Promise<StaffAccessRequestOutcome> {
  if (target.memberKind !== MemberKind.STAFF || target.hasStaffAccess) {
    return NOTHING_REQUESTED;
  }

  const pending = await transaction.staffAccessRequest.findFirst({
    where: { userId: target.id, status: StaffAccessRequestStatus.PENDING },
  });
  if (pending) {
    return { requestStatus: pending.status };
  }
  const created = await transaction.staffAccessRequest.create({
    data: { userId: target.id },
  });
  return { requestStatus: created.status };
}

type LockedRow = Readonly<{ id: string }>;

type ApplicationCoordinates = Readonly<{ programId: string; teamId: string }>;

export async function lockSubmissionMembership(
  tx: Prisma.TransactionClient,
  applicationId: string,
  userId: string,
): Promise<boolean> {
  const coordinates: ApplicationCoordinates | null =
    await tx.application.findUnique({
      where: { id: applicationId },
      select: { programId: true, teamId: true },
    });
  if (!coordinates) return false;

  const lockedPrograms = await tx.$queryRaw<readonly LockedRow[]>(Prisma.sql`
    SELECT "id" FROM "Program" WHERE "id" = ${coordinates.programId} FOR UPDATE
  `);
  if (lockedPrograms.length === 0) return false;

  const lockedTeams = await tx.$queryRaw<readonly LockedRow[]>(Prisma.sql`
    SELECT "id" FROM "Team" WHERE "id" = ${coordinates.teamId} FOR UPDATE
  `);
  if (lockedTeams.length === 0) return false;

  const current = await tx.application.findFirst({
    where: {
      id: applicationId,
      ...programApplicationParticipantWhere(userId),
    },
    select: { id: true },
  });
  return current !== null;
}

interface SubmissionReviewRecordInput {
  readonly milestoneDocumentSubmissionId: string;
  readonly submissionHistoryId: string;
  readonly reviewerId: string;
  readonly decision: ReviewDecision;
  readonly comment: string | null;
  readonly reviewedAt: Date;
  readonly resubmissionDueAt?: Date | null;
}

interface SubmissionReviewEventInput {
  readonly milestoneDocumentSubmissionId: string;
  readonly revision: number;
  readonly reviewerId: string;
  readonly decision: ReviewDecision;
  readonly comment: string | null;
  readonly reviewedAt: Date;
}

export function appendSubmissionReview<
  TSelect extends Prisma.MilestoneDocumentReviewHistorySelect,
>(
  transaction: Pick<Prisma.TransactionClient, 'milestoneDocumentReviewHistory'>,
  input: SubmissionReviewRecordInput,
  select: TSelect,
) {
  return transaction.milestoneDocumentReviewHistory.create({
    data: {
      milestoneDocumentSubmissionId: input.milestoneDocumentSubmissionId,
      submissionHistoryId: input.submissionHistoryId,
      reviewerId: input.reviewerId,
      decision: input.decision,
      comment: input.comment,
      ...(input.resubmissionDueAt === undefined
        ? {}
        : { resubmissionDueAt: input.resubmissionDueAt }),
      reviewedAt: input.reviewedAt,
    },
    select,
  });
}

export function appendSubmissionReviewEvent(
  transaction: Pick<
    Prisma.TransactionClient,
    'milestoneDocumentSubmissionHistory'
  >,
  input: SubmissionReviewEventInput,
) {
  return transaction.milestoneDocumentSubmissionHistory.create({
    data: {
      milestoneDocumentSubmissionId: input.milestoneDocumentSubmissionId,
      event: input.decision,
      revision: input.revision,
      comment: input.comment,
      actorId: input.reviewerId,
      createdAt: input.reviewedAt,
    },
    select: { id: true },
  });
}

type ProfileTransaction = {
  readonly userProfile: Pick<
    Prisma.TransactionClient['userProfile'],
    'create' | 'update' | 'updateMany' | 'upsert' | 'findUnique'
  >;
};

export type UserProfileWrite = {
  readonly name: string;
  readonly studentId: string | null;
  readonly department: string;
  readonly memberKind: MemberKind;
  readonly affiliationKind: AffiliationKind;
  readonly affiliationName: string;
};

export type UserProfilePatch = {
  readonly name?: string;
  readonly studentId?: string;
  readonly department?: string;
  readonly affiliationKind?: AffiliationKind;
  readonly affiliationName?: string;
};

export type StudentIdFillOutcome = 'filled' | 'conflict' | 'taken';

export async function fillStudentIdIfEmpty(
  transaction: ProfileTransaction,
  userId: string,
  studentId: string,
): Promise<StudentIdFillOutcome> {
  const owner = await transaction.userProfile.findUnique({
    where: { studentId },
    select: { userId: true },
  });
  if (owner !== null) {
    return owner.userId === userId ? 'conflict' : 'taken';
  }

  try {
    const updated = await transaction.userProfile.updateMany({
      where: { userId, studentId: null },
      data: { studentId },
    });
    return updated.count === 1 ? 'filled' : 'conflict';
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return 'taken';
    }
    throw error;
  }
}

export async function upsertUserProfile(
  transaction: ProfileTransaction,
  userId: string,
  profile: UserProfileWrite,
  patch: UserProfilePatch,
): Promise<void> {
  if (Object.keys(patch).length === 0) {
    return;
  }
  await transaction.userProfile.upsert({
    where: { userId },
    update: patch,
    create: { userId, ...profile },
  });
}
