import { Injectable } from '@nestjs/common';
import {
  AccountStatus,
  Prisma,
  Role,
  type ProgramCategory,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  COMPATIBLE_PROFILE_NAME_SELECT,
  resolveCompatibleProfileName,
} from '../../profiles/profile-compatibility';

export interface TeamStudentActor {
  readonly id: string;
  readonly name: string | null;
  readonly nickname: string;
}

export interface TeamProgramRecord {
  readonly id: string;
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

export interface TeamByDigestRecord {
  readonly id: string;
  readonly programId: string;
  readonly name: string;
  readonly leaderId: string;
  readonly memberCount: number;
  readonly hasApplication: boolean;
}

/**
 * `lockTeamForJoin`이 팀 행을 `FOR UPDATE`로 잠근 뒤 다시 읽은 값 — 잠금 전
 * `findTeamByJoinCodeDigest`의 스냅샷은 동시 합류 경합 아래 stale할 수 있으므로,
 * 실제 정원·잠금 판정은 이 값만 근거로 삼는다.
 */
export interface TeamJoinLockRecord {
  readonly memberCount: number;
  readonly hasApplication: boolean;
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

export class TeamMembershipConflictError extends Error {
  override readonly name = 'TeamMembershipConflictError';
}

export class JoinCodeDigestConflictError extends Error {
  override readonly name = 'JoinCodeDigestConflictError';
}

export interface ProgramTeamsCreateStore {
  findMembershipByProgramUser(
    programId: string,
    userId: string,
  ): Promise<TeamMembershipRecord | null>;
  createTeamWithLeader(
    input: CreateTeamRecordInput,
  ): Promise<CreatedTeamRecord>;
}

export interface ProgramTeamsJoinStore {
  findMembershipByProgramUser(
    programId: string,
    userId: string,
  ): Promise<TeamMembershipRecord | null>;
  findTeamByJoinCodeDigest(
    programId: string,
    joinCodeDigest: string,
  ): Promise<TeamByDigestRecord | null>;
  /**
   * 팀 행을 `FOR UPDATE`로 잠근 뒤 정원·신청 잠금 판정에 쓰는 값을 다시 읽는다
   * (#164 패턴 — `team-invitations.repository.ts`의 `withAcceptTransaction`과
   * 동일한 잠금 SQL). 같은 팀에 대한 동시 합류를 이 잠금으로 직렬화해, 잠금 뒤
   * 재조회한 값만으로 정원 초과 여부를 최종 판정한다.
   */
  lockTeamForJoin(teamId: string): Promise<TeamJoinLockRecord>;
  addMember(teamId: string, programId: string, userId: string): Promise<void>;
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
        role: Role.STUDENT,
      },
      select: {
        id: true,
        nickname: true,
        ...COMPATIBLE_PROFILE_NAME_SELECT,
      },
    });
    return user
      ? {
          id: user.id,
          nickname: user.nickname,
          name: resolveCompatibleProfileName(user),
        }
      : null;
  }

  findProgramById(programId: string): Promise<TeamProgramRecord | null> {
    return this.prisma.program.findUnique({
      where: { id: programId },
      select: {
        id: true,
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
                    ...COMPATIBLE_PROFILE_NAME_SELECT,
                  },
                },
              },
              orderBy: { createdAt: 'asc' },
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
        name: resolveCompatibleProfileName(member.user),
      })),
    };
  }

  /**
   * 교직원 전용 팀 목록 — 명시적 select 만 쓰고 팀명·팀장·멤버(실명·nickname)만 읽는다.
   * 참여코드(`joinCodeDigest`)·저장소(`repositories`)·`TeamMember`의 학과/연락처/이메일·
   * `User.studentId` 는 이 select 에 절대 포함하지 않는다.
   *
   * 실명은 `COMPATIBLE_PROFILE_NAME_SELECT` + `resolveCompatibleProfileName()` 로만 읽는다
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
                ...COMPATIBLE_PROFILE_NAME_SELECT,
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
        name: resolveCompatibleProfileName(member.user),
      })),
    }));
  }

  withCreateTransaction<T>(
    operation: (store: ProgramTeamsCreateStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((tx) =>
      operation(new PrismaProgramTeamsCreateStore(tx)),
    );
  }

  withJoinTransaction<T>(
    operation: (store: ProgramTeamsJoinStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((tx) =>
      operation(new PrismaProgramTeamsJoinStore(tx)),
    );
  }
}

type TeamsTx = Pick<
  Prisma.TransactionClient,
  'team' | 'teamMember' | 'application' | '$queryRaw'
>;

interface LockedTeamRow {
  readonly id: string;
}

class PrismaProgramTeamsCreateStore implements ProgramTeamsCreateStore {
  constructor(private readonly tx: TeamsTx) {}

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

class PrismaProgramTeamsJoinStore implements ProgramTeamsJoinStore {
  constructor(private readonly tx: TeamsTx) {}

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

  async findTeamByJoinCodeDigest(
    programId: string,
    joinCodeDigest: string,
  ): Promise<TeamByDigestRecord | null> {
    const team = await this.tx.team.findFirst({
      where: { programId, joinCodeDigest },
      select: {
        id: true,
        programId: true,
        name: true,
        leaderId: true,
        _count: { select: { members: true } },
        applications: { select: { id: true }, take: 1 },
      },
    });
    if (!team) return null;
    return {
      id: team.id,
      programId: team.programId,
      name: team.name,
      leaderId: team.leaderId,
      memberCount: team._count.members,
      hasApplication: team.applications.length > 0,
    };
  }

  /**
   * `withAcceptTransaction`(team-invitations.repository.ts)과 같은 `FOR UPDATE`
   * SQL로 팀 행을 잠근다. 잠근 뒤에야 정원·신청 잠금 판정에 쓸 값을 다시 읽어,
   * 잠금 전 스냅샷(`findTeamByJoinCodeDigest`)이 아니라 이 값만으로 최종
   * 판정하게 한다 — 같은 팀에 몰리는 동시 합류 요청을 이 잠금으로 직렬화한다.
   */
  async lockTeamForJoin(teamId: string): Promise<TeamJoinLockRecord> {
    await this.tx.$queryRaw<LockedTeamRow[]>(
      Prisma.sql`SELECT "id" FROM "Team" WHERE "id" = ${teamId} FOR UPDATE`,
    );
    const [memberCount, application] = await Promise.all([
      this.tx.teamMember.count({ where: { teamId } }),
      this.tx.application.findFirst({
        where: { teamId },
        select: { id: true },
      }),
    ]);
    return { memberCount, hasApplication: application !== null };
  }

  async addMember(
    teamId: string,
    programId: string,
    userId: string,
  ): Promise<void> {
    try {
      await this.tx.teamMember.create({
        data: { teamId, programId, userId },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new TeamMembershipConflictError();
      }
      throw error;
    }
  }
}
