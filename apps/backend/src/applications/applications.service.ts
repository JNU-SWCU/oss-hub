import {
  ApplicationReviewEventKind,
  ApplicationStatus,
  ProgramLifecycle,
  RepositoryConnectionMode,
  RepositoryProvisionJobStatus,
} from '@prisma/client';
import { Injectable, Logger } from '@nestjs/common';
import {
  APPLICATION_DECISION_AUDIT_ACTIONS,
  APPLICATION_SUBMITTED_AUDIT_ACTIONS,
  createApplicationDecisionAuditMetadata,
  createApplicationSubmittedAuditMetadata,
  createTeamCreatedAuditMetadata,
  TEAM_CREATED_AUDIT_ACTIONS,
} from '../audit-log/domain/audit-log-metadata';
import { AuditLogService } from '../audit-log/service/audit-log.service';
import { DomainException } from '../common/error-code';
import type { ProblemDetailExtensions } from '../common/error-code';
import { parseGithubRepositoryUrl } from '../github/domain/github-repository-url';
import {
  checkApplicationTemplateVersion,
  applicationAnswerTooLongMessage,
  normalizeAndValidateApplicationAnswers,
} from '../programs/application-answers.validator';
import {
  APPLICATIONS_ERROR_CODES,
  ApplicationsErrorCode,
} from './applications-error-code.enum';
import type { ApplicationListQuery } from './application-list-query';
import {
  ApplicationDuplicateError,
  ApplicationJoinCodeDigestConflictError,
  ApplicationTeamMembershipConflictError,
  ApplicationsRepository,
  type ApplicationListPage,
  type CreatedApplication,
  type StaffApplicationDetail,
  type StaffDashboardSummary,
  type TeamManagementListPage,
  RepositoryEventAlreadyExistsError,
} from './applications.repository';
import type {
  ApplicationDecisionAction,
  ApplicationDecisionResult,
  ApplicationDecisionTarget,
  ApplicationTransition,
  RepositoryProvisionJobSnapshot,
} from './domain/application-decision';
import { APPLICATION_DECISION_ACTIONS } from './domain/application-decision';
import type { CreateApplicationInput } from './domain/create-application';

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
  ) {}

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
    if (program.lifecycle === ProgramLifecycle.ARCHIVED) {
      throw this.error(ApplicationsErrorCode.PROGRAM_ARCHIVED);
    }

    if (now < program.applicationStartAt || now > program.applicationEndAt) {
      throw this.error(ApplicationsErrorCode.APPLICATION_PERIOD_CLOSED);
    }

    const versionCheck = checkApplicationTemplateVersion(
      input.applicationTemplateVersion,
      program.applicationTemplateVersion,
    );
    if (!versionCheck.ok) {
      throw this.error(ApplicationsErrorCode.TEMPLATE_VERSION_MISMATCH);
    }

    const applicantName = (student.name ?? student.nickname).trim();
    const answersResult = normalizeAndValidateApplicationAnswers(
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
              message: applicationAnswerTooLongMessage(key),
            })),
          },
        );
      throw this.error(ApplicationsErrorCode.INVALID_ANSWERS);
    }

    const teamName = input.teamName?.trim() || `${student.nickname}의 팀`;

    try {
      return await this.repository.withCreateTransaction(async (store) => {
        const programLifecycle = await store.lockProgramForApply(programId);
        if (!programLifecycle) {
          throw this.error(ApplicationsErrorCode.PROGRAM_NOT_FOUND);
        }
        if (programLifecycle === ProgramLifecycle.ARCHIVED) {
          throw this.error(ApplicationsErrorCode.PROGRAM_ARCHIVED);
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
        const teamMinSize = await store.findTeamMinSize(programId);
        const memberCount = existingTeam
          ? await store.countTeamMembers(existingTeam.id)
          : 1;
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
          const joinCode = this.repository.generateJoinCode();
          const joinCodeDigest =
            this.repository.computeJoinCodeDigest(joinCode);
          try {
            createdTeam = await store.createTeamWithLeader({
              programId,
              name: teamName,
              joinCodeDigest,
              leaderId: student.id,
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
          applicationTemplateVersion: program.applicationTemplateVersion,
          isRepositoryPublicationPlanned: input.isRepositoryPublicationPlanned,
          repositoryConnectionMode: RepositoryConnectionMode.NEW,
          repositoryUrl: null,
        });

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
              metadata: createTeamCreatedAuditMetadata({
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
            metadata: createApplicationSubmittedAuditMetadata({
              programName: program.name,
              teamName: applicationTeam.name,
            }),
          },
          store.auditLogWriter,
        );
        return application;
      });
    } catch (error) {
      if (error instanceof DomainException) throw error;
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
    programId: string,
    query: ApplicationListQuery,
  ): Promise<ApplicationListPage> {
    await this.requireProgram(programId);
    return this.repository.listApplicationsForProgram(programId, query);
  }

  async listTeamManagementForProgram(
    programId: string,
    query: ApplicationListQuery,
  ): Promise<TeamManagementListPage> {
    await this.requireProgram(programId);
    return this.repository.listTeamManagementForProgram(programId, query);
  }

  private async requireProgram(programId: string): Promise<void> {
    const program = await this.repository.findProgramById(programId);
    if (!program) {
      throw this.error(ApplicationsErrorCode.PROGRAM_NOT_FOUND);
    }
  }

  async getForStaff(applicationId: string): Promise<StaffApplicationDetail> {
    const [application, reviewHistory] = await Promise.all([
      this.repository.findApplicationForStaff(applicationId),
      this.repository.listReviewHistory(applicationId),
    ]);
    if (!application) {
      throw this.error(ApplicationsErrorCode.APPLICATION_NOT_FOUND);
    }
    return { application, reviewHistory };
  }

  async staffSummary(): Promise<StaffDashboardSummary> {
    return this.repository.listStaffDashboardSummary();
  }

  async decide(
    actorId: string,
    applicationId: string,
    actorGithubId: bigint,
    action: ApplicationDecisionAction,
  ): Promise<ApplicationDecisionResult> {
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
            metadata: createApplicationDecisionAuditMetadata({
              programName: application.programName,
              applicantGithubLogin: application.applicantGithubLogin,
              before: { status: application.status },
              after: { status: plan.nextStatus },
            }),
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
          recipientUserIds: application.notificationRecipientIds,
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
            );

            const event = await store.createRepositoryProvisionEvent({
              applicationId,
              programId: application.programId,
              teamId: application.teamId,
              collaboratorGithubLogins: application.collaboratorGithubLogins,
              repositoryConnectionMode: application.repositoryConnectionMode,
              repositoryUrl: application.repositoryUrl,
              idempotencyKey,
              requestedAt: processedAt,
            });
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
            parseGithubRepositoryUrl(application.repositoryUrl) === null)
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
}
