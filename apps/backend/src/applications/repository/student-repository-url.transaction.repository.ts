import {
  CollectionRepositoryPresence,
  Prisma,
  RepositoryConnectionMode,
  RepositoryProvisionJobStatus,
  RepositorySource,
} from '@prisma/client';
import type { AuditLogTransactionWriter } from '../../prisma/audit-log-transaction-writer';
import type { OwnGithubRepositoryResolution } from '../../github/domain/own-repository-resolution';
import { parseRepositoryProvisionEvent } from '../../github/domain/repository-provision-event';
import { settleProvisionGenerationForSynchronousConnection } from '../../prisma/repository-provision-generation';
import {
  readTeamRepositoryUrlContext,
  type StudentRepositoryUrlContext,
  type TeamRepositoryUrlContext,
} from './student-repository-url-context.repository';
import { repositoryUrlError } from '../domain/student-repository-url.errors';

export class StudentRepositoryUrlTransaction {
  constructor(private readonly transaction: Prisma.TransactionClient) {}
  get auditLogWriter(): AuditLogTransactionWriter {
    return this.transaction;
  }

  async lockTeamContext(
    programId: string,
    teamId: string,
    actorGithubId: bigint,
  ): Promise<TeamRepositoryUrlContext | null> {
    await this.transaction
      .$queryRaw`SELECT "id" FROM "Program" WHERE "id" = ${programId} FOR UPDATE`;

    await this.transaction
      .$queryRaw`SELECT "id" FROM "Team" WHERE "id" = ${teamId} AND "programId" = ${programId} FOR UPDATE`;
    await this.transaction
      .$queryRaw`SELECT "id" FROM "Application" WHERE "programId" = ${programId} AND "teamId" = ${teamId} FOR UPDATE`;
    return readTeamRepositoryUrlContext(
      this.transaction,
      programId,
      teamId,
      actorGithubId,
    );
  }

  async relink(
    context: StudentRepositoryUrlContext,
    resolution: OwnGithubRepositoryResolution,
  ): Promise<string> {
    const tx = this.transaction;
    await tx.$queryRaw`SELECT "id" FROM "RepositoryProvisionJob" WHERE "applicationId" = ${context.id} FOR UPDATE`;
    const job = await tx.repositoryProvisionJob.findUnique({
      where: { applicationId: context.id },
      select: { status: true },
    });
    if (job?.status === RepositoryProvisionJobStatus.PROCESSING)
      throw repositoryUrlError('busy');
    const metadata = resolution.repository;
    const existing = await tx.githubRepository.findUnique({
      where: { githubRepositoryId: metadata.githubRepositoryId },
      select: { id: true },
    });
    if (context.repository) {
      await tx.githubRepository.update({
        where: { id: context.repository.id },
        data: { applicationId: null },
      });
    }
    const data = {
      applicationId: context.id,
      programId: context.programId,
      teamId: context.teamId,
      nameWithOwner: metadata.nameWithOwner,
      visibility: metadata.visibility,
      presence: CollectionRepositoryPresence.PRESENT,
      nextRunAt: new Date(),
      failureCount: 0,
      source:
        resolution.kind === 'EXTERNAL'
          ? RepositorySource.EXTERNAL_PUBLIC
          : RepositorySource.ORG_PROVISIONED,
      ...(resolution.kind === 'EXTERNAL'
        ? {
            defaultBranch: resolution.repository.defaultBranch,
            archived: resolution.repository.archived,
            lastCompleteInventoryObservedAt: new Date(),
          }
        : {}),
    };
    let repositoryId: string;
    if (existing) {
      const result = await tx.githubRepository.updateMany({
        where: {
          id: existing.id,
          applicationId: null,
          AND: [
            { OR: [{ programId: null }, { programId: context.programId }] },
            { OR: [{ teamId: null }, { teamId: context.teamId }] },
          ],
        },
        data,
      });
      if (result.count !== 1) throw repositoryUrlError('conflict');
      repositoryId = existing.id;
    } else {
      const created = await tx.githubRepository.create({
        data: { ...data, githubRepositoryId: metadata.githubRepositoryId },
        select: { id: true },
      });
      repositoryId = created.id;
    }
    const repositoryUrl = `https://github.com/${metadata.nameWithOwner}`;

    await tx.application.update({
      where: { id: context.id },
      data: {
        repositoryConnectionMode: RepositoryConnectionMode.OWN,
        repositoryUrl,
      },
    });

    await settleProvisionGenerationForSynchronousConnection(
      tx,
      { applicationId: context.id, repositoryId, now: new Date() },
      parseRepositoryProvisionEvent,
    );
    return repositoryId;
  }
}
