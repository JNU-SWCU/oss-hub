import { Inject, Injectable } from '@nestjs/common';
import {
  ApplicationReviewEventKind,
  ApplicationStatus,
  type Prisma,
} from '@prisma/client';
import {
  USER_PROFILE_NAME_SELECT,
  resolveUserProfileName,
} from '../profiles/user-profile-read';
import { PrismaService } from '../prisma/prisma.service';
import {
  programApplicationManagerWhere,
  programApplicationParticipantWhere,
} from '../programs/program-participant';
import { appendReviewHistory } from './review-history.writer';
import type {
  AppendReviewHistoryInput,
  AppendedReviewHistory,
} from './review-history.writer';

class StudentResubmissionStore {
  constructor(private readonly transaction: Prisma.TransactionClient) {}

  appendReviewHistory(
    input: AppendReviewHistoryInput,
  ): Promise<AppendedReviewHistory> {
    return appendReviewHistory(this.transaction, input);
  }
}

const RESUBMITTABLE_STATUSES: readonly ApplicationStatus[] = [
  ApplicationStatus.SUBMITTED,
  ApplicationStatus.REJECTED,
];

const CANCELLABLE_STATUSES: readonly ApplicationStatus[] = [
  ApplicationStatus.SUBMITTED,
];

export { RESUBMITTABLE_STATUSES, CANCELLABLE_STATUSES };

export interface StudentApplicationPolicy {
  readonly applicationStartAt: Date;
  readonly applicationEndAt: Date;
  readonly applicationTemplateVersion: number;
}

export interface OwnedStudentApplication {
  readonly id: string;
  readonly programId: string;
  readonly status: ApplicationStatus;
  readonly teamId: string | null;

  readonly teamLeaderId: string;

  readonly applicant: {
    readonly id: string;
    readonly name: string | null;
    readonly nickname: string;
  };
  readonly answers: Prisma.JsonValue;
  readonly submittedAt: Date;
  readonly updatedAt: Date;
  readonly isRepositoryPublicationPlanned: boolean;

  readonly rejectionReason: string | null;
}

export interface UpdatePendingApplicationRecord {
  readonly programId: string;
  readonly studentId: string;
  readonly answers: Prisma.InputJsonValue;
  readonly applicationTemplateVersion: number;
}

export interface DeletePendingApplicationRecord {
  readonly programId: string;
  readonly studentId: string;
}

export type StudentApplicationMutationFailure =
  | { readonly kind: 'program-not-found' }
  | { readonly kind: 'application-not-found' }
  | { readonly kind: 'already-decided' }
  | { readonly kind: 'period-closed' }
  | { readonly kind: 'template-version-mismatch' };

export type UpdatePendingApplicationResult =
  | { readonly kind: 'updated'; readonly application: OwnedStudentApplication }
  | StudentApplicationMutationFailure;

export type DeletePendingApplicationResult =
  { readonly kind: 'cancelled' } | StudentApplicationMutationFailure;

const APPLICATION_SELECT = {
  id: true,
  programId: true,
  status: true,
  teamId: true,
  team: { select: { leaderId: true } },
  applicant: {
    select: { id: true, nickname: true, ...USER_PROFILE_NAME_SELECT },
  },
  answers: true,
  submittedAt: true,
  updatedAt: true,
  isRepositoryPublicationPlanned: true,
  rejectionReason: true,
} as const satisfies Prisma.ApplicationSelect;

type ApplicationRow = Prisma.ApplicationGetPayload<{
  readonly select: typeof APPLICATION_SELECT;
}>;

function toOwnedStudentApplication(
  row: ApplicationRow,
): OwnedStudentApplication {
  const { team, ...application } = row;
  return {
    ...application,
    teamLeaderId: team.leaderId,
    applicant: {
      id: row.applicant.id,
      name: resolveUserProfileName(row.applicant),
      nickname: row.applicant.nickname,
    },
  };
}

export const STUDENT_APPLICATION_MANAGEMENT_CLOCK = Symbol(
  'STUDENT_APPLICATION_MANAGEMENT_CLOCK',
);

export type StudentApplicationManagementClock = () => Date;

@Injectable()
export class StudentApplicationManagementRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STUDENT_APPLICATION_MANAGEMENT_CLOCK)
    private readonly clock: StudentApplicationManagementClock = () =>
      new Date(),
  ) {}

  async findOwnedApplication(
    programId: string,
    studentId: string,
  ): Promise<OwnedStudentApplication | null> {
    const row = await this.prisma.application.findFirst({
      where: {
        programId,
        ...programApplicationParticipantWhere(studentId),
      },
      select: APPLICATION_SELECT,
    });
    return row ? toOwnedStudentApplication(row) : null;
  }

  updatePendingApplication(
    input: UpdatePendingApplicationRecord,
  ): Promise<UpdatePendingApplicationResult> {
    return this.prisma.$transaction(async (transaction) => {
      const policy = await this.lockProgram(transaction, input.programId);
      if (!policy) return { kind: 'program-not-found' };
      const application = await this.lockManagedApplication(
        transaction,
        input.programId,
        input.studentId,
      );
      if (!application) return { kind: 'application-not-found' };
      const now = this.clock();
      const failure = this.validateMutation(
        application,
        policy,
        now,
        RESUBMITTABLE_STATUSES,
      );
      if (failure) return failure;
      if (
        input.applicationTemplateVersion !== policy.applicationTemplateVersion
      ) {
        return { kind: 'template-version-mismatch' };
      }

      const resubmitted = application.status === ApplicationStatus.REJECTED;
      const row = await transaction.application.update({
        where: { id: application.id },
        data: {
          answers: input.answers,
          applicationTemplateVersion: policy.applicationTemplateVersion,
          ...(resubmitted
            ? {
                status: ApplicationStatus.SUBMITTED,
                rejectionReason: null,
              }
            : {}),
        },
        select: APPLICATION_SELECT,
      });
      if (resubmitted) {
        await new StudentResubmissionStore(transaction).appendReviewHistory({
          applicationId: application.id,
          eventKind: ApplicationReviewEventKind.RESUBMITTED,
          actorId: input.studentId,
          occurredAt: now,
          rejectionReason: null,
        });
      }
      return { kind: 'updated', application: toOwnedStudentApplication(row) };
    });
  }

  deletePendingApplication(
    input: DeletePendingApplicationRecord,
  ): Promise<DeletePendingApplicationResult> {
    return this.prisma.$transaction(async (transaction) => {
      const policy = await this.lockProgram(transaction, input.programId);
      if (!policy) return { kind: 'program-not-found' };
      const application = await this.lockManagedApplication(
        transaction,
        input.programId,
        input.studentId,
      );
      if (!application) return { kind: 'application-not-found' };
      const failure = this.validateMutation(
        application,
        policy,
        this.clock(),
        CANCELLABLE_STATUSES,
      );
      if (failure) return failure;
      await transaction.application.delete({ where: { id: application.id } });
      return { kind: 'cancelled' };
    });
  }

  private async lockProgram(
    transaction: Prisma.TransactionClient,
    programId: string,
  ): Promise<StudentApplicationPolicy | null> {
    const locked = await transaction.$queryRaw<readonly { id: string }[]>`
      SELECT "id" FROM "Program" WHERE "id" = ${programId} FOR UPDATE
    `;
    if (locked.length === 0) return null;
    return transaction.program.findUnique({
      where: { id: programId },
      select: {
        applicationStartAt: true,
        applicationEndAt: true,
        applicationTemplateVersion: true,
      },
    });
  }

  private async lockManagedApplication(
    transaction: Prisma.TransactionClient,
    programId: string,
    studentId: string,
  ): Promise<OwnedStudentApplication | null> {
    const membership = await transaction.teamMember.findUnique({
      where: { programId_userId: { programId, userId: studentId } },
      select: { teamId: true },
    });
    if (!membership) return null;
    const lockedTeam = await transaction.$queryRaw<readonly { id: string }[]>`
      SELECT "id" FROM "Team" WHERE "id" = ${membership.teamId} FOR UPDATE
    `;
    if (lockedTeam.length === 0) return null;

    const current = await transaction.teamMember.findUnique({
      where: { programId_userId: { programId, userId: studentId } },
      select: { teamId: true, team: { select: { leaderId: true } } },
    });
    if (!current || current.teamId !== membership.teamId) return null;
    if (current.team.leaderId !== studentId) return null;
    const candidate = await transaction.application.findFirst({
      where: {
        programId,
        ...programApplicationManagerWhere(studentId),
      },
      select: { id: true },
    });
    if (!candidate) return null;
    const locked = await transaction.$queryRaw<readonly { id: string }[]>`
      SELECT "id" FROM "Application" WHERE "id" = ${candidate.id} FOR UPDATE
    `;
    if (locked.length === 0) return null;
    const row = await transaction.application.findFirst({
      where: {
        id: candidate.id,
        programId,
        ...programApplicationManagerWhere(studentId),
      },
      select: APPLICATION_SELECT,
    });
    return row ? toOwnedStudentApplication(row) : null;
  }

  private validateMutation(
    application: OwnedStudentApplication,
    policy: StudentApplicationPolicy,
    now: Date,
    allowedStatuses: readonly ApplicationStatus[],
  ): StudentApplicationMutationFailure | null {
    if (!allowedStatuses.includes(application.status)) {
      return { kind: 'already-decided' };
    }
    if (!(policy.applicationStartAt <= now && now <= policy.applicationEndAt)) {
      return { kind: 'period-closed' };
    }
    return null;
  }
}
