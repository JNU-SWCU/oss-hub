import { randomUUID } from 'node:crypto';
import {
  AccountStatus,
  CollectionRepositoryPresence,
  Prisma,
  RepositoryConnectionMode,
  RepositoryProvisionJobStatus,
  RepositorySource,
} from '@prisma/client';
import type { AuditLogTransactionWriter } from '../audit-log/audit-log.repository';
import type { OwnGithubRepositoryResolution } from '../github/service/own-repository-url-validation.service';
import {
  REPOSITORY_PROVISION_EVENT_TYPE,
  parseRepositoryProvisionEvent,
} from '../github/repository-provision-event';
import { canonicalGithubLogins } from '../github/repository-provision-state.helpers';
import {
  settleProvisionGenerationForSynchronousConnection,
  transferProvisionGeneration,
} from '../prisma/repository-provision-generation';
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
    const repositoryUrl = `https://github.com/${metadata.nameWithOwner}`;
    const now = new Date();
    await tx.application.update({
      where: { id: context.id },
      data: { repositoryUrl },
    });
    // 학생이 직접 다시 연결한 순간 이 연결이 현재이다 — 진행 중이던 발급
    // 요청은 그 자리에서 끝난다. 세대를 닫지 않고 job만 재무장하면 낡은 요청의
    // payload를 들고 온 worker가 방금 학생이 고른 저장소를 덮어쓴다.
    if (resolution.kind !== 'ORGANIZATION') {
      await settleProvisionGenerationForSynchronousConnection(
        tx,
        { applicationId: context.id, repositoryId, now },
        parseRepositoryProvisionEvent,
      );
      return repositoryId;
    }

    // 조직 저장소는 연결만으로 끝나지 않는다 — worker가 초대를 이어서 조정해야 하므로
    // 「지금 이 연결」을 가리키는 새 요청 세대를 만든다. 세대 없이 PENDING만 두면
    // claim이 fail-closed로 건너뛰고, 이전 세대를 그대로 두면 낡은 목표로 실행된다.
    const members = await tx.teamMember.findMany({
      where: { teamId: context.teamId },
      select: { user: { select: { nickname: true } } },
    });
    const collaboratorGithubLogins = canonicalGithubLogins(
      members.map((member) => member.user.nickname),
    );
    if (collaboratorGithubLogins.length === 0) {
      throw repositoryUrlError('conflict');
    }
    const event = await tx.outboxEvent.create({
      data: {
        type: REPOSITORY_PROVISION_EVENT_TYPE,
        aggregateType: 'Application',
        aggregateId: context.id,
        idempotencyKey: `repository-url:${context.id}:${randomUUID()}`,
        payload: {
          applicationId: context.id,
          programId: context.programId,
          teamId: context.teamId,
          requestedAt: now.toISOString(),
          collaboratorGithubLogins,
          repositoryConnectionMode: RepositoryConnectionMode.OWN,
          repositoryUrl,
        },
        availableAt: now,
      },
      select: { id: true },
    });
    await transferProvisionGeneration(
      tx,
      { applicationId: context.id, newEventId: event.id, now },
      parseRepositoryProvisionEvent,
    );
    return repositoryId;
  }
}
