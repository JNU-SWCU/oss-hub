import {
  CollectionRepositoryPresence,
  Prisma,
  RepositoryProvisionJobStatus,
  RepositorySource,
} from '@prisma/client';
import type { AuditLogTransactionWriter } from '../audit-log/audit-log.repository';
import type { OwnGithubRepositoryResolution } from '../github/service/own-repository-url-validation.service';
import { parseRepositoryProvisionEvent } from '../github/repository-provision-event';
import { settleProvisionGenerationForSynchronousConnection } from '../prisma/repository-provision-generation';
import {
  readTeamRepositoryUrlContext,
  type StudentRepositoryUrlContext,
  type TeamRepositoryUrlContext,
} from './student-repository-url.repository';
import { repositoryUrlError } from './student-repository-url.errors';

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
    // 팀장 승계·탈퇴와 같은 팀 행을 잠근 뒤 현재 권한을 다시 읽는다.
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
    const repositoryUrl = `https://github.com/${metadata.nameWithOwner}`;
    await tx.application.update({
      where: { id: context.id },
      data: { repositoryUrl },
    });
    // 직접 연결은 연결하고 수집할 뿐이다 — 조직 저장소여도 저장소를 만들거나 초대하지
    // 않는다. 진행 중이던 발급 요청은 SUPERSEDED로 닫고 job은 새 세대 없이 완료로
    // 둔다(currentEventId=null이라 worker가 다시 집지 않는다). 세대를 닫지 않고
    // 재무장하면 낡은 요청을 든 worker가 방금 고른 저장소를 덮어쓴다.
    await settleProvisionGenerationForSynchronousConnection(
      tx,
      { applicationId: context.id, repositoryId, now: new Date() },
      parseRepositoryProvisionEvent,
    );
    return repositoryId;
  }
}
