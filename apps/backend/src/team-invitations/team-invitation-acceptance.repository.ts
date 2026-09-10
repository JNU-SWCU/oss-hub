import {
  AccountStatus,
  ApplicationStatus,
  MemberKind,
  Prisma,
  RepositoryConnectionMode,
  TeamInvitationStatus,
} from '@prisma/client';
import type { AuditLogTransactionWriter } from '../audit-log/audit-log.repository';
import { repositoryAccessSyncEventData } from '../github/repository-provision-event';
import type { PrismaService } from '../prisma/prisma.service';

export type AcceptInvitationOutcome =
  | { readonly kind: 'not-found' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'not-pending' }
  | { readonly kind: 'already-in-team' }
  | { readonly kind: 'team-full' }
  | { readonly kind: 'invitee-not-eligible' }
  | {
      readonly kind: 'ok';
      readonly teamId: string;
      readonly programId: string;
    };

interface LockedTeamRow {
  readonly id: string;
}

type AccessSyncTx = Pick<
  Prisma.TransactionClient,
  'application' | 'outboxEvent'
>;

/**
 * 합류와 같은 트랜잭션에서 권한 동기화 outbox 이벤트를 예약한다.
 *
 * `programs/repository/program-teams.repository.ts`에 같은 모양의 함수가 있다 —
 * 거기서 import 하지 않는 이유는 `ProgramsModule` ↔ `TeamInvitationsModule`
 * 순환 의존을 만들지 않기 위해서다(같은 파일의 `resolveTeamRepositoryProvisioning`
 * 이 이미 따르는 선례). 페이로드 factory 는 둘 다 같은 순수 모듈을 쓴다.
 *
 * 대상은 「승인된(APPROVED) + 새 저장소 발급(NEW) + 프로그램이 발급을 켜 둔」
 * 신청뿐이고, 그런 신청이 없으면 아무것도 쓰지 않는다(noop).
 */
async function enqueueRepositoryAccessSyncEvents(
  tx: AccessSyncTx,
  teamId: string,
  now: Date,
): Promise<void> {
  const applications = await tx.application.findMany({
    where: {
      teamId,
      status: ApplicationStatus.APPROVED,
      repositoryConnectionMode: RepositoryConnectionMode.NEW,
      program: { repositoryProvisioningEnabled: true },
    },
    select: { id: true },
  });
  if (applications.length === 0) return;
  await tx.outboxEvent.createMany({
    data: applications.map((application) =>
      repositoryAccessSyncEventData(application.id, teamId, now),
    ),
    skipDuplicates: true,
  });
}

interface LockedUserRow {
  readonly id: string;
}

export type AcceptInvitationOkContext = {
  readonly teamId: string;
  readonly programId: string;
  readonly teamName: string;
  readonly programName: string;
};

export type AcceptInvitationOkStore = {
  readonly auditLogWriter: AuditLogTransactionWriter;
};

export type AcceptInvitationOnOk = (
  store: AcceptInvitationOkStore,
  names: AcceptInvitationOkContext,
) => Promise<void>;

/**
 * 팀 행 잠금부터 초대 CAS와 멤버 생성까지 한 트랜잭션에서 수행한다.
 * 잠금 순서는 Team → User로 고정한다. Team은 정원·팀장 승계 경합을,
 * User는 수락과 역할 변경·비활성화 경합을 직렬화한다.
 *
 * 신청 제출 여부는 더 이상 보지 않는다. 신청 기간은 초기 신청 창구일 뿐
 * 참여 중 팀 구성을 잠그는 게이트가 아니다(탈퇴·제외와 같은 판단).
 *
 * 팀장은 이 트랜잭션에서 절대 바뀌지 않는다 — `Team.leaderId`를 쓰지 않으며
 * 새로 만드는 `TeamMember`에는 팀장 표식이 없다. 합류는 오직 일반 구성원이다.
 */
export async function acceptTeamInvitationTransaction(
  prisma: PrismaService,
  invitationId: string,
  inviteeId: string,
  now: Date,
  onOk?: AcceptInvitationOnOk,
): Promise<AcceptInvitationOutcome> {
  const acceptance = prisma.$transaction<AcceptInvitationOutcome>(
    async (tx) => {
      const invitation = await tx.teamInvitation.findUnique({
        where: { id: invitationId },
        select: {
          id: true,
          teamId: true,
          programId: true,
          inviteeId: true,
          team: {
            select: {
              name: true,
              program: { select: { teamMaxSize: true, name: true } },
            },
          },
        },
      });
      if (!invitation) return { kind: 'not-found' };
      if (invitation.inviteeId !== inviteeId) return { kind: 'forbidden' };

      await tx.$queryRaw<LockedTeamRow[]>(
        Prisma.sql`SELECT "id" FROM "Team" WHERE "id" = ${invitation.teamId} FOR UPDATE`,
      );

      // 잠근 뒤에만 판정한다 — 잠금 전 스냅샷은 동시 응답·탈퇴·제외와 어긋날 수 있다.
      const currentInvitation = await tx.teamInvitation.findUnique({
        where: { id: invitationId },
        select: { status: true },
      });
      // `teamId`·`programId`·`inviteeId`는 갱신되지 않는 열이라 잠금 전 스냅샷을
      // 그대로 쓴다. 바뀔 수 있는 상태·자격·소속·인원만 잠금 뒤에 다시 읽는다.
      if (!currentInvitation) return { kind: 'not-found' };
      if (currentInvitation.status !== TeamInvitationStatus.PENDING) {
        return { kind: 'not-pending' };
      }

      const teamId = invitation.teamId;
      const programId = invitation.programId;

      await tx.$queryRaw<readonly LockedUserRow[]>(
        Prisma.sql`SELECT "id" FROM "User" WHERE "id" = ${inviteeId} FOR UPDATE`,
      );
      const invitee = await tx.user.findUnique({
        where: { id: inviteeId },
        select: {
          id: true,
          accountStatus: true,
          profile: { select: { memberKind: true } },
        },
      });
      if (
        !invitee ||
        invitee.profile?.memberKind !== MemberKind.STUDENT ||
        invitee.accountStatus !== AccountStatus.ACTIVE
      ) {
        return { kind: 'invitee-not-eligible' };
      }

      const existingMembership = await tx.teamMember.findUnique({
        where: { programId_userId: { programId, userId: inviteeId } },
        select: { userId: true },
      });
      if (existingMembership) return { kind: 'already-in-team' };

      const maxSize = invitation.team.program.teamMaxSize;
      const memberCount = await tx.teamMember.count({ where: { teamId } });
      if (memberCount >= maxSize) return { kind: 'team-full' };

      const updated = await tx.teamInvitation.updateMany({
        where: { id: invitationId, status: TeamInvitationStatus.PENDING },
        data: { status: TeamInvitationStatus.ACCEPTED, respondedAt: now },
      });
      if (updated.count === 0) return { kind: 'not-pending' };

      await tx.teamMember.create({
        data: { teamId, programId, userId: inviteeId },
      });

      // 같은 프로그램의 남은 대기 초대는 여기서 함께 종결한다. 합류한 사람은
      // `@@unique([programId,userId])` 때문에 다른 팀 초대를 수락할 수 없는데,
      // 남겨 두면 받은 초대 목록에서 계속 눌러 볼 수 있는 초대로 보인다.
      // 다른 팀의 Team 행은 잠그지 않는다 — 그쪽의 동시 수락은 같은 unique
      // 제약이 막고, 여기서는 표시 상태만 정리한다.
      await tx.teamInvitation.updateMany({
        where: {
          programId,
          inviteeId,
          status: TeamInvitationStatus.PENDING,
          id: { not: invitationId },
        },
        data: { status: TeamInvitationStatus.DECLINED, respondedAt: now },
      });

      // 외부 GitHub collaborator 초대는 outbox 이벤트로만 예약한다 — 실제 GitHub
      // 호출·job 행 잠금은 worker 몫이고 이 트랜잭션 안에서는 아무것도 하지 않는다.
      // 감사 기록(`onOk`)과 같은 트랜잭션이므로 둘 중 하나만 남는 상태는 없다.
      await enqueueRepositoryAccessSyncEvents(tx, teamId, now);

      if (onOk) {
        await onOk(
          { auditLogWriter: tx },
          {
            teamId,
            programId,
            teamName: invitation.team.name,
            programName: invitation.team.program.name,
          },
        );
      }

      return { kind: 'ok', teamId, programId };
    },
  );
  try {
    return await acceptance;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return { kind: 'already-in-team' };
    }
    throw error;
  }
}
