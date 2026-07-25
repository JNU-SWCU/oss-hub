import { Injectable } from '@nestjs/common';
import {
  AccountStatus,
  ApplicationStatus,
  Prisma,
  Role,
  type ProgramCategory,
} from '@prisma/client';
import type {
  OutboxEvent as PrismaOutboxEvent,
  Prisma as PrismaTypes,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  ApplicationDecisionTarget,
  ApplicationTransition,
  RepositoryProvisionEvent,
  RepositoryProvisionEventInput,
} from './domain/application-decision';

type ApplicationWithProgram = PrismaTypes.ApplicationGetPayload<{
  include: {
    program: { select: { repositoryProvisioningEnabled: true } };
    applicant: { select: { nickname: true } };
    team: {
      select: {
        leader: { select: { nickname: true } };
        members: { select: { user: { select: { nickname: true } } } };
      };
    };
  };
}>;

type ApplicationDatabase = Pick<
  PrismaTypes.TransactionClient,
  'user' | 'program' | 'team' | 'application'
>;

export interface ApplicationsTransactionStore {
  findApplicationById(
    applicationId: string,
  ): Promise<ApplicationDecisionTarget | null>;
  transitionApplication(input: ApplicationTransition): Promise<boolean>;
  createRepositoryProvisionEvent(
    input: RepositoryProvisionEventInput,
  ): Promise<RepositoryProvisionEvent>;
}

export class RepositoryEventAlreadyExistsError extends Error {
  override readonly name = 'RepositoryEventAlreadyExistsError';
}

export class ApplicationDuplicateError extends Error {
  override readonly name = 'ApplicationDuplicateError';
}

export interface ApplicationStudentActor {
  readonly id: string;
  readonly name: string | null;
  readonly nickname: string;
}

export interface ApplyProgramRecord {
  readonly id: string;
  readonly category: ProgramCategory;
  readonly applicationTemplateVersion: number;
  readonly applicationStartAt: Date;
  readonly applicationEndAt: Date;
}

export interface ApplyTeamRecord {
  readonly id: string;
  readonly programId: string;
  readonly leaderId: string;
  readonly isMember: boolean;
}

export interface CreateApplicationRecordInput {
  readonly programId: string;
  readonly applicantId: string;
  readonly teamId: string | null;
  readonly answers: Prisma.InputJsonValue;
  readonly applicationTemplateVersion: number;
}

export interface CreatedApplication {
  readonly id: string;
  readonly programId: string;
  readonly status: ApplicationStatus;
  readonly teamId: string | null;
  readonly submittedAt: Date;
}

export interface ApplicationCreateStore {
  findTeamForApply(
    teamId: string,
    programId: string,
    userId: string,
  ): Promise<ApplyTeamRecord | null>;
  findPersonalDuplicate(
    programId: string,
    applicantId: string,
  ): Promise<boolean>;
  findTeamDuplicate(programId: string, teamId: string): Promise<boolean>;
  createApplication(
    input: CreateApplicationRecordInput,
  ): Promise<CreatedApplication>;
}

class PrismaApplicationsTransactionStore implements ApplicationsTransactionStore {
  constructor(private readonly transaction: PrismaTypes.TransactionClient) {}

  async findApplicationById(
    applicationId: string,
  ): Promise<ApplicationDecisionTarget | null> {
    const application = await this.transaction.application.findUnique({
      where: { id: applicationId },
      include: {
        program: { select: { repositoryProvisioningEnabled: true } },
        applicant: { select: { nickname: true } },
        team: {
          select: {
            leader: { select: { nickname: true } },
            members: { select: { user: { select: { nickname: true } } } },
          },
        },
      },
    });
    return application ? toApplicationDecisionTarget(application) : null;
  }

  async transitionApplication(input: ApplicationTransition): Promise<boolean> {
    const result = await this.transaction.application.updateMany({
      where: {
        id: input.applicationId,
        status: input.expectedStatus,
      },
      data: {
        status: input.nextStatus,
        rejectionReason: input.rejectionReason,
        processedById: input.processedById,
        processedAt: input.processedAt,
      },
    });
    return result.count === 1;
  }

  async createRepositoryProvisionEvent(
    input: RepositoryProvisionEventInput,
  ): Promise<RepositoryProvisionEvent> {
    try {
      const event = await this.transaction.outboxEvent.create({
        data: {
          type: 'REPOSITORY_PROVISION_REQUESTED',
          aggregateType: 'Application',
          aggregateId: input.applicationId,
          idempotencyKey: input.idempotencyKey,
          payload: {
            applicationId: input.applicationId,
            programId: input.programId,
            teamId: input.teamId,
            requestedAt: input.requestedAt.toISOString(),
            collaboratorGithubLogins: input.collaboratorGithubLogins,
          },
        },
      });
      return toRepositoryProvisionEvent(event);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new RepositoryEventAlreadyExistsError();
      }
      throw error;
    }
  }
}

class PrismaApplicationCreateStore implements ApplicationCreateStore {
  constructor(private readonly database: ApplicationDatabase) {}

  async findTeamForApply(
    teamId: string,
    programId: string,
    userId: string,
  ): Promise<ApplyTeamRecord | null> {
    const team = await this.database.team.findFirst({
      where: { id: teamId, programId },
      select: {
        id: true,
        programId: true,
        leaderId: true,
        members: {
          where: { userId },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (!team) return null;
    return {
      id: team.id,
      programId: team.programId,
      leaderId: team.leaderId,
      isMember: team.leaderId === userId || team.members.length > 0,
    };
  }

  async findPersonalDuplicate(
    programId: string,
    applicantId: string,
  ): Promise<boolean> {
    const existing = await this.database.application.findFirst({
      where: { programId, applicantId, teamId: null },
      select: { id: true },
    });
    return existing !== null;
  }

  async findTeamDuplicate(
    programId: string,
    teamId: string,
  ): Promise<boolean> {
    const existing = await this.database.application.findFirst({
      where: { programId, teamId },
      select: { id: true },
    });
    return existing !== null;
  }

  async createApplication(
    input: CreateApplicationRecordInput,
  ): Promise<CreatedApplication> {
    try {
      return await this.database.application.create({
        data: {
          programId: input.programId,
          applicantId: input.applicantId,
          teamId: input.teamId,
          answers: input.answers,
          applicationTemplateVersion: input.applicationTemplateVersion,
          status: ApplicationStatus.SUBMITTED,
        },
        select: {
          id: true,
          programId: true,
          status: true,
          teamId: true,
          submittedAt: true,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ApplicationDuplicateError();
      }
      throw error;
    }
  }
}

@Injectable()
export class ApplicationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async withTransaction<T>(
    operation: (store: ApplicationsTransactionStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((transaction) =>
      operation(new PrismaApplicationsTransactionStore(transaction)),
    );
  }

  async withCreateTransaction<T>(
    operation: (store: ApplicationCreateStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((transaction) =>
      operation(new PrismaApplicationCreateStore(transaction)),
    );
  }

  findActiveStudentByGithubId(
    githubId: bigint,
  ): Promise<ApplicationStudentActor | null> {
    return this.prisma.user.findFirst({
      where: {
        githubId,
        accountStatus: AccountStatus.ACTIVE,
        role: Role.STUDENT,
      },
      select: { id: true, name: true, nickname: true },
    });
  }

  findProgramById(programId: string): Promise<ApplyProgramRecord | null> {
    return this.prisma.program.findUnique({
      where: { id: programId },
      select: {
        id: true,
        category: true,
        applicationTemplateVersion: true,
        applicationStartAt: true,
        applicationEndAt: true,
      },
    });
  }

  async findRepositoryProvisionEvent(
    idempotencyKey: string,
  ): Promise<RepositoryProvisionEvent | null> {
    const event = await this.prisma.outboxEvent.findUnique({
      where: { idempotencyKey },
    });
    return event ? toRepositoryProvisionEvent(event) : null;
  }
}

function toApplicationDecisionTarget(
  application: ApplicationWithProgram,
): ApplicationDecisionTarget {
  const githubLogins = application.team
    ? [
        application.team.leader.nickname,
        ...application.team.members.map((member) => member.user.nickname),
      ]
    : [application.applicant.nickname];
  return {
    id: application.id,
    programId: application.programId,
    teamId: application.teamId,
    status: application.status,
    repositoryProvisioningEnabled:
      application.program.repositoryProvisioningEnabled,
    collaboratorGithubLogins: [
      ...new Set(githubLogins.map((login) => login.toLowerCase())),
    ].sort(),
  };
}

function toRepositoryProvisionEvent(
  event: PrismaOutboxEvent,
): RepositoryProvisionEvent {
  return { id: event.id };
}
