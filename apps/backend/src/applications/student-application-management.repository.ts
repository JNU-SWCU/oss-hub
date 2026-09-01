import { Inject, Injectable } from '@nestjs/common';
import { ApplicationStatus, type Prisma } from '@prisma/client';
import {
  USER_PROFILE_NAME_SELECT,
  resolveUserProfileName,
} from '../profiles/user-profile-read';
import { PrismaService } from '../prisma/prisma.service';
import {
  programApplicationManagerWhere,
  programApplicationParticipantWhere,
} from '../programs/program-participant';

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
  /**
   * 팀장의 사용자 id. 개인 신청도 1인 팀의 팀장이 있어(D5) 항상 값이 있다.
   * 신청자와 함께 「이 신청서를 수정·취소할 수 있는 사람」을 정한다(#1083).
   */
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
  /**
   * 교직원이 반려하며 남긴 사유. 반려가 아닌 신청은 `null`이다.
   *
   * ⚠ 읽는 사람은 **본인만이 아니다.** `programApplicationParticipantWhere`가
   * `applicantId | team.leaderId | team.members`로 좁히므로, 팀 신청이면 팀 리더와
   * 팀원 전원이 이 사유를 읽는다. 의도된 범위다 — 판정 알림도 같은 집합에게
   * 나가고(#570), 같은 경로의 `answers`도 원래 팀원에게 열려 있다. 「본인만」으로
   * 좁히려면 알림 수신자와 함께 바꿔야 한다.
   * 쓰기(수정·취소)는 이 범위를 쓰지 않는다 — `programApplicationManagerWhere`로
   * 신청자와 팀장까지만 좁혀 둔다(#1083).
   * 감사 로그·알림·메일에는 담지 않는다(`audit-log/audit-log-metadata.ts`의
   * `APPLICATION_DECISION_AUDIT_*` 주석이 그 결정의 원본).
   */
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
      const failure = this.validateMutation(application, policy, this.clock());
      if (failure) return failure;
      if (
        input.applicationTemplateVersion !== policy.applicationTemplateVersion
      ) {
        return { kind: 'template-version-mismatch' };
      }
      const row = await transaction.application.update({
        where: { id: application.id },
        data: {
          answers: input.answers,
          applicationTemplateVersion: policy.applicationTemplateVersion,
        },
        select: APPLICATION_SELECT,
      });
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
      const failure = this.validateMutation(application, policy, this.clock());
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

  /**
   * 쓰기 대상은 `programApplicationManagerWhere`로 좁힌다 — 읽기 범위를 그대로 쓰면
   * 팀원 아무나 팀 전체의 신청서를 고치거나 하드 삭제할 수 있다(#1083).
   * 권한 밖이면 없는 것과 똑같이 `null`이고, 호출부는 `application-not-found`로 거절한다.
   */
  private async lockManagedApplication(
    transaction: Prisma.TransactionClient,
    programId: string,
    studentId: string,
  ): Promise<OwnedStudentApplication | null> {
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
  ): StudentApplicationMutationFailure | null {
    if (application.status !== ApplicationStatus.SUBMITTED) {
      return { kind: 'already-decided' };
    }
    if (!(policy.applicationStartAt <= now && now <= policy.applicationEndAt)) {
      return { kind: 'period-closed' };
    }
    return null;
  }
}
