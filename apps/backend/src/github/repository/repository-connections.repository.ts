import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  AccountStatus,
  ApplicationStatus,
  OutboxEventStatus,
  Prisma,
  RepositoryConnectionMode,
  RepositorySource,
  type RepositoryVisibility,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  settleProvisionGenerationForSynchronousConnection,
  transferProvisionGeneration,
} from '../../prisma/repository-provision-generation';
import type { GithubRepositoryMetadata } from '../github-app.client';
import {
  parseRepositoryProvisionEvent,
  REPOSITORY_PROVISION_EVENT_TYPE,
} from '../repository-provision-event';
import {
  canonicalGithubLogins,
  claimGithubRepositoryForApplication,
} from '../repository-provision-state.helpers';

export interface RepositoryConnectionActor {
  readonly userId: string;
  readonly githubId: bigint;
  readonly isStaff: boolean;
}

export type RepositoryConnectionAccess =
  'AUTHORIZED' | 'NOT_FOUND' | 'FORBIDDEN';

export class RepositoryConnectionIdentityError extends Error {
  override readonly name = 'RepositoryConnectionIdentityError';
}

export type RepositoryConnectionTarget =
  | { readonly mode: 'NEW' }
  | {
      readonly mode: 'OWN';
      readonly url: string;
      readonly metadata: GithubRepositoryMetadata;
      readonly source: RepositorySource;
      readonly externalObservation?: {
        readonly defaultBranch: string | null;
        readonly archived: boolean;
      } | null;
    };

export interface PersistedRepositoryConnection {
  readonly status: 'CONNECTED' | 'PENDING';
  readonly applicationId: string;
  readonly repositoryId: string | null;
  readonly connectionMode: RepositoryConnectionMode;
  readonly repositoryUrl: string | null;
  readonly applicantGithubId: bigint;
  readonly changed: boolean;
}

export type ChangeRepositoryConnectionPersistenceResult =
  | PersistedRepositoryConnection
  | { readonly status: 'NOT_FOUND' | 'FORBIDDEN' | 'INVALID_STATE' };

interface LockedApplicationRow {
  readonly id: string;
}

@Injectable()
export class RepositoryConnectionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findActorAuthorityByGithubId(
    githubId: bigint,
  ): Promise<RepositoryConnectionActor | null> {
    const user = await this.prisma.user.findUnique({
      where: { githubId },
      select: {
        id: true,
        accountStatus: true,
        hasStaffAccess: true,
        hasAdminAccess: true,
      },
    });
    if (user?.accountStatus !== AccountStatus.ACTIVE) return null;
    return {
      userId: user.id,
      githubId,
      isStaff: user.hasStaffAccess || user.hasAdminAccess,
    };
  }

  async checkConnectionAccess(
    applicationId: string,
    actor: RepositoryConnectionActor,
  ): Promise<RepositoryConnectionAccess> {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      select: { team: { select: { leaderId: true } } },
    });
    if (application?.team == null) return 'NOT_FOUND';
    return actor.isStaff || application.team?.leaderId === actor.userId
      ? 'AUTHORIZED'
      : 'FORBIDDEN';
  }

  async changeConnection(
    applicationId: string,
    actor: RepositoryConnectionActor,
    target: RepositoryConnectionTarget,
    now: Date,
  ): Promise<ChangeRepositoryConnectionPersistenceResult> {
    return this.prisma.$transaction(async (transaction) => {
      const locked = await transaction.$queryRaw<LockedApplicationRow[]>(
        Prisma.sql`
          SELECT "id"
          FROM "Application"
          WHERE "id" = ${applicationId}
          FOR UPDATE
        `,
      );
      if (locked.length !== 1) return { status: 'NOT_FOUND' };

      const application = await transaction.application.findUnique({
        where: { id: applicationId },
        select: {
          id: true,
          status: true,
          programId: true,
          teamId: true,
          repositoryConnectionMode: true,
          repositoryUrl: true,
          program: { select: { repositoryProvisioningEnabled: true } },
          applicant: { select: { githubId: true } },
          team: {
            select: {
              leaderId: true,
              members: {
                select: { user: { select: { nickname: true } } },
              },
            },
          },
          repository: {
            select: {
              id: true,
              githubRepositoryId: true,
              nameWithOwner: true,
              visibility: true,
            },
          },
        },
      });
      if (application?.team === null || application === null) {
        return { status: 'NOT_FOUND' };
      }
      const currentActor = await transaction.user.findUnique({
        where: { id: actor.userId },
        select: {
          accountStatus: true,
          hasStaffAccess: true,
          hasAdminAccess: true,
        },
      });
      if (
        currentActor === null ||
        currentActor.accountStatus !== AccountStatus.ACTIVE ||
        (!currentActor.hasStaffAccess &&
          !currentActor.hasAdminAccess &&
          application.team.leaderId !== actor.userId)
      ) {
        return { status: 'FORBIDDEN' };
      }
      if (
        application.status !== ApplicationStatus.APPROVED ||
        !application.program.repositoryProvisioningEnabled
      ) {
        return { status: 'INVALID_STATE' };
      }

      if (target.mode === RepositoryConnectionMode.OWN) {
        if (
          application.repository?.githubRepositoryId ===
          target.metadata.githubRepositoryId
        ) {
          await settleProvisionGenerationForSynchronousConnection(
            transaction,
            {
              applicationId,
              repositoryId: application.repository.id,
              now,
            },
            parseRepositoryProvisionEvent,
          );
          return currentConnection(application, 'CONNECTED');
        }
        const repository = await claimGithubRepositoryForApplication(
          transaction,
          {
            applicationId,
            programId: application.programId,
            teamId: application.teamId,
            metadata: target.metadata,
            source: target.source,
            currentConnectionMode: application.repositoryConnectionMode,
            currentRepositoryUrl: application.repositoryUrl,
            connectionMode: RepositoryConnectionMode.OWN,
            repositoryUrl: target.url,
            auditActorGithubId: actor.githubId,
          },
        );
        await settleProvisionGenerationForSynchronousConnection(
          transaction,
          {
            applicationId,
            repositoryId: repository.id,
            now,
          },
          parseRepositoryProvisionEvent,
        );
        return {
          status: 'CONNECTED',
          applicationId,
          repositoryId: repository.id,
          connectionMode: RepositoryConnectionMode.OWN,
          repositoryUrl: target.url,
          applicantGithubId: application.applicant.githubId,
          changed: true,
        };
      }

      const collaboratorGithubLogins = canonicalGithubLogins(
        application.team.members.map((member) => member.user.nickname),
      );
      if (collaboratorGithubLogins.length === 0) {
        throw new RepositoryConnectionIdentityError();
      }
      const requestedAt = now.toISOString();
      const event = await transaction.outboxEvent.create({
        data: {
          type: REPOSITORY_PROVISION_EVENT_TYPE,
          aggregateType: 'Application',
          aggregateId: applicationId,
          idempotencyKey: `repository-connection:${applicationId}:${randomUUID()}`,
          status: OutboxEventStatus.PENDING,
          availableAt: now,
          payload: {
            applicationId,
            programId: application.programId,
            teamId: application.teamId,
            requestedAt,
            collaboratorGithubLogins,
            repositoryConnectionMode: RepositoryConnectionMode.NEW,
            repositoryUrl: null,
            requestedByGithubId: actor.githubId.toString(),
          },
        },
        select: { id: true },
      });
      await transferProvisionGeneration(
        transaction,
        { applicationId, newEventId: event.id, now },
        parseRepositoryProvisionEvent,
      );
      return currentConnection(application, 'PENDING', true);
    });
  }
}

function currentConnection(
  application: {
    readonly id: string;
    readonly repositoryConnectionMode: RepositoryConnectionMode;
    readonly repositoryUrl: string | null;
    readonly applicant: { readonly githubId: bigint };
    readonly repository: {
      readonly id: string;
      readonly githubRepositoryId: bigint;
      readonly nameWithOwner: string;
      readonly visibility: RepositoryVisibility;
    } | null;
  },
  status: 'CONNECTED' | 'PENDING',
  changed = false,
): PersistedRepositoryConnection {
  return {
    status,
    applicationId: application.id,
    repositoryId: application.repository?.id ?? null,
    connectionMode: application.repositoryConnectionMode,
    repositoryUrl: application.repositoryUrl,
    applicantGithubId: application.applicant.githubId,
    changed,
  };
}
