import { Inject, Injectable } from '@nestjs/common';
import { ApplicationStatus, Prisma } from '@prisma/client';
import { AuditLogService } from '../audit-log/audit-log.service';
import { APPLICATION_REPOSITORY_URL_CHANGED } from '../audit-log/application-repository-url-audit-metadata';
import { DomainException } from '../common/error-code';
import { ConsentsService } from '../consents/consents.service';
import { GithubOperationsError } from '../github/github-app.error';
import {
  OwnRepositoryUrlValidationService,
  RepositoryProvisionFailure,
} from '../github/service/own-repository-url-validation.service';
import { ApplicationsRepository } from './applications.repository';
import {
  APPLICATIONS_ERROR_CODES,
  ApplicationsErrorCode,
} from './applications-error-code.enum';
import {
  StudentRepositoryUrlRepository,
  type StudentRepositoryUrlContext,
} from './student-repository-url.repository';
import { repositoryUrlError } from './student-repository-url.errors';

export type StudentRepositoryUrlView = {
  readonly repositoryUrl: string | null;
  readonly canEditRepositoryUrl: boolean;
};
export type UpdateStudentRepositoryUrlInput = {
  readonly repositoryUrl: string;
  readonly reason: string;
};

export function canEditStudentRepositoryUrl(
  context: {
    readonly status: ApplicationStatus;
    readonly endAt: Date;
    readonly isManager: boolean;
  },
  now: Date,
): boolean {
  return (
    context.isManager &&
    context.status === ApplicationStatus.APPROVED &&
    now < context.endAt
  );
}

@Injectable()
export class StudentRepositoryUrlService {
  constructor(
    @Inject(StudentRepositoryUrlRepository)
    private readonly repository: Pick<
      StudentRepositoryUrlRepository,
      'findContext' | 'withTransaction'
    >,
    @Inject(ApplicationsRepository)
    private readonly applications: Pick<
      ApplicationsRepository,
      'findActiveStudentByGithubId'
    >,
    @Inject(OwnRepositoryUrlValidationService)
    private readonly resolver: Pick<
      OwnRepositoryUrlValidationService,
      'resolve'
    >,
    @Inject(ConsentsService)
    private readonly consents: Pick<ConsentsService, 'requireCurrent'>,
    @Inject(AuditLogService)
    private readonly audit: Pick<AuditLogService, 'record'>,
  ) {}

  async getMine(
    githubId: bigint,
    programId: string,
  ): Promise<StudentRepositoryUrlView> {
    const actor = await this.requireActor(githubId);
    const context = await this.repository.findContext(programId, actor.id);
    if (!context)
      throw new DomainException(
        APPLICATIONS_ERROR_CODES[ApplicationsErrorCode.APPLICATION_NOT_FOUND],
      );
    return this.view(context, actor.id);
  }

  async updateMine(
    githubId: bigint,
    programId: string,
    input: UpdateStudentRepositoryUrlInput,
  ): Promise<StudentRepositoryUrlView> {
    const actor = await this.requireActor(githubId);
    const context = await this.repository.findContext(programId, actor.id);
    this.requireEditable(context, actor.id);
    const resolution = await this.resolve(input.repositoryUrl);
    if (resolution.kind === 'EXTERNAL')
      await this.consents.requireCurrent(context.applicant.githubId);
    try {
      return await this.repository.withTransaction(async (store) => {
        const current = await store.lockContext(programId, actor.id);
        this.requireEditable(current, actor.id);
        if (
          current.repository?.githubRepositoryId ===
            resolution.repository.githubRepositoryId &&
          this.url(current)?.toLowerCase() ===
            `https://github.com/${resolution.repository.nameWithOwner}`.toLowerCase()
        )
          return this.view(current, actor.id);
        const repositoryId = await store.relink(current, resolution);
        const repositoryUrl = `https://github.com/${resolution.repository.nameWithOwner}`;
        await this.audit.record(
          {
            actorGithubId: githubId,
            action: APPLICATION_REPOSITORY_URL_CHANGED,
            targetType: 'APPLICATION',
            targetId: current.id,
            metadata: {
              schemaVersion: 1,
              programId,
              teamId: current.teamId,
              programName: current.program.name,
              actorGithubLogin: actor.nickname,
              reason: input.reason,
              before: {
                repositoryId: current.repository?.id ?? null,
                repositoryUrl: this.url(current),
              },
              after: { repositoryId, repositoryUrl },
            },
          },
          store.auditLogWriter,
        );
        return { repositoryUrl, canEditRepositoryUrl: true };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw repositoryUrlError('conflict');
      throw error;
    }
  }

  private async resolve(url: string) {
    try {
      return await this.resolver.resolve(url);
    } catch (error) {
      if (error instanceof RepositoryProvisionFailure)
        throw new DomainException(
          APPLICATIONS_ERROR_CODES[
            ApplicationsErrorCode.OWN_REPOSITORY_URL_UNREACHABLE
          ],
        );
      if (error instanceof GithubOperationsError)
        throw repositoryUrlError('unavailable');
      throw error;
    }
  }

  private async requireActor(githubId: bigint) {
    const actor = await this.applications.findActiveStudentByGithubId(githubId);
    if (!actor)
      throw new DomainException(
        APPLICATIONS_ERROR_CODES[ApplicationsErrorCode.STUDENT_ONLY],
      );
    return actor;
  }

  private requireEditable(
    context: StudentRepositoryUrlContext | null,
    studentId: string,
  ): asserts context is StudentRepositoryUrlContext {
    if (
      !context ||
      (context.applicantId !== studentId && context.team.leaderId !== studentId)
    )
      throw new DomainException(
        APPLICATIONS_ERROR_CODES[ApplicationsErrorCode.APPLICATION_NOT_FOUND],
      );
    if (!this.view(context, studentId).canEditRepositoryUrl)
      throw repositoryUrlError('closed');
  }

  private view(
    context: StudentRepositoryUrlContext,
    studentId: string,
  ): StudentRepositoryUrlView {
    return {
      repositoryUrl: this.url(context),
      canEditRepositoryUrl: canEditStudentRepositoryUrl(
        {
          status: context.status,
          endAt: context.program.endAt,
          isManager:
            context.applicantId === studentId ||
            context.team.leaderId === studentId,
        },
        new Date(),
      ),
    };
  }

  private url(context: StudentRepositoryUrlContext): string | null {
    return context.repository
      ? `https://github.com/${context.repository.nameWithOwner}`
      : null;
  }
}
