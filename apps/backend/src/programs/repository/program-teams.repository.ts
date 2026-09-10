import { Injectable } from '@nestjs/common';
import {
  AccountStatus,
  ApplicationStatus,
  MilestoneDocumentKind,
  OutboxEventStatus,
  Prisma,
  RepositoryConnectionMode,
  RepositoryProvisionJobStatus,
  type ProgramCategory,
} from '@prisma/client';
import type { AuditLogTransactionWriter } from '../../audit-log/audit-log.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { requiredMilestonesApproved } from '../../common/milestone-completion';
import { publishBlockedReasons } from '../../common/repository-publication';
import { repositoryUrlFromNameWithOwner } from '../../github/repository-identity';
import { repositoryAccessSyncEventData } from '../../github/repository-provision-event';
import {
  projectSubmissionCompletionTargets,
  submissionCompletionTargetSelect,
} from '../../submissions/submission-completion-projection';
import {
  STUDENT_MEMBER_WHERE,
  USER_PROFILE_NAME_SELECT,
  resolveUserProfileName,
} from '../../profiles/user-profile-read';
import type {
  TeamApplicationView,
  TeamRepositoryProvisioningJobStatus,
  TeamRepositoryProvisioningSafeErrorClass,
} from '../program-teams.types';

export interface TeamStudentActor {
  readonly id: string;
  readonly name: string | null;
  readonly nickname: string;
}

export interface TeamProgramRecord {
  readonly id: string;
  readonly name: string;
  readonly category: ProgramCategory;
  readonly applicationStartAt: Date;
  readonly applicationEndAt: Date;
  readonly teamMinSize: number;
  readonly teamMaxSize: number;
}

export interface TeamMembershipRecord {
  readonly teamId: string;
  readonly userId: string;
}

export interface CreateTeamRecordInput {
  readonly programId: string;
  readonly name: string;
  readonly joinCodeDigest: string;
  readonly leaderId: string;
}

export interface CreatedTeamRecord {
  readonly id: string;
  readonly name: string;
}

export interface TeamDetailRecord {
  readonly id: string;
  readonly name: string;
  readonly leaderId: string;
  readonly programId: string;
  readonly teamMinSize: number;
  readonly teamMaxSize: number;
  readonly hasApplication: boolean;
  readonly members: readonly {
    readonly userId: string;
    readonly nickname: string;
    readonly name: string | null;
  }[];
}

/**
 * 교직원 전용 팀 목록의 한 팀. 멤버 실명(`name`)을 포함하므로 학생도 쓰는 공개 로스터
 * (`program-overview`의 `listPublicTeams`)와 절대 섞지 않는다 — 그쪽은 nickname 만
 * 준다는 계약을 그대로 유지한다.
 */
export interface StaffTeamRecord {
  readonly id: string;
  readonly name: string;
  readonly leaderId: string;
  readonly members: readonly {
    readonly userId: string;
    readonly nickname: string;
    readonly name: string | null;
  }[];
}

/**
 * 교직원 전용 팀 상세(#874)의 한 팀 — `StaffTeamRecord`에 신청·저장소 발급 상태를
 * 더한 모양이다. 신청이 없으면 `application: null`.
 */
export interface StaffTeamDetailRecord {
  readonly id: string;
  readonly name: string;
  readonly leaderId: string;
  readonly members: readonly {
    readonly userId: string;
    readonly nickname: string;
    readonly name: string | null;
  }[];
  readonly application: TeamApplicationView | null;
}

export class TeamMembershipConflictError extends Error {
  override readonly name = 'TeamMembershipConflictError';
}

export class JoinCodeDigestConflictError extends Error {
  override readonly name = 'JoinCodeDigestConflictError';
}

/**
 * 탈퇴 결과. 실패 결과(`not-found`, `last-member-with-application`)는 아무것도 쓰지
 * 않고 audit 도 남기지 않는다.
 */
export type TeamLeaveResult =
  'removed' | 'not-found' | 'last-member-with-application';

/**
 * 팀장의 팀원 제외 결과. `actor-not-in-team`·`target-not-found` 는 다른 팀/없는 팀원을
 * 구분하지 않는 같은 404 로 흘러간다.
 */
export type TeamRemoveMemberResult =
  | 'removed'
  | 'actor-not-in-team'
  | 'not-leader'
  | 'self-target'
  | 'target-not-found';

export type TeamMembershipOperation = 'LEAVE' | 'REMOVE';

/**
 * 멤버십 변경 감사에 필요한 사실 — 팀 행을 잠근 뒤 읽은 값만 담는다.
 * 팀이 통째로 삭제되는 마지막 1인 탈퇴에서만 `nextLeaderId` 가 null 이다.
 */
export interface TeamMembershipAuditEvent {
  readonly teamId: string;
  readonly programName: string;
  readonly teamName: string;
  readonly operation: TeamMembershipOperation;
  readonly removedUserId: string;
  readonly previousLeaderId: string;
  readonly nextLeaderId: string | null;
}

export interface TeamMembershipAuditStore {
  readonly auditLogWriter: AuditLogTransactionWriter;
}

/**
 * 멤버십 변경과 같은 트랜잭션에서 감사 기록을 남기는 필수 콜백. 콜백이 던지면
 * 멤버 삭제·팀장 승계까지 함께 롤백된다(Prisma 도 여기서 예외를 그대로 올린다).
 */
export type RecordTeamMembershipAudit = (
  store: TeamMembershipAuditStore,
  event: TeamMembershipAuditEvent,
) => Promise<void>;

export interface ProgramTeamsCreateStore {
  readonly auditLogWriter: AuditLogTransactionWriter;
  findMembershipByProgramUser(
    programId: string,
    userId: string,
  ): Promise<TeamMembershipRecord | null>;
  createTeamWithLeader(
    input: CreateTeamRecordInput,
  ): Promise<CreatedTeamRecord>;
}

@Injectable()
export class ProgramTeamsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findActiveStudentByGithubId(
    githubId: bigint,
  ): Promise<TeamStudentActor | null> {
    const user = await this.prisma.user.findFirst({
      where: {
        githubId,
        accountStatus: AccountStatus.ACTIVE,
        ...STUDENT_MEMBER_WHERE,
      },
      select: {
        id: true,
        nickname: true,
        ...USER_PROFILE_NAME_SELECT,
      },
    });
    return user
      ? {
          id: user.id,
          nickname: user.nickname,
          name: resolveUserProfileName(user),
        }
      : null;
  }

  findProgramById(programId: string): Promise<TeamProgramRecord | null> {
    return this.prisma.program.findUnique({
      where: { id: programId },
      select: {
        id: true,
        name: true,
        category: true,
        applicationStartAt: true,
        applicationEndAt: true,
        teamMinSize: true,
        teamMaxSize: true,
      },
    });
  }

  async findTeamDetailForUser(
    programId: string,
    userId: string,
  ): Promise<TeamDetailRecord | null> {
    const membership = await this.prisma.teamMember.findUnique({
      where: {
        programId_userId: { programId, userId },
      },
      select: {
        team: {
          select: {
            id: true,
            name: true,
            leaderId: true,
            programId: true,
            program: {
              select: { teamMinSize: true, teamMaxSize: true },
            },
            applications: { select: { id: true }, take: 1 },
            members: {
              select: {
                userId: true,
                user: {
                  select: {
                    nickname: true,
                    ...USER_PROFILE_NAME_SELECT,
                  },
                },
              },
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            },
          },
        },
      },
    });
    if (!membership) return null;
    const team = membership.team;
    return {
      id: team.id,
      name: team.name,
      leaderId: team.leaderId,
      programId: team.programId,
      teamMinSize: team.program.teamMinSize,
      teamMaxSize: team.program.teamMaxSize,
      hasApplication: team.applications.length > 0,
      members: team.members.map((member) => ({
        userId: member.userId,
        nickname: member.user.nickname,
        name: resolveUserProfileName(member.user),
      })),
    };
  }

  /**
   * 교직원 전용 팀 목록 — 명시적 select 만 쓰고 팀명·팀장·멤버(실명·nickname)만 읽는다.
   * 참여코드(`joinCodeDigest`)·저장소(`repositories`)·`TeamMember`의 학과/연락처/이메일·
   * `User.studentId` 는 이 select 에 절대 포함하지 않는다.
   *
   * 실명은 `USER_PROFILE_NAME_SELECT` + `resolveUserProfileName()` 로만 읽는다
   * (`UserProfile.name` 과 legacy `User.name` 을 합치는 정식 경로). `TeamMember.name` 은
   * 스키마 주석과 달리 아무 writer 도 채우지 않아 항상 null 이므로 쓰지 않는다.
   *
   * 정렬은 팀 `createdAt` 오름차순이고 멤버도 `createdAt` 오름차순이다(팀장을 맨 앞으로
   * 끌어올리는 것은 service 가 한다).
   */
  async listStaffTeams(programId: string): Promise<StaffTeamRecord[]> {
    const teams = await this.prisma.team.findMany({
      where: { programId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        leaderId: true,
        members: {
          select: {
            userId: true,
            user: {
              select: {
                nickname: true,
                ...USER_PROFILE_NAME_SELECT,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    return teams.map((team) => ({
      id: team.id,
      name: team.name,
      leaderId: team.leaderId,
      members: team.members.map((member) => ({
        userId: member.userId,
        nickname: member.user.nickname,
        name: resolveUserProfileName(member.user),
      })),
    }));
  }

  /**
   * 교직원 전용 팀 상세(#874) — `listStaffTeams`와 같은 select 원칙(참여코드·저장소·
   * 학과/연락처/이메일·studentId 금지)에 신청·저장소 발급 상태를 더한다.
   *
   * 저장소는 `Application`을 거쳐서만 읽는다 — `GithubRepository.applicationId`는
   * unique라 빠짐이 없지만, `GithubRepository.teamId`는 nullable이라
   * `Team.repositories`로 조회하면 저장소가 실제로 있는데도 못 찾는 행이 생긴다.
   * `programId`까지 함께 걸어 다른 프로그램의 teamId 는 애초에 조회되지 않게
   * 한다(404 로 흘러간다).
   */
  async findStaffTeamDetail(
    programId: string,
    teamId: string,
  ): Promise<StaffTeamDetailRecord | null> {
    const team = await this.prisma.team.findFirst({
      where: { id: teamId, programId },
      select: {
        id: true,
        name: true,
        leaderId: true,
        members: {
          select: {
            userId: true,
            user: {
              select: {
                nickname: true,
                ...USER_PROFILE_NAME_SELECT,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!team) return null;

    const application = await this.prisma.application.findFirst({
      where: { programId, teamId },
      select: {
        id: true,
        status: true,
        updatedAt: true,
        repositoryConnectionMode: true,
        isRepositoryPublicationPlanned: true,
        // GithubRepository는 name/url 컬럼을 두지 않는다(#617 단계 D) —
        // nameWithOwner에서 repository-identity.ts 헬퍼로 url을 유도한다.
        repository: {
          select: { id: true, nameWithOwner: true, visibility: true },
        },
        program: {
          select: {
            repositoryProvisioningEnabled: true,
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
          select: submissionCompletionTargetSelect,
        },
      },
    });

    let applicationView: TeamApplicationView | null = null;
    if (application) {
      const [outbox, job] = await Promise.all([
        this.prisma.outboxEvent.findUnique({
          where: { idempotencyKey: `repository-provision:${application.id}` },
          select: { status: true, createdAt: true },
        }),
        this.prisma.repositoryProvisionJob.findUnique({
          where: { applicationId: application.id },
          select: {
            status: true,
            updatedAt: true,
            lastErrorCode: true,
            repositoryId: true,
          },
        }),
      ]);
      const repository = application.repository;
      const completionTargets = projectSubmissionCompletionTargets(
        application.milestoneDocumentSubmissions,
      );
      const blockedReasons = repository
        ? publishBlockedReasons(
            {
              visibility: repository.visibility,
              provisionStatus:
                job?.repositoryId === repository.id ? job.status : null,
              requiredMilestonesApproved: requiredMilestonesApproved(
                application.program.milestones,
                completionTargets.submissions,
                completionTargets.documentSubmissions,
              ),
              isRepositoryPublicationPlanned:
                application.isRepositoryPublicationPlanned,
              programEndAt: application.program.endAt,
            },
            new Date(),
          )
        : [];
      applicationView = {
        id: application.id,
        status: application.status,
        repositoryConnectionMode: application.repositoryConnectionMode,
        repository: repository
          ? {
              id: repository.id,
              url: repositoryUrlFromNameWithOwner(repository.nameWithOwner),
              visibility: repository.visibility,
              publishEligible: blockedReasons.length === 0,
              blockedReasons,
            }
          : null,
        repositoryProvisioning: resolveTeamRepositoryProvisioning(
          application.status,
          application.program.repositoryProvisioningEnabled,
          application.updatedAt,
          outbox ?? undefined,
          job ?? undefined,
        ),
      };
    }

    return {
      id: team.id,
      name: team.name,
      leaderId: team.leaderId,
      members: team.members.map((member) => ({
        userId: member.userId,
        nickname: member.user.nickname,
        name: resolveUserProfileName(member.user),
      })),
      application: applicationView,
    };
  }

  withCreateTransaction<T>(
    operation: (store: ProgramTeamsCreateStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((tx) =>
      operation(new PrismaProgramTeamsCreateStore(tx)),
    );
  }

  /**
   * 본인 탈퇴 — 신청 제출 여부나 신청 기간과 무관하게 허용한다. 유일한 제약은
   * "신청 기록이 있는 팀의 마지막 구성원"이며 이때만 409로 막아 신청·제출·저장소의
   * 소유 팀을 남긴다(`Application`은 절대 지우거나 옮기지 않는다).
   *
   * 잠금 순서는 초대 수락(`acceptTeamInvitationTransaction`)과 같은 Team 행
   * `FOR UPDATE`가 먼저다. 잠금 전 스냅샷은 동시 수락/제출/탈퇴와 어긋날 수 있으므로
   * 소속·팀장·인원·신청은 잠근 뒤에만 판정한다.
   */
  async leave(
    programId: string,
    userId: string,
    recordAudit: RecordTeamMembershipAudit,
  ): Promise<TeamLeaveResult> {
    return this.prisma.$transaction(async (tx) => {
      const membership = await tx.teamMember.findUnique({
        where: { programId_userId: { programId, userId } },
        select: { teamId: true },
      });
      if (!membership) return 'not-found';

      await lockTeamRow(tx, membership.teamId);

      const lockedMembership = await tx.teamMember.findUnique({
        where: { programId_userId: { programId, userId } },
        select: TEAM_MEMBERSHIP_CONTEXT_SELECT,
      });
      if (!lockedMembership || lockedMembership.teamId !== membership.teamId) {
        return 'not-found';
      }

      const now = new Date();
      const teamId = lockedMembership.teamId;
      const previousLeaderId = lockedMembership.team.leaderId;
      const [memberCount, application] = await Promise.all([
        tx.teamMember.count({ where: { teamId } }),
        tx.application.findFirst({ where: { teamId }, select: { id: true } }),
      ]);

      if (memberCount <= 1) {
        if (application !== null) return 'last-member-with-application';
        // 미제출 1인 팀만 팀 자체가 사라진다. 대기 초대를 먼저 지워야 팀 삭제가
        // composite FK에 막히지 않는다.
        await tx.teamMember.delete({
          where: { teamId_userId: { teamId, userId } },
        });
        await tx.teamInvitation.deleteMany({ where: { teamId, programId } });
        await tx.team.delete({ where: { id: teamId } });
        await recordAudit(
          { auditLogWriter: tx },
          membershipAuditEvent(lockedMembership, {
            operation: 'LEAVE',
            removedUserId: userId,
            previousLeaderId,
            nextLeaderId: null,
          }),
        );
        return 'removed';
      }

      let nextLeaderId = previousLeaderId;
      if (previousLeaderId === userId) {
        // 결정적 승계: 남은 팀원 중 가장 먼저 합류한 사람, 동시 합류는 id 오름차순.
        const successor = await tx.teamMember.findFirst({
          where: { teamId, userId: { not: userId } },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { userId: true },
        });
        if (!successor) {
          throw new Error(
            'team member count and roster disagree inside the team lock',
          );
        }
        nextLeaderId = successor.userId;
        // 팀장 이관이 본인 멤버 행 삭제보다 먼저다 — 반대 순서면 `Team.leaderId`가
        // 잠깐 팀에 없는 사용자를 가리킨다.
        await tx.team.update({
          where: { id: teamId },
          data: { leaderId: nextLeaderId },
        });
      }

      await tx.teamMember.delete({
        where: { teamId_userId: { teamId, userId } },
      });
      // 외부 GitHub collaborator 회수는 outbox 이벤트로만 예약한다 — 실제 GitHub
      // 호출·job 행 잠금은 worker 몫이고 이 트랜잭션 안에서는 아무것도 하지 않는다.
      await enqueueRepositoryAccessSyncEvents(tx, teamId, now);
      await recordAudit(
        { auditLogWriter: tx },
        membershipAuditEvent(lockedMembership, {
          operation: 'LEAVE',
          removedUserId: userId,
          previousLeaderId,
          nextLeaderId,
        }),
      );
      return 'removed';
    });
  }

  /**
   * 팀장의 팀원 제외 — 팀장만, 그리고 본인이 아닌 다른 현재 구성원만 제외할 수 있다.
   * 본인 대상은 탈퇴(승계 규칙 포함)가 처리하므로 여기서 거절한다.
   *
   * `leave`와 같은 Team 행 `FOR UPDATE` → 행위자 소속·팀장 재조회 → 대상 재조회
   * 순서를 지켜 초대 수락·동시 탈퇴와 직렬화한다.
   */
  async removeMember(
    programId: string,
    actorUserId: string,
    targetUserId: string,
    recordAudit: RecordTeamMembershipAudit,
  ): Promise<TeamRemoveMemberResult> {
    return this.prisma.$transaction(async (tx) => {
      const actorMembership = await tx.teamMember.findUnique({
        where: { programId_userId: { programId, userId: actorUserId } },
        select: { teamId: true },
      });
      if (!actorMembership) return 'actor-not-in-team';

      await lockTeamRow(tx, actorMembership.teamId);

      const lockedActor = await tx.teamMember.findUnique({
        where: { programId_userId: { programId, userId: actorUserId } },
        select: TEAM_MEMBERSHIP_CONTEXT_SELECT,
      });
      if (!lockedActor || lockedActor.teamId !== actorMembership.teamId) {
        return 'actor-not-in-team';
      }

      const now = new Date();
      const teamId = lockedActor.teamId;
      const leaderId = lockedActor.team.leaderId;
      // 권한을 먼저 본다 — 팀장이 아닌 사람에게는 대상의 존재 여부를 알리지 않는다.
      if (leaderId !== actorUserId) return 'not-leader';
      if (targetUserId === actorUserId) return 'self-target';

      const targetMembership = await tx.teamMember.findUnique({
        where: { programId_userId: { programId, userId: targetUserId } },
        select: { teamId: true },
      });
      if (!targetMembership || targetMembership.teamId !== teamId) {
        return 'target-not-found';
      }

      await tx.teamMember.delete({
        where: { teamId_userId: { teamId, userId: targetUserId } },
      });
      // 외부 GitHub collaborator 회수는 outbox 이벤트로만 예약한다 — 실제 GitHub
      // 호출·job 행 잠금은 worker 몫이고 이 트랜잭션 안에서는 아무것도 하지 않는다.
      await enqueueRepositoryAccessSyncEvents(tx, teamId, now);
      await recordAudit(
        { auditLogWriter: tx },
        membershipAuditEvent(lockedActor, {
          operation: 'REMOVE',
          removedUserId: targetUserId,
          previousLeaderId: leaderId,
          nextLeaderId: leaderId,
        }),
      );
      return 'removed';
    });
  }
}

const TEAM_MEMBERSHIP_CONTEXT_SELECT = {
  teamId: true,
  team: {
    select: {
      leaderId: true,
      name: true,
      program: { select: { name: true } },
    },
  },
} as const;

interface TeamMembershipContext {
  readonly teamId: string;
  readonly team: {
    readonly leaderId: string;
    readonly name: string;
    readonly program: { readonly name: string };
  };
}

function membershipAuditEvent(
  context: TeamMembershipContext,
  change: Omit<TeamMembershipAuditEvent, 'teamId' | 'programName' | 'teamName'>,
): TeamMembershipAuditEvent {
  return {
    teamId: context.teamId,
    programName: context.team.program.name,
    teamName: context.team.name,
    ...change,
  };
}

type AccessSyncTx = Pick<
  Prisma.TransactionClient,
  'application' | 'outboxEvent'
>;

/**
 * 구성원 변경과 같은 트랜잭션에서 권한 동기화 outbox 이벤트를 예약한다.
 *
 * 대상은 「승인된(APPROVED) + 새 저장소 발급(NEW) + 프로그램이 발급을 켜 둔」
 * 신청뿐이다. 미승인·OWN 연결·발급 꺼진 프로그램은 우리가 권한을 쓰는 저장소가
 * 아니므로 이벤트를 만들지 않는다. 대상이 없으면 쓰기도 없다(noop).
 *
 * 페이로드는 `github/repository-provision-event.ts`의 순수 factory 만 쓴다 —
 * 이 트랜잭션은 GitHub 를 부르지 않고 provision job 행도 잠그지 않는다.
 * 같은 ms 에 들어온 중복은 `skipDuplicates` 로 접는다 — worker 가 처리 시점의
 * 현재 구성원을 다시 읽으므로 한 번의 동기화가 그 순간의 변경을 모두 덮는다.
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

function lockTeamRow(
  tx: Pick<Prisma.TransactionClient, '$queryRaw'>,
  teamId: string,
): Promise<LockedTeamRow[]> {
  return tx.$queryRaw<LockedTeamRow[]>(
    Prisma.sql`SELECT "id" FROM "Team" WHERE "id" = ${teamId} FOR UPDATE`,
  );
}

type TeamsTx = Pick<
  Prisma.TransactionClient,
  'team' | 'teamMember' | 'auditLog'
>;

interface LockedTeamRow {
  readonly id: string;
}

class PrismaProgramTeamsCreateStore implements ProgramTeamsCreateStore {
  constructor(private readonly tx: TeamsTx) {}

  get auditLogWriter(): AuditLogTransactionWriter {
    return this.tx;
  }

  async findMembershipByProgramUser(
    programId: string,
    userId: string,
  ): Promise<TeamMembershipRecord | null> {
    const row = await this.tx.teamMember.findUnique({
      where: { programId_userId: { programId, userId } },
      select: { teamId: true, userId: true },
    });
    return row;
  }

  async createTeamWithLeader(
    input: CreateTeamRecordInput,
  ): Promise<CreatedTeamRecord> {
    try {
      const team = await this.tx.team.create({
        data: {
          programId: input.programId,
          name: input.name,
          joinCodeDigest: input.joinCodeDigest,
          leaderId: input.leaderId,
        },
        select: { id: true, name: true },
      });
      await this.tx.teamMember.create({
        data: {
          teamId: team.id,
          programId: input.programId,
          userId: input.leaderId,
        },
      });
      return team;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const target = error.meta?.target;
        const fields = Array.isArray(target)
          ? target.map(String)
          : typeof target === 'string'
            ? [target]
            : [];
        if (fields.some((field) => field.includes('joinCodeDigest'))) {
          throw new JoinCodeDigestConflictError();
        }
        throw new TeamMembershipConflictError();
      }
      throw error;
    }
  }
}

interface TeamProvisionOutbox {
  readonly status: OutboxEventStatus;
  readonly createdAt: Date;
}

interface TeamProvisionJob {
  readonly status: RepositoryProvisionJobStatus;
  readonly updatedAt: Date;
  readonly lastErrorCode: string | null;
}

/**
 * `applications.repository.ts`의 `resolveRepositoryProvisioning`을 로컬로 다시 구현한
 * 것이다. import 하지 않는 이유는 파일 상단 주석과 같다(`ApplicationsModule` ↔
 * `ProgramsModule` 순환 의존).
 */
function resolveTeamRepositoryProvisioning(
  applicationStatus: ApplicationStatus,
  enabled: boolean,
  applicationUpdatedAt: Date,
  outbox: TeamProvisionOutbox | undefined,
  job: TeamProvisionJob | undefined,
): TeamApplicationView['repositoryProvisioning'] {
  const anomalous = (): TeamApplicationView['repositoryProvisioning'] => ({
    enabled,
    jobStatus: 'ANOMALOUS',
    updatedAt: applicationUpdatedAt,
    safeErrorClass: 'UNKNOWN',
  });
  if (applicationStatus !== ApplicationStatus.APPROVED) {
    if (outbox || job) {
      return anomalous();
    }
    return {
      enabled,
      jobStatus: enabled ? 'NOT_REQUESTED' : 'DISABLED',
      updatedAt: applicationUpdatedAt,
      safeErrorClass: null,
    };
  }

  if (
    (job && !outbox) ||
    (job && outbox?.status !== OutboxEventStatus.PROCESSED) ||
    (!job && outbox?.status === OutboxEventStatus.PROCESSED)
  ) {
    return anomalous();
  }

  if (job && outbox?.status === OutboxEventStatus.PROCESSED) {
    const jobStatus = mapTeamProvisionJobStatus(job.status);
    return {
      enabled,
      jobStatus,
      updatedAt: job.updatedAt,
      safeErrorClass:
        jobStatus === 'RETRYABLE_FAILED' || jobStatus === 'FAILED'
          ? normalizeTeamSafeErrorClass(job.lastErrorCode)
          : null,
    };
  }

  if (enabled && outbox) {
    if (
      outbox.status === OutboxEventStatus.PENDING ||
      outbox.status === OutboxEventStatus.PROCESSING
    ) {
      return {
        enabled,
        jobStatus: 'PENDING',
        updatedAt: outbox.createdAt,
        safeErrorClass: null,
      };
    }
    if (outbox.status === OutboxEventStatus.FAILED) {
      return {
        enabled,
        jobStatus: 'FAILED',
        updatedAt: outbox.createdAt,
        safeErrorClass: 'UNKNOWN',
      };
    }
  }

  if (!outbox && !job) {
    return {
      enabled,
      jobStatus: enabled ? 'ANOMALOUS' : 'DISABLED',
      updatedAt: applicationUpdatedAt,
      safeErrorClass: enabled ? 'UNKNOWN' : null,
    };
  }
  return anomalous();
}

function mapTeamProvisionJobStatus(
  status: RepositoryProvisionJobStatus,
): TeamRepositoryProvisioningJobStatus {
  switch (status) {
    case RepositoryProvisionJobStatus.PENDING:
      return 'PENDING';
    case RepositoryProvisionJobStatus.PROCESSING:
      return 'PROCESSING';
    case RepositoryProvisionJobStatus.SUCCEEDED:
      return 'SUCCEEDED';
    case RepositoryProvisionJobStatus.FAILED_RETRYABLE:
      return 'RETRYABLE_FAILED';
    case RepositoryProvisionJobStatus.FAILED_FINAL:
      return 'FAILED';
  }
}

function normalizeTeamSafeErrorClass(
  errorCode: string | null,
): TeamRepositoryProvisioningSafeErrorClass {
  switch (errorCode) {
    case 'GITHUB_OPERATIONS_CONFIGURATION':
    case 'GITHUB_OPERATIONS_INSTALLATION_NOT_FOUND':
    case 'GITHUB_OPERATIONS_ORGANIZATION_MISMATCH':
    case 'GITHUB_OPERATIONS_AUTHENTICATION':
    case 'GITHUB_OPERATIONS_PERMISSION':
      return 'AUTH';
    case 'GITHUB_OPERATIONS_RATE_LIMITED':
    case 'GITHUB_OPERATIONS_INVITATION_LIMIT':
      return 'RATE_LIMIT';
    case 'GITHUB_OPERATIONS_INVALID_INPUT':
    case 'REPOSITORY_PROVISION_APPLICATION_NOT_APPROVED':
    case 'REPOSITORY_PROVISION_FEATURE_DISABLED':
    case 'REPOSITORY_PROVISION_INVALID_EVENT':
    case 'REPOSITORY_PROVISION_REPOSITORY_MISMATCH':
      return 'UPSTREAM_REJECTED';
    case 'GITHUB_OPERATIONS_UPSTREAM':
    case 'GITHUB_OPERATIONS_INVALID_RESPONSE':
    case 'REPOSITORY_PROVISION_INTERNAL':
    case null:
    default:
      return 'UNKNOWN';
  }
}
