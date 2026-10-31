import { RepositoryProvisionEventService } from '../github/repository-provision-event.service';
import { StudentRepositoryUrlRepository } from './student-repository-url-transaction.repository';
import { Inject, Injectable } from '@nestjs/common';
import { AuditLogService } from '../platform/audit-log.service';
import { APPLICATION_REPOSITORY_URL_CHANGED } from '../platform/repository-audit-metadata.config';
import { DomainException } from '../platform/error-code.error';
import { ConsentsService } from '../users/consents.service';
import { CollectionTriggerService } from '../github/collection-trigger.service';
import { GithubOperationsError } from '../github/github-app.error';
import { OwnRepositoryUrlValidationService } from '../github/own-repository-url-validation.service';
import { ApplicationsRepository } from './applications.repository';
import {
  APPLICATIONS_ERROR_CODES,
  ApplicationsErrorCode,
} from './applications-error-code.error';
import type {
  StudentRepositoryUrlContext,
  TeamRepositoryUrlContext,
} from './student-repository-url-context.repository';
import { repositoryUrlError } from './student-repository-url.error';
import { RepositoryProvisionFailure } from '../github/repository-provision-state.error';
import { ProgramRulesService } from './program-rules.service';

export type StudentRepositoryUrlView = {
  readonly repositoryUrl: string | null;
  readonly canEditRepositoryUrl: boolean;
};

export type UpdateStudentRepositoryUrlInput = {
  readonly repositoryUrl: string;
};

@Injectable()
export class StudentRepositoryUrlService {
  constructor(
    @Inject(StudentRepositoryUrlRepository)
    private readonly repository: Pick<
      StudentRepositoryUrlRepository,
      'findContext' | 'findTeamContext' | 'withTransaction'
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
    @Inject(CollectionTriggerService)
    private readonly collection: Pick<
      CollectionTriggerService,
      'collectRepository'
    >,
    private readonly programRulesService: ProgramRulesService,
    private readonly repositoryProvisionEventService: RepositoryProvisionEventService,
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
    if (!context)
      throw new DomainException(
        APPLICATIONS_ERROR_CODES[ApplicationsErrorCode.APPLICATION_NOT_FOUND],
      );
    return this.updateForTeam(githubId, programId, context.teamId, input);
  }

  async updateForTeam(
    githubId: bigint,
    programId: string,
    teamId: string,
    input: UpdateStudentRepositoryUrlInput,
  ): Promise<StudentRepositoryUrlView> {
    const context = await this.repository.findTeamContext(
      programId,
      teamId,
      githubId,
    );
    this.requireEditable(context);
    const resolution = await this.resolve(input.repositoryUrl);
    if (resolution.kind === 'EXTERNAL')
      await this.consents.requireCurrent(context.applicant.githubId);
    const { view, relinked } = await this.repository.withTransaction(
      async (store) => {
        const current = await store.lockTeamContext(
          programId,
          teamId,
          githubId,
        );
        this.requireEditable(current);
        if (
          current.repository?.githubRepositoryId ===
            resolution.repository.githubRepositoryId &&
          this.url(current)?.toLowerCase() ===
            `https://github.com/${resolution.repository.nameWithOwner}`.toLowerCase()
        )
          return {
            view: {
              repositoryUrl: this.url(current),
              canEditRepositoryUrl: true,
            },
            relinked: false,
          };
        const repositoryId = await store
          .relink(current, resolution, (stored) =>
            this.repositoryProvisionEventService.parseRepositoryProvisionEvent(
              stored,
            ),
          )
          .catch((error: unknown) => {
            throw store.isStudentRepositoryUrlConflict(error)
              ? repositoryUrlError('conflict')
              : error;
          });
        const repositoryUrl = `https://github.com/${resolution.repository.nameWithOwner}`;
        await this.audit.record(
          {
            actorGithubId: githubId,
            action: APPLICATION_REPOSITORY_URL_CHANGED,
            targetType: 'APPLICATION',
            targetId: current.id,
            metadata: {
              schemaVersion: 2,
              programId,
              teamId: current.teamId,
              programName: current.program.name,
              actorGithubLogin: current.editor.nickname,
              before: {
                repositoryId: current.repository?.id ?? null,
                repositoryUrl: this.url(current),
              },
              after: { repositoryId, repositoryUrl },
            },
          },
          store.auditLogWriter,
        );
        return {
          view: { repositoryUrl, canEditRepositoryUrl: true },
          relinked: true,
        };
      },
    );

    if (relinked)
      this.collection.collectRepository(
        resolution.repository.githubRepositoryId,
      );
    return view;
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
    context: TeamRepositoryUrlContext | null,
  ): asserts context is TeamRepositoryUrlContext {
    const isManager =
      context !== null && (context.editor.isLeader || context.editor.isStaff);

    if (!context || !isManager)
      throw new DomainException(
        APPLICATIONS_ERROR_CODES[ApplicationsErrorCode.APPLICATION_NOT_FOUND],
      );
    if (
      !this.programRulesService.canEditStudentRepositoryUrl(
        { status: context.status, endAt: context.program.endAt, isManager },
        new Date(),
      )
    )
      throw repositoryUrlError('closed');
  }

  private view(
    context: StudentRepositoryUrlContext,
    studentId: string,
  ): StudentRepositoryUrlView {
    return {
      repositoryUrl: this.url(context),
      canEditRepositoryUrl:
        this.programRulesService.canEditStudentRepositoryUrl(
          {
            status: context.status,
            endAt: context.program.endAt,
            isManager: context.team.leaderId === studentId,
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
