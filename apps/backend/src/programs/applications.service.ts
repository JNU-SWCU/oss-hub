import { RepositoryProvisionEventService } from '../github/repository-provision-event.service';
import { Injectable, Inject, Logger } from '@nestjs/common';
import {
  ApplicationStatus,
  OutboxEventStatus,
  RepositoryConnectionMode,
  RepositoryProvisionJobStatus,
  ProgramLifecycle,
  ApplicationReviewEventKind,
} from '@prisma/client';
import {
  RepositoryEventAlreadyExistsError,
  ApplicationDuplicateError,
  ApplicationTeamMembershipConflictError,
  ApplicationJoinCodeDigestConflictError,
  ApplicationPreparationConflictError,
} from './applications.error';
import { APPLICATION_DECISION_ACTIONS } from './applications.config';
import {
  ApplicationListItem,
  ApplicationRepositoryProvisioning,
  RepositoryProvisioningJobStatus,
  RepositoryProvisioningSafeErrorClass,
  ApplicationListAnswers,
  ApplicationsRepository,
  ApplicationDecisionCommand,
  ApplicationDecisionAction,
  type ApplicationListQuery,
  type ApplicationListPage,
  type CreatedApplication,
  type StaffApplicationDetail,
  type StaffDashboardSummary,
  type TeamManagementListPage,
  type CreateApplicationInput,
  type ApplicationDecisionResult,
  type ApplicationDecisionTarget,
  type ApplicationTransition,
  type RepositoryProvisionJobSnapshot,
  type ApplicationListRow,
  type ApplicationListOutbox,
  type ApplicationListProvisionJob,
} from './applications.repository';
import { AuditLogService } from '../platform/audit-log.service';
import {
  APPLICATION_DECISION_AUDIT_ACTIONS,
  APPLICATION_SUBMITTED_AUDIT_ACTIONS,
  TEAM_CREATED_AUDIT_ACTIONS,
} from '../platform/audit-log-metadata.config';
import { UsersAuthorityService } from '../users/users-authority.service';
import { ApplicationJoinCodeService } from './application-preparations.service';
import {
  DomainException,
  type ProblemDetailExtensions,
} from '../platform/error-code.error';
import {
  APPLICATIONS_ERROR_CODES,
  ApplicationsErrorCode,
} from './applications-error-code.error';
import { AuditLogMetadataService } from '../platform/audit-log-metadata.service';
import { RepositoryUrlService } from '../github/repository-url.service';
import { ApplicationAnswersService } from './application-answers.service';

type ApplicationDecisionPlan = {
  readonly provisionJob: RepositoryProvisionJobSnapshot | null;
} & (
  | {
      readonly kind: 'APPROVE';
      readonly expectedStatus:
        typeof ApplicationStatus.SUBMITTED | typeof ApplicationStatus.REJECTED;
      readonly nextStatus: typeof ApplicationStatus.APPROVED;
      readonly rejectionReason: null;
      readonly processedBy: { readonly id: string; readonly at: Date };
    }
  | {
      readonly kind: 'REJECT';
      readonly expectedStatus:
        typeof ApplicationStatus.SUBMITTED | typeof ApplicationStatus.APPROVED;
      readonly nextStatus: typeof ApplicationStatus.REJECTED;
      readonly rejectionReason: string;
      readonly processedBy: { readonly id: string; readonly at: Date };
    }
  | {
      readonly kind: 'REVERT';
      readonly expectedStatus:
        typeof ApplicationStatus.APPROVED | typeof ApplicationStatus.REJECTED;
      readonly nextStatus: typeof ApplicationStatus.SUBMITTED;
      readonly rejectionReason: null;
      readonly processedBy: 'preserve';
    }
);

function isProvisioningCompleted(
  job: RepositoryProvisionJobSnapshot | null,
): boolean {
  if (job === null) return false;
  return (
    job.repositoryId !== null ||
    job.status === RepositoryProvisionJobStatus.SUCCEEDED
  );
}

const REVIEW_EVENT_BY_PLAN_KIND = {
  APPROVE: ApplicationReviewEventKind.APPROVED,
  REJECT: ApplicationReviewEventKind.REJECTED,
  REVERT: ApplicationReviewEventKind.REVERTED,
} as const satisfies Record<
  ApplicationDecisionPlan['kind'],
  ApplicationReviewEventKind
>;

interface ApplicationStatusConflictExtensions extends ProblemDetailExtensions {
  readonly latestStatus: ApplicationStatus;
}

interface RepositoryEventConflictExtensions extends ProblemDetailExtensions {
  readonly eventId: string;
}

interface TeamMinimumExtensions extends ProblemDetailExtensions {
  readonly memberCount: number;
  readonly teamMinSize: number;
}

const JOIN_CODE_ATTEMPTS = 5;

@Injectable()
export class ApplicationsService {
  private readonly logger = new Logger(ApplicationsService.name);

  constructor(
    private readonly repository: ApplicationsRepository,
    private readonly auditLog: AuditLogService,
    @Inject(UsersAuthorityService)
    private readonly authority: Pick<
      UsersAuthorityService,
      'assertActiveStaff'
    >,
    @Inject(ApplicationJoinCodeService)
    private readonly joinCodes: Pick<
      ApplicationJoinCodeService,
      'generateJoinCode' | 'computeJoinCodeDigest'
    >,
    private readonly auditLogMetadataService: AuditLogMetadataService,
    private readonly repositoryUrlService: RepositoryUrlService,
    private readonly applicationAnswersService: ApplicationAnswersService,
    private readonly repositoryProvisionEventService: RepositoryProvisionEventService,
  ) {}

  private readonly parseProvisionHistoryPayload = (payload: unknown) =>
    this.repositoryProvisionEventService.parseRepositoryProvisionEvent(payload);

  async create(
    githubId: bigint,
    programId: string,
    input: CreateApplicationInput,
    now: Date = new Date(),
  ): Promise<CreatedApplication> {
    const student = await this.repository.findActiveStudentByGithubId(githubId);
    if (!student) {
      throw this.error(ApplicationsErrorCode.STUDENT_ONLY);
    }

    const program = await this.repository.findProgramById(programId);
    if (!program) {
      throw this.error(ApplicationsErrorCode.PROGRAM_NOT_FOUND);
    }
    const teamName = input.teamName?.trim() || `${student.nickname}의 팀`;

    try {
      return await this.repository.withCreateTransaction(async (store) => {
        const lockedProgram = await store.lockProgramForApply(programId);
        if (!lockedProgram) {
          throw this.error(ApplicationsErrorCode.PROGRAM_NOT_FOUND);
        }
        if (lockedProgram.lifecycle === ProgramLifecycle.ARCHIVED) {
          throw this.error(ApplicationsErrorCode.PROGRAM_ARCHIVED);
        }

        if (
          now < lockedProgram.applicationStartAt ||
          now > lockedProgram.applicationEndAt
        ) {
          throw this.error(ApplicationsErrorCode.APPLICATION_PERIOD_CLOSED);
        }

        const versionCheck =
          this.applicationAnswersService.checkApplicationTemplateVersion(
            input.applicationTemplateVersion,
            lockedProgram.applicationTemplateVersion,
          );
        if (!versionCheck.ok) {
          throw this.error(ApplicationsErrorCode.TEMPLATE_VERSION_MISMATCH);
        }

        const applicantName = (student.name ?? student.nickname).trim();
        const answersResult =
          this.applicationAnswersService.normalizeAndValidateApplicationAnswers(
            input.answers,
            applicantName,
            'enforce-length',
          );
        if (!answersResult.ok) {
          if (answersResult.reason === 'TOO_LONG')
            throw new DomainException(
              APPLICATIONS_ERROR_CODES[ApplicationsErrorCode.ANSWER_TOO_LONG],
              {
                fieldErrors: (answersResult.tooLongKeys ?? []).map((key) => ({
                  field: key,
                  code: ApplicationsErrorCode.ANSWER_TOO_LONG,
                  message:
                    this.applicationAnswersService.applicationAnswerTooLongMessage(
                      key,
                    ),
                })),
              },
            );
          throw this.error(ApplicationsErrorCode.INVALID_ANSWERS);
        }

        const existingTeam = await store.findExistingTeamMembership(
          programId,
          student.id,
        );
        if (existingTeam) {
          const actorIsCurrentLeader = await store.lockTeamForApply(
            existingTeam.id,
            student.id,
          );
          if (!actorIsCurrentLeader) {
            throw this.error(ApplicationsErrorCode.TEAM_LEADER_REQUIRED);
          }
        }
        const preparation =
          existingTeam === null
            ? await store.findPreparationForApply(programId, student.id)
            : null;
        if (preparation !== null && preparation.leaderId !== student.id)
          throw this.error(ApplicationsErrorCode.TEAM_LEADER_REQUIRED);
        const teamMinSize = await store.findTeamMinSize(programId);
        const memberCount = existingTeam
          ? await store.countTeamMembers(existingTeam.id)
          : (preparation?.memberIds.length ?? 1);
        if (teamMinSize !== null && memberCount < teamMinSize) {
          const extensions: TeamMinimumExtensions = {
            memberCount,
            teamMinSize,
          };
          throw new DomainException(
            APPLICATIONS_ERROR_CODES[
              ApplicationsErrorCode.TEAM_MIN_SIZE_NOT_MET
            ],
            extensions,
          );
        }

        let createdTeam: { readonly id: string; readonly name: string } | null =
          null;
        for (
          let attempt = 0;
          createdTeam === null &&
          existingTeam === null &&
          attempt < JOIN_CODE_ATTEMPTS;
          attempt += 1
        ) {
          const joinCode = this.joinCodes.generateJoinCode();
          const joinCodeDigest = this.joinCodes.computeJoinCodeDigest(joinCode);
          try {
            createdTeam = await store.createTeamWithLeader({
              programId,
              name: preparation?.name ?? teamName,
              joinCodeDigest,
              leaderId: student.id,
              memberIds: preparation?.memberIds,
            });
            break;
          } catch (error) {
            if (error instanceof ApplicationJoinCodeDigestConflictError) {
              continue;
            }
            if (error instanceof ApplicationTeamMembershipConflictError) {
              throw this.error(ApplicationsErrorCode.DUPLICATE_APPLICATION);
            }
            throw error;
          }
        }
        const applicationTeam = existingTeam ?? createdTeam;
        if (applicationTeam === null) {
          throw new Error('join code digest collision retries exhausted');
        }

        const application = await store.createApplication({
          programId,
          applicantId: student.id,
          teamId: applicationTeam.id,
          answers: answersResult.answers,
          applicationTemplateVersion: lockedProgram.applicationTemplateVersion,
          isRepositoryPublicationPlanned: input.isRepositoryPublicationPlanned,
          repositoryConnectionMode: RepositoryConnectionMode.NEW,
          repositoryUrl: null,
        });

        if (preparation !== null) await store.deletePreparation(preparation.id);
        await store.appendReviewHistory({
          applicationId: application.id,
          eventKind: ApplicationReviewEventKind.SUBMITTED,
          actorId: student.id,
          occurredAt: application.submittedAt,
          rejectionReason: null,
        });

        if (createdTeam !== null) {
          await this.auditLog.record(
            {
              actorGithubId: githubId,
              action: TEAM_CREATED_AUDIT_ACTIONS.TEAM_CREATED,
              targetType: 'TEAM',
              targetId: createdTeam.id,
              metadata:
                this.auditLogMetadataService.createTeamCreatedAuditMetadata({
                  programName: program.name,
                  teamName: createdTeam.name,
                }),
            },
            store.auditLogWriter,
          );
        }
        await this.auditLog.record(
          {
            actorGithubId: githubId,
            action: APPLICATION_SUBMITTED_AUDIT_ACTIONS.APPLICATION_SUBMITTED,
            targetType: 'APPLICATION',
            targetId: application.id,
            metadata:
              this.auditLogMetadataService.createApplicationSubmittedAuditMetadata(
                {
                  programName: program.name,
                  teamName: applicationTeam.name,
                },
              ),
          },
          store.auditLogWriter,
        );
        return application;
      });
    } catch (error) {
      if (error instanceof DomainException) throw error;
      if (error instanceof ApplicationPreparationConflictError)
        throw this.error(ApplicationsErrorCode.PREPARATION_CHANGED);
      if (error instanceof ApplicationDuplicateError) {
        throw this.error(ApplicationsErrorCode.DUPLICATE_APPLICATION);
      }
      if (error instanceof ApplicationTeamMembershipConflictError) {
        throw this.error(ApplicationsErrorCode.DUPLICATE_APPLICATION);
      }
      throw error;
    }
  }

  async listForProgram(
    sessionGithubId: bigint,
    programId: string,
    query: ApplicationListQuery,
  ): Promise<ApplicationListPage> {
    await this.authority.assertActiveStaff(sessionGithubId, () =>
      this.error(ApplicationsErrorCode.STAFF_LIST_ONLY),
    );
    await this.requireProgram(programId);
    const page = await this.repository.listApplicationsForProgram(
      programId,
      query,
    );
    return {
      ...page,
      items: page.items.map((source) =>
        this.toApplicationListItem(source.row, source.outbox, source.job),
      ),
    };
  }

  async listTeamManagementForProgram(
    sessionGithubId: bigint,
    programId: string,
    query: ApplicationListQuery,
  ): Promise<TeamManagementListPage> {
    await this.authority.assertActiveStaff(sessionGithubId, () =>
      this.error(ApplicationsErrorCode.STAFF_LIST_ONLY),
    );
    await this.requireProgram(programId);
    return this.repository.listTeamManagementForProgram(programId, query);
  }

  private async requireProgram(programId: string): Promise<void> {
    const program = await this.repository.findProgramById(programId);
    if (!program) {
      throw this.error(ApplicationsErrorCode.PROGRAM_NOT_FOUND);
    }
  }

  async getForStaff(
    sessionGithubId: bigint,
    applicationId: string,
  ): Promise<StaffApplicationDetail> {
    await this.authority.assertActiveStaff(sessionGithubId, () =>
      this.error(ApplicationsErrorCode.STAFF_LIST_ONLY),
    );
    const [application, reviewHistory] = await Promise.all([
      this.repository.findApplicationForStaff(applicationId),
      this.repository.listReviewHistory(applicationId),
    ]);
    if (!application) {
      throw this.error(ApplicationsErrorCode.APPLICATION_NOT_FOUND);
    }
    return {
      application: this.toApplicationListItem(
        application.row,
        application.outbox,
        application.job,
      ),
      reviewHistory,
    };
  }

  async staffSummary(sessionGithubId: bigint): Promise<StaffDashboardSummary> {
    await this.authority.assertActiveStaff(sessionGithubId, () =>
      this.error(ApplicationsErrorCode.STAFF_LIST_ONLY),
    );
    return this.repository.listStaffDashboardSummary();
  }

  async decide(
    actorGithubId: bigint,
    applicationId: string,
    input: ApplicationDecisionCommand,
  ): Promise<ApplicationDecisionResult> {
    const { actorId } = await this.authority.assertActiveStaff(
      actorGithubId,
      () => this.error(ApplicationsErrorCode.STAFF_ONLY),
    );
    const action =
      this.applicationAnswersService.applicationDecisionAction(input);
    const idempotencyKey = `repository-provision:${applicationId}`;
    try {
      return await this.repository.withTransaction(async (store) => {
        const application = await store.findApplicationById(applicationId);
        if (!application) {
          throw new DomainException(
            APPLICATIONS_ERROR_CODES[
              ApplicationsErrorCode.APPLICATION_NOT_FOUND
            ],
          );
        }

        if (
          application.teamId !== null &&
          (await store.isCurrentTeamMember(application.teamId, actorId))
        ) {
          throw this.error(ApplicationsErrorCode.OWN_TEAM_DECISION_FORBIDDEN);
        }

        const processedAt = new Date();
        const plan = await this.resolveDecisionPlan({
          application,
          action,
          actorId,
          processedAt,
          findProvisionJob: (id) => store.findRepositoryProvisionJob(id),
        });

        const transition: ApplicationTransition = {
          applicationId,
          expectedStatus: plan.expectedStatus,
          nextStatus: plan.nextStatus,
          rejectionReason: plan.rejectionReason,
          processedBy: plan.processedBy,
        };
        const transitioned = await store.transitionApplication(transition);
        if (!transitioned) {
          const latest = await store.findApplicationById(applicationId);
          if (!latest) {
            throw this.error(ApplicationsErrorCode.APPLICATION_NOT_FOUND);
          }
          const extensions: ApplicationStatusConflictExtensions = {
            latestStatus: latest.status,
          };
          throw new DomainException(
            APPLICATIONS_ERROR_CODES[
              ApplicationsErrorCode.APPLICATION_ALREADY_DECIDED
            ],
            extensions,
          );
        }

        await this.auditLog.record(
          {
            actorGithubId,
            action: this.auditActionFor(plan.kind),
            targetType: 'APPLICATION',
            targetId: applicationId,
            metadata:
              this.auditLogMetadataService.createApplicationDecisionAuditMetadata(
                {
                  programName: application.programName,
                  applicantGithubLogin: application.applicantGithubLogin,
                  before: { status: application.status },
                  after: { status: plan.nextStatus },
                },
              ),
          },
          store.auditLogWriter,
        );

        await store.appendReviewHistory({
          applicationId,
          eventKind: REVIEW_EVENT_BY_PLAN_KIND[plan.kind],
          actorId,
          occurredAt: processedAt,
          rejectionReason: plan.rejectionReason,
        });

        await store.createApplicationDecisionNotifications({
          applicationId,
          programId: application.programId,
          programName: application.programName,
          recipientUserIds: this.notificationRecipientIds(application),
          decision: plan.nextStatus,
          decidedAt: processedAt,
        });

        const provisioningCompleted = isProvisioningCompleted(
          plan.provisionJob,
        );

        switch (plan.kind) {
          case 'REJECT': {
            if (
              plan.expectedStatus === ApplicationStatus.APPROVED &&
              !provisioningCompleted
            ) {
              await store.discardRepositoryProvisionRequest(
                applicationId,
                processedAt,
                this.parseProvisionHistoryPayload,
              );
            }
            return {
              kind: 'REJECTED',
              applicationId,
              status: plan.nextStatus,
              rejectionReason: plan.rejectionReason,
            };
          }
          case 'REVERT': {
            if (!provisioningCompleted) {
              await store.discardRepositoryProvisionRequest(
                applicationId,
                processedAt,
                this.parseProvisionHistoryPayload,
              );
            }
            return {
              kind: 'REVERTED',
              applicationId,
              status: plan.nextStatus,
            };
          }
          case 'APPROVE': {
            if (!application.repositoryProvisioningEnabled) {
              return {
                kind: 'APPROVED',
                applicationId,
                status: plan.nextStatus,
                repositoryProvisioning: {
                  enabled: false,
                  eventId: null,
                  jobStatus: null,
                },
              };
            }

            if (provisioningCompleted) {
              const existing =
                await store.findRepositoryProvisionEvent(idempotencyKey);
              return {
                kind: 'APPROVED',
                applicationId,
                status: plan.nextStatus,
                repositoryProvisioning: {
                  enabled: true,
                  eventId: existing?.id ?? null,
                  jobStatus: plan.provisionJob?.status ?? null,
                },
              };
            }

            await store.discardRepositoryProvisionRequest(
              applicationId,
              processedAt,
              this.parseProvisionHistoryPayload,
            );

            const event = await store.createRepositoryProvisionEvent(
              {
                applicationId,
                programId: application.programId,
                teamId: application.teamId,
                collaboratorGithubLogins:
                  this.collaboratorGithubLogins(application),
                repositoryConnectionMode: application.repositoryConnectionMode,
                repositoryUrl: application.repositoryUrl,
                idempotencyKey,
                requestedAt: processedAt,
              },
              this.parseProvisionHistoryPayload,
            );
            return {
              kind: 'APPROVED',
              applicationId,
              status: plan.nextStatus,
              repositoryProvisioning: {
                enabled: true,
                eventId: event.id,
                jobStatus: RepositoryProvisionJobStatus.PENDING,
              },
            };
          }
          default: {
            const exhaustivePlan: never = plan;
            return exhaustivePlan;
          }
        }
      });
    } catch (error) {
      if (error instanceof DomainException) {
        throw error;
      }
      if (error instanceof RepositoryEventAlreadyExistsError) {
        const existing =
          await this.repository.findRepositoryProvisionEvent(idempotencyKey);
        if (existing) {
          const extensions: RepositoryEventConflictExtensions = {
            eventId: existing.id,
          };
          throw new DomainException(
            APPLICATIONS_ERROR_CODES[
              ApplicationsErrorCode.REPOSITORY_EVENT_ALREADY_EXISTS
            ],
            extensions,
          );
        }
      }
      this.logger.error({
        event: 'applications.decision.failed',
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      throw new DomainException(
        APPLICATIONS_ERROR_CODES[
          ApplicationsErrorCode.DECISION_TRANSACTION_FAILED
        ],
      );
    }
  }

  private async resolveDecisionPlan(input: {
    readonly application: ApplicationDecisionTarget;
    readonly action: ApplicationDecisionAction;
    readonly actorId: string;
    readonly processedAt: Date;
    readonly findProvisionJob: (
      applicationId: string,
    ) => Promise<RepositoryProvisionJobSnapshot | null>;
  }): Promise<ApplicationDecisionPlan> {
    const { application, action, actorId, processedAt } = input;

    switch (action.action) {
      case APPLICATION_DECISION_ACTIONS.APPROVE: {
        if (application.status === ApplicationStatus.APPROVED) {
          const extensions: ApplicationStatusConflictExtensions = {
            latestStatus: application.status,
          };
          throw new DomainException(
            APPLICATIONS_ERROR_CODES[
              ApplicationsErrorCode.APPLICATION_ALREADY_DECIDED
            ],
            extensions,
          );
        }
        const expectedStatus = application.status;
        if (
          application.repositoryConnectionMode ===
            RepositoryConnectionMode.OWN &&
          (application.repositoryUrl === null ||
            this.repositoryUrlService.parseGithubRepositoryUrl(
              application.repositoryUrl,
            ) === null)
        ) {
          throw this.error(ApplicationsErrorCode.OWN_REPOSITORY_URL_REQUIRED);
        }
        return {
          kind: 'APPROVE',
          expectedStatus,
          nextStatus: ApplicationStatus.APPROVED,
          rejectionReason: null,
          processedBy: { id: actorId, at: processedAt },
          provisionJob: await input.findProvisionJob(application.id),
        };
      }
      case APPLICATION_DECISION_ACTIONS.REJECT: {
        if (application.status === ApplicationStatus.REJECTED) {
          const extensions: ApplicationStatusConflictExtensions = {
            latestStatus: application.status,
          };
          throw new DomainException(
            APPLICATIONS_ERROR_CODES[
              ApplicationsErrorCode.APPLICATION_ALREADY_DECIDED
            ],
            extensions,
          );
        }
        const expectedStatus = application.status;
        return {
          kind: 'REJECT',
          expectedStatus,
          nextStatus: ApplicationStatus.REJECTED,
          rejectionReason: action.reason,
          processedBy: { id: actorId, at: processedAt },
          provisionJob: await input.findProvisionJob(application.id),
        };
      }
      case APPLICATION_DECISION_ACTIONS.REVERT: {
        if (application.status === ApplicationStatus.SUBMITTED) {
          const extensions: ApplicationStatusConflictExtensions = {
            latestStatus: application.status,
          };
          throw new DomainException(
            APPLICATIONS_ERROR_CODES[
              ApplicationsErrorCode.APPLICATION_REVERT_INVALID_STATUS
            ],
            extensions,
          );
        }
        if (
          application.status !== ApplicationStatus.APPROVED &&
          application.status !== ApplicationStatus.REJECTED
        ) {
          const extensions: ApplicationStatusConflictExtensions = {
            latestStatus: application.status,
          };
          throw new DomainException(
            APPLICATIONS_ERROR_CODES[
              ApplicationsErrorCode.APPLICATION_REVERT_INVALID_STATUS
            ],
            extensions,
          );
        }

        const expectedStatus = application.status;
        return {
          kind: 'REVERT',
          expectedStatus,
          nextStatus: ApplicationStatus.SUBMITTED,
          rejectionReason: null,
          processedBy: 'preserve',
          provisionJob: await input.findProvisionJob(application.id),
        };
      }
      default: {
        const exhaustiveAction: never = action;
        return exhaustiveAction;
      }
    }
  }

  private auditActionFor(
    kind: ApplicationDecisionPlan['kind'],
  ): (typeof APPLICATION_DECISION_AUDIT_ACTIONS)[keyof typeof APPLICATION_DECISION_AUDIT_ACTIONS] {
    switch (kind) {
      case 'APPROVE':
        return APPLICATION_DECISION_AUDIT_ACTIONS.APPLICATION_APPROVED;
      case 'REJECT':
        return APPLICATION_DECISION_AUDIT_ACTIONS.APPLICATION_REJECTED;
      case 'REVERT':
        return APPLICATION_DECISION_AUDIT_ACTIONS.APPLICATION_REVERTED;
      default: {
        const exhaustiveKind: never = kind;
        return exhaustiveKind;
      }
    }
  }

  private error(code: ApplicationsErrorCode): DomainException {
    return new DomainException(APPLICATIONS_ERROR_CODES[code]);
  }

  private toApplicationListItem(
    row: ApplicationListRow,
    outbox: ApplicationListOutbox | undefined,
    job: ApplicationListProvisionJob | undefined,
  ): ApplicationListItem {
    const team =
      row.team !== null
        ? {
            id: row.team.id,
            name: row.team.name,
            memberCount: row.team._count.members,
          }
        : null;
    return {
      id: row.id,
      programId: row.programId,
      status: row.status,
      submittedAt: row.submittedAt,
      rejectionReason: row.rejectionReason,
      repositoryConnectionMode: row.repositoryConnectionMode,
      repositoryUrl: row.repositoryUrl,
      repositoryProvisioning:
        row.status === ApplicationStatus.APPROVED &&
        row.repository != null &&
        job?.status === RepositoryProvisionJobStatus.SUCCEEDED &&
        job.repositoryId === row.repository.id &&
        row.repositoryUrl ===
          this.repositoryUrlService.repositoryUrlFromNameWithOwner(
            row.repository.nameWithOwner,
          )
          ? {
              enabled: row.program.repositoryProvisioningEnabled,
              jobStatus: 'SUCCEEDED',
              updatedAt: job.updatedAt,
              safeErrorClass: null,
            }
          : resolveRepositoryProvisioning(
              row.status,
              row.program.repositoryProvisioningEnabled,
              row.updatedAt,
              outbox,
              job,
            ),
      repository: row.repository
        ? {
            url: this.repositoryUrlService.repositoryUrlFromNameWithOwner(
              row.repository.nameWithOwner,
            ),
            visibility: row.repository.visibility,
          }
        : null,
      isRepositoryPublicationPlanned: row.isRepositoryPublicationPlanned,
      participation: team ? 'TEAM' : 'INDIVIDUAL',
      applicant: {
        id: row.applicant.id,
        nickname: row.applicant.nickname,
        name: row.applicant.profile?.name ?? null,
      },
      team,
      answers: parseListAnswers(row.answers),
    };
  }

  private collaboratorGithubLogins(
    application: ApplicationDecisionTarget,
  ): readonly string[] {
    return [
      ...new Set(
        application.participants.map((participant) =>
          participant.githubLogin.toLowerCase(),
        ),
      ),
    ].sort();
  }

  private notificationRecipientIds(
    application: ApplicationDecisionTarget,
  ): readonly string[] {
    return [
      ...new Set(application.participants.map((participant) => participant.id)),
    ].sort();
  }
}

function resolveRepositoryProvisioning(
  applicationStatus: ApplicationStatus,
  enabled: boolean,
  applicationUpdatedAt: Date,
  outbox: ApplicationListOutbox | undefined,
  job: ApplicationListProvisionJob | undefined,
): ApplicationRepositoryProvisioning {
  const anomalous = (): ApplicationRepositoryProvisioning => ({
    enabled,
    jobStatus: 'ANOMALOUS',
    updatedAt: applicationUpdatedAt,
    safeErrorClass: 'UNKNOWN',
  });
  if (applicationStatus !== ApplicationStatus.APPROVED) {
    if (outbox || job) {
      return anomalous();
    }
    return {
      enabled,
      jobStatus: enabled ? 'NOT_REQUESTED' : 'DISABLED',
      updatedAt: applicationUpdatedAt,
      safeErrorClass: null,
    };
  }

  if (
    (job && !outbox) ||
    (job && outbox?.status !== OutboxEventStatus.PROCESSED) ||
    (!job && outbox?.status === OutboxEventStatus.PROCESSED)
  ) {
    return anomalous();
  }

  if (job && outbox?.status === OutboxEventStatus.PROCESSED) {
    const jobStatus = mapProvisionJobStatus(job.status);
    return {
      enabled,
      jobStatus,
      updatedAt: job.updatedAt,
      safeErrorClass:
        jobStatus === 'RETRYABLE_FAILED' || jobStatus === 'FAILED'
          ? normalizeSafeErrorClass(job.lastErrorCode)
          : null,
    };
  }

  if (enabled && outbox) {
    if (
      outbox.status === OutboxEventStatus.PENDING ||
      outbox.status === OutboxEventStatus.PROCESSING
    ) {
      return {
        enabled,
        jobStatus: 'PENDING',
        updatedAt: outbox.createdAt,
        safeErrorClass: null,
      };
    }
    if (outbox.status === OutboxEventStatus.FAILED) {
      return {
        enabled,
        jobStatus: 'FAILED',
        updatedAt: outbox.createdAt,
        safeErrorClass: 'UNKNOWN',
      };
    }
  }

  if (!outbox && !job) {
    return {
      enabled,
      jobStatus: enabled ? 'ANOMALOUS' : 'DISABLED',
      updatedAt: applicationUpdatedAt,
      safeErrorClass: enabled ? 'UNKNOWN' : null,
    };
  }
  return anomalous();
}

function mapProvisionJobStatus(
  status: RepositoryProvisionJobStatus,
): RepositoryProvisioningJobStatus {
  switch (status) {
    case RepositoryProvisionJobStatus.PENDING:
      return 'PENDING';
    case RepositoryProvisionJobStatus.PROCESSING:
      return 'PROCESSING';
    case RepositoryProvisionJobStatus.SUCCEEDED:
      return 'SUCCEEDED';
    case RepositoryProvisionJobStatus.FAILED_RETRYABLE:
      return 'RETRYABLE_FAILED';
    case RepositoryProvisionJobStatus.FAILED_FINAL:
      return 'FAILED';
  }
}

function normalizeSafeErrorClass(
  errorCode: string | null,
): RepositoryProvisioningSafeErrorClass {
  switch (errorCode) {
    case 'GITHUB_OPERATIONS_CONFIGURATION':
    case 'GITHUB_OPERATIONS_INSTALLATION_NOT_FOUND':
    case 'GITHUB_OPERATIONS_ORGANIZATION_MISMATCH':
    case 'GITHUB_OPERATIONS_AUTHENTICATION':
    case 'GITHUB_OPERATIONS_PERMISSION':
      return 'AUTH';
    case 'GITHUB_OPERATIONS_RATE_LIMITED':
    case 'GITHUB_OPERATIONS_INVITATION_LIMIT':
      return 'RATE_LIMIT';
    case 'GITHUB_OPERATIONS_INVALID_INPUT':
    case 'REPOSITORY_PROVISION_APPLICATION_NOT_APPROVED':
    case 'REPOSITORY_PROVISION_FEATURE_DISABLED':
    case 'REPOSITORY_PROVISION_INVALID_EVENT':
    case 'REPOSITORY_PROVISION_REPOSITORY_MISMATCH':
      return 'UPSTREAM_REJECTED';
    case 'GITHUB_OPERATIONS_UPSTREAM':
    case 'GITHUB_OPERATIONS_INVALID_RESPONSE':
    case 'REPOSITORY_PROVISION_INTERNAL':
    case null:
    default:
      return 'UNKNOWN';
  }
}

function parseListAnswers(value: unknown): ApplicationListAnswers {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { applicantName: '', title: '', summary: '' };
  }
  const record = value as Record<string, unknown>;
  return {
    applicantName:
      typeof record.applicantName === 'string' ? record.applicantName : '',
    title: typeof record.title === 'string' ? record.title : '',
    summary: typeof record.summary === 'string' ? record.summary : '',
  };
}
