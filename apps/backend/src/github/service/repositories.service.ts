import { Injectable } from '@nestjs/common';
import {
  RepositoryConnectionMode,
  RepositoryInvitationStatus,
  RepositoryProvisionJobStatus,
  RepositoryVisibility,
} from '@prisma/client';
import type { AuditLogService } from '../../audit-log/audit-log.service';
import {
  REPOSITORY_PUBLISH_AUDIT_ACTIONS,
  createRepositoryPublishAuditMetadata,
  deriveRepositoryFullName,
} from '../../audit-log/audit-log-metadata';
import type { GithubAppClient } from '../github-app.client';
import type { GithubOperationsConfig } from '../github-operations.config';
import { parseGithubRepositoryUrl } from '../../common/github-repository-url';
import {
  RepositoriesRepository,
  RepositoryPublishStateError,
  type RepositoryPublishTarget,
} from '../repository/repositories.repository';

export class RepositoryNotFoundError extends Error {
  override readonly name = 'RepositoryNotFoundError';
}

export interface PublishRepositoryInput {
  readonly repositoryId: string;
}
export interface MyRepository {
  readonly repositoryId: string | null;
  readonly applicationId: string;
  readonly applicationMode: 'PERSONAL' | 'TEAM';
  readonly programName: string;
  readonly displayName: string;
  readonly repositoryName: string | null;
  readonly githubUrl: string | null;
  readonly provisionStatus: RepositoryProvisionJobStatus;
  readonly invitationStatus: RepositoryInvitationStatus | null;
  readonly visibility: RepositoryVisibility | null;
  readonly lastErrorCode: string | null;
  readonly updatedAt: Date;
}

export class RepositoryProvisionStateError extends Error {
  override readonly name = 'RepositoryProvisionStateError';
}

@Injectable()
export class RepositoriesService {
  constructor(
    private readonly repository: Pick<
      RepositoriesRepository,
      'findPublishTarget' | 'listOwnedProvisionJobs' | 'withTransaction'
    >,
    private readonly github: Pick<GithubAppClient, 'publishRepository'>,
    private readonly auditLog: Pick<AuditLogService, 'record'>,
    private readonly organizationConfig: Pick<
      GithubOperationsConfig,
      'requireOrganization'
    >,
  ) {}
  async getMyRepositories(githubId: bigint): Promise<readonly MyRepository[]> {
    const jobs = await this.repository.listOwnedProvisionJobs(githubId);
    return jobs.map((job) => {
      if (
        job.repository !== null &&
        job.repository.applicationId !== job.application.id
      ) {
        throw new RepositoryProvisionStateError();
      }
      if (
        job.status === RepositoryProvisionJobStatus.SUCCEEDED &&
        job.repository === null
      ) {
        throw new RepositoryProvisionStateError();
      }
      if (
        job.status === RepositoryProvisionJobStatus.SUCCEEDED &&
        job.repository !== null &&
        !isValidSucceededRepositoryIdentity(
          job.repository.name,
          job.repository.url,
          job.application.repositoryConnectionMode,
          this.organizationConfig.requireOrganization(),
        )
      ) {
        throw new RepositoryProvisionStateError();
      }
      const repository =
        job.status === RepositoryProvisionJobStatus.SUCCEEDED
          ? job.repository
          : null;

      // 개인 참여는 멤버 1명뿐인 팀이다(D5). 팀 유무가 아니라 인원으로 가른다
      // (submission-matrix.service.ts isSoloTeam과 동일 규칙). displayName도
      // 같은 분기를 써야 한다 — team은 D5 이후 항상 존재해 게이트 없이 team.name을
      // 쓰면 개인 신청도 팀 생성 기본명("{닉네임}의 팀")이 표시된다.
      const applicationMode: 'PERSONAL' | 'TEAM' =
        (job.application.team?._count.members ?? 0) > 1 ? 'TEAM' : 'PERSONAL';

      return {
        repositoryId: repository?.id ?? null,
        applicationId: job.application.id,
        applicationMode,
        programName: job.application.program.name,
        displayName:
          applicationMode === 'TEAM'
            ? (job.application.team?.name ?? job.application.applicant.nickname)
            : job.application.applicant.nickname,
        repositoryName: repository?.name ?? null,
        githubUrl: repository?.url ?? null,
        provisionStatus: job.status,
        invitationStatus: repository?.invitations[0]?.status ?? null,
        visibility: repository?.visibility ?? null,
        lastErrorCode: job.lastErrorCode,
        updatedAt: job.updatedAt,
      };
    });
  }

  async publish(
    input: PublishRepositoryInput,
    actorGithubId: bigint,
    now = new Date(),
  ): Promise<RepositoryPublishTarget> {
    const target = await this.repository.findPublishTarget(input.repositoryId);
    if (target === null) {
      throw new RepositoryNotFoundError();
    }
    if (target.visibility === RepositoryVisibility.PUBLIC) {
      return target;
    }
    const published = await this.github.publishRepository(target.name);
    if (
      published.githubRepositoryId !== target.githubRepositoryId ||
      published.name !== target.name ||
      published.visibility !== RepositoryVisibility.PUBLIC
    ) {
      throw new RepositoryPublishStateError();
    }

    return this.repository.withTransaction(async (store) => {
      const won = await store.publishRepositoryIfPrivate(
        target.id,
        target.githubRepositoryId,
        now,
      );
      if (!won) {
        const reloaded = await store.findPublishTarget(target.id);
        if (reloaded === null) {
          throw new RepositoryNotFoundError();
        }
        return reloaded;
      }
      // CAS(publishRepositoryIfPrivate)는 githubRepositoryId만 비교·잠근다 — name/url은
      // 대상이 아니다. 메서드 시작에서 로드한 `target.name/url`은 트랜잭션 밖에서 읽은
      // 값이라, CAS 커밋 사이에 rename이 끼어들면 감사 스냅샷에 오래된 이름이 남는다.
      // CAS가 이겼다면 우리가 방금 그 행에 UPDATE 잠금을 쥔 것이므로, 같은 트랜잭션
      // 안에서 다시 읽으면 동시 rename UPDATE는 우리 커밋 전까지 블록되어 안전하다.
      const committed = await store.findPublishTarget(target.id);
      if (committed === null) {
        // 방금 우리가 성공적으로 UPDATE한 행이 사라질 수는 없다 — 논리적으로 도달
        // 불가능하지만 타입상 null이 가능해 방어적으로 처리한다.
        throw new RepositoryNotFoundError();
      }
      await this.auditLog.record(
        {
          actorGithubId,
          action: REPOSITORY_PUBLISH_AUDIT_ACTIONS.REPOSITORY_PUBLISHED,
          targetType: 'REPOSITORY',
          targetId: target.id,
          metadata: createRepositoryPublishAuditMetadata({
            repositoryId: target.id,
            repositoryFullName: deriveRepositoryFullName(
              committed.name,
              committed.url,
            ),
            before: { visibility: RepositoryVisibility.PRIVATE },
            after: {
              visibility: RepositoryVisibility.PUBLIC,
              publishedAt: now.toISOString(),
            },
          }),
        },
        store.auditLogWriter,
      );
      return {
        ...committed,
        visibility: RepositoryVisibility.PUBLIC,
        publishedAt: now,
      };
    });
  }
}

function isValidSucceededRepositoryIdentity(
  name: string,
  url: string,
  connectionMode: RepositoryConnectionMode,
  organization: string,
): boolean {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(name)) {
    return false;
  }
  // OWN은 학생이 준 외부 URL을 그대로 쓴다. NEW만 조직 불변식을 강제한다.
  if (connectionMode === RepositoryConnectionMode.OWN) {
    return parseGithubRepositoryUrl(url) !== null;
  }
  return url === `https://github.com/${organization}/${name}`;
}
