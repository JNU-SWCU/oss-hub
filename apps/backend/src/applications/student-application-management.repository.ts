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

/**
 * 학생 재제출 트랜잭션이 쓰는 store.
 *
 * 판정(`ApplicationsTransactionStore`)·생성(`ApplicationCreateStore`)과 같은 모양으로
 * 이력 writer를 **자기 트랜잭션 client로** 엽는다. 세 진입점이 같은 writer를 같은
 * 방식으로 쓰면 「상태 변경과 같은 트랜잭션에서만 append한다」는 계약이 경로마다
 * 갈라질 수 없다.
 */
class StudentResubmissionStore {
  constructor(private readonly transaction: Prisma.TransactionClient) {}

  appendReviewHistory(
    input: AppendReviewHistoryInput,
  ): Promise<AppendedReviewHistory> {
    return appendReviewHistory(this.transaction, input);
  }
}

/**
 * 학생이 직접 고쳐 다시 낼 수 있는 상태. **허용 집합을 그대로 적는다** —
 * `!== APPROVED` 같은 부정형을 쓰지 않는다. 부정형은 상태가 하나 늘어날 때마다
 * 조용히 그 새 상태를 허용해 버린다.
 */
const RESUBMITTABLE_STATUSES: readonly ApplicationStatus[] = [
  ApplicationStatus.SUBMITTED,
  ApplicationStatus.REJECTED,
];

/** 신청 취소는 아직 판정 전인 것만 허용한다 — 명세가 재제출만 확장했다(R-1). */
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
  /**
   * 팀장의 사용자 id. 개인 신청도 1인 팀의 팀장이 있어(D5) 항상 값이 있다.
   * 「이 신청서를 수정·취소할 수 있는 사람」은 이 값 **하나로** 정해진다(#1083).
   * 신청자 id는 여기에 관여하지 않는다 — 아래 `applicant` 주석을 보라.
   */
  readonly teamLeaderId: string;
  /**
   * 신청서를 **처음 낸 사람**. 답변의 `applicantName`과 화면 표시를 위한 기록이며
   * 권한이 아니다. 신청 뒤 탈퇴·제외·팀장 승계가 일어나도 이 값은 옮기지 않는다 —
   * 옮기면 과거 제출 귀속이 뒤바뀐다. 「지금 무엇을 할 수 있는가」는 언제나
   * 현재 `TeamMember`/`Team.leaderId`가 답한다.
   */
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
   * 현재 `team.members`로 좁히므로, 팀 신청이면 지금 그 팀에 속한 사람 전원이 이 사유를
   * 읽는다. 의도된 범위다 — 판정 알림도 같은 집합에게 나가고(#570), 같은 경로의
   * `answers`도 팀원에게 열려 있다. 「본인만」으로 좁히려면 알림 수신자와 함께 바꿔야 한다.
   * 반대로 팀을 **떠난 사람**은 원 신청자였더라도 더는 읽지 못한다 — 신청자 기록은
   * 권한이 아니기 때문이다.
   * 쓰기(수정·취소)는 이 범위를 쓰지 않는다 — `programApplicationManagerWhere`로
   * 현재 팀장까지만 좁혀 둔다(#1083).
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

  /**
   * 지금 그 팀에 속한 사람에게만 신청서를 돌려준다. 팀을 떠난 사람은 그가 원 신청자였더라도
   * `null`이다 — `applicantId`는 어느 시점의 기록일 뿐 현재 권한이 아니다.
   * 서비스가 「팀장인가」를 이 결과의 `teamLeaderId`로 판정하므로, 멤버십 밖의 행이
   * 여기서 새면 이미 떠난 사람이 관리자로 보이게 된다.
   */
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
      // 반려된 신청을 고쳐 내는 것은 「재제출」이다 — 검토대기로 돌아가고
      // 지난 반려 사유는 뜨지 않는다. 사유를 남기면 검토대기 신청이 반려 문구를
      // 지고 있게 되어 화면이 모순된다. 「그때 무엇을 지적받았는가」는 판정 이력에
      // 남아 있다(`ApplicationReviewHistory.rejectionReason`).
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

  /**
   * 쓰기 대상은 `programApplicationManagerWhere`로 좁힌다 — 읽기 범위를 그대로 쓰면
   * 팀원 아무나 팀 전체의 신청서를 고치거나 하드 삭제할 수 있다(#1083).
   * 권한 밖이면 없는 것과 똑같이 `null`이고, 호출부는 `application-not-found`로 거절한다.
   *
   * **잠금 순서는 `Program` → `Team` → `Application`이다.** 신청 생성·초대 수락·탈퇴·제외가
   * 모두 `Team` 행을 `FOR UPDATE`로 잡고 소속을 바꾼다. 이 경로가 그 전에 `Application`을
   * 먼저 잡으면 순서가 갈라 교착이 되고, 팀 행을 아예 잡지 않으면 「내가 팀장임」을 본 뒤
   * 신청서 잠금을 기다리는 사이에 승계·제외가 커밋되어 **이미 팀장이 아닌 사람**이 씁다.
   * 그래서 팀을 잡은 뒤에야 소속과 팀장을 다시 읽는다.
   */
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
    // 잠금 앞 스냅샷은 믿지 않는다 — 기다리는 동안 탈퇴·제외·승계가 커밋될 수 있다.
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
