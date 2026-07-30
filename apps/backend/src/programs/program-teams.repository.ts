import { Injectable } from '@nestjs/common';
import {
  AccountStatus,
  Prisma,
  Role,
  type ProgramCategory,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  COMPATIBLE_PROFILE_NAME_SELECT,
  resolveCompatibleProfileName,
} from '../profiles/profile-compatibility';

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
  readonly teamMinSize: number | null;
  readonly teamMaxSize: number | null;
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
  readonly teamMinSize: number | null;
  readonly teamMaxSize: number | null;
  readonly hasApplication: boolean;
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
  'team' | 'teamMember' | 'application'
>;

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
