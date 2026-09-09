import {
  AccountStatus,
  CollectionRepositoryPresence,
  Prisma,
  RepositoryProvisionJobStatus,
  RepositorySource,
} from '@prisma/client';
import type { AuditLogTransactionWriter } from '../audit-log/audit-log.repository';
import type { OwnGithubRepositoryResolution } from '../github/service/own-repository-url-validation.service';
import { STUDENT_MEMBER_WHERE } from '../profiles/user-profile-read';
import { programApplicationManagerWhere } from '../programs/program-participant';
import {
  STUDENT_REPOSITORY_URL_SELECT,
  type StudentRepositoryUrlContext,
} from './student-repository-url.repository';
import { repositoryUrlError } from './student-repository-url.errors';

export class StudentRepositoryUrlTransaction {
  constructor(private readonly transaction: Prisma.TransactionClient) {}
  get auditLogWriter(): AuditLogTransactionWriter {
    return this.transaction;
  }

  async lockContext(
    programId: string,
    studentId: string,
  ): Promise<StudentRepositoryUrlContext | null> {
    await this.transaction
      .$queryRaw`SELECT "id" FROM "Program" WHERE "id" = ${programId} FOR UPDATE`;
    const candidate = await this.transaction.application.findFirst({
      where: { programId, ...programApplicationManagerWhere(studentId) },
      select: { id: true },
    });
    if (!candidate) return null;
    await this.transaction
      .$queryRaw`SELECT "id" FROM "Application" WHERE "id" = ${candidate.id} FOR UPDATE`;
    const actor = await this.transaction.user.findFirst({
      where: {
        id: studentId,
        accountStatus: AccountStatus.ACTIVE,
        ...STUDENT_MEMBER_WHERE,
      },
      select: { id: true },
    });
    if (!actor) return null;
    return this.transaction.application.findFirst({
      where: { programId, ...programApplicationManagerWhere(studentId) },
      select: STUDENT_REPOSITORY_URL_SELECT,
    });
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
      select: { id: true, applicationId: true, programId: true, teamId: true },
    });
    if (
      existing &&
      ((existing.applicationId !== null &&
        existing.applicationId !== context.id) ||
        (existing.programId !== null &&
          existing.programId !== context.programId) ||
        (existing.teamId !== null && existing.teamId !== context.teamId))
    )
      throw repositoryUrlError('conflict');
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
        where: { id: existing.id, applicationId: null },
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
    await tx.application.update({
      where: { id: context.id },
      data: { repositoryUrl: `https://github.com/${metadata.nameWithOwner}` },
    });
    await tx.repositoryProvisionJob.upsert({
      where: { applicationId: context.id },
      create: {
        applicationId: context.id,
        repositoryId,
        status: RepositoryProvisionJobStatus.SUCCEEDED,
        finishedAt: new Date(),
      },
      update: {
        repositoryId,
        status: RepositoryProvisionJobStatus.SUCCEEDED,
        lockedAt: null,
        lockedBy: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        finishedAt: new Date(),
      },
    });
    return repositoryId;
  }
}
