import {
  ApplicationStatus,
  ProgramLifecycle,
  RepositoryProvisionJobStatus,
} from '@prisma/client';
import { Injectable, Logger } from '@nestjs/common';
import {
  APPLICATION_DECISION_AUDIT_ACTIONS,
  createApplicationDecisionAuditMetadata,
} from '../audit-log/audit-log-metadata';
import { AuditLogService } from '../audit-log/audit-log.service';
import { DomainException } from '../common/error-code';
import type { ProblemDetailExtensions } from '../common/error-code';
import {
  checkApplicationTemplateVersion,
  normalizeAndValidateApplicationAnswers,
} from '../programs/application-answers.validator';
import {
  getProgramTemplate,
  PROGRAM_PARTICIPATION,
} from '../programs/program-template.registry';
import {
  APPLICATIONS_ERROR_CODES,
  ApplicationsErrorCode,
} from './applications-error-code.enum';
import type { ApplicationListQuery } from './application-list-query';
import {
  ApplicationDuplicateError,
  ApplicationsRepository,
  type ApplicationListPage,
  type CreatedApplication,
  type StaffDashboardSummary,
  RepositoryEventAlreadyExistsError,
} from './applications.repository';
import type {
  ApplicationDecisionAction,
  ApplicationDecisionResult,
} from './domain/application-decision';
import { APPLICATION_DECISION_ACTIONS } from './domain/application-decision';
import type { CreateApplicationInput } from './domain/create-application';

type ApplicationDecisionPlan =
  | {
      readonly kind: 'APPROVE';
      readonly status: typeof ApplicationStatus.APPROVED;
      readonly rejectionReason: null;
    }
  | {
      readonly kind: 'REJECT';
      readonly status: typeof ApplicationStatus.REJECTED;
      readonly rejectionReason: string;
    };

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
    );
    if (!answersResult.ok) {
      throw this.error(ApplicationsErrorCode.INVALID_ANSWERS);
    }

    const template = getProgramTemplate(program.category);
    const teamId = input.teamId;

    if (template.participation === PROGRAM_PARTICIPATION.INDIVIDUAL) {
      if (teamId !== null) {
        throw this.error(ApplicationsErrorCode.TEAM_NOT_ALLOWED);
      }
    } else if (teamId === null) {
      throw this.error(ApplicationsErrorCode.TEAM_REQUIRED);
    }

    try {
      return await this.repository.withCreateTransaction(async (store) => {
        const programLifecycle = await store.lockProgramForApply(programId);
        if (!programLifecycle) {
          throw this.error(ApplicationsErrorCode.PROGRAM_NOT_FOUND);
        }
        if (programLifecycle === ProgramLifecycle.ARCHIVED) {
          throw this.error(ApplicationsErrorCode.PROGRAM_ARCHIVED);
        }
        if (teamId !== null) {
          const team = await store.findTeamForApply(
            teamId,
            programId,
            student.id,
          );
          if (!team) {
            throw this.error(ApplicationsErrorCode.TEAM_NOT_FOUND);
          }
          if (!team.isMember) {
            throw this.error(ApplicationsErrorCode.TEAM_MEMBERSHIP_REQUIRED);
          }
          if (
            team.teamMinSize !== null &&
            team.memberCount < team.teamMinSize
          ) {
            const extensions: TeamMinimumExtensions = {
              memberCount: team.memberCount,
              teamMinSize: team.teamMinSize,
            };
            throw new DomainException(
              APPLICATIONS_ERROR_CODES[
                ApplicationsErrorCode.TEAM_MIN_SIZE_NOT_MET
              ],
              extensions,
            );
          }

          const duplicate = await store.findTeamDuplicate(programId, teamId);
          if (duplicate) {
            throw this.error(ApplicationsErrorCode.DUPLICATE_APPLICATION);
          }
        } else {
          const duplicate = await store.findPersonalDuplicate(
            programId,
            student.id,
          );
          if (duplicate) {
            throw this.error(ApplicationsErrorCode.DUPLICATE_APPLICATION);
          }
        }

        return store.createApplication({
          programId,
          applicantId: student.id,
          teamId,
          answers: answersResult.answers,
          applicationTemplateVersion: program.applicationTemplateVersion,
          isRepositoryPublicationPlanned: input.isRepositoryPublicationPlanned,
        });
      });
    } catch (error) {
      if (error instanceof DomainException) throw error;
      if (error instanceof ApplicationDuplicateError) {
        throw this.error(ApplicationsErrorCode.DUPLICATE_APPLICATION);
      }
      throw error;
    }
  }

  async listForProgram(
    programId: string,
    query: ApplicationListQuery,
  ): Promise<ApplicationListPage> {
    const program = await this.repository.findProgramById(programId);
    if (!program) {
      throw this.error(ApplicationsErrorCode.PROGRAM_NOT_FOUND);
    }
    return this.repository.listApplicationsForProgram(programId, query);
  }

  /** #117 교직원 운영 대시보드 요약 — Application 단위 집계. */
  async staffSummary(): Promise<StaffDashboardSummary> {
    return this.repository.listStaffDashboardSummary();
  }

  /**
   * `actorGithubId`는 감사 기록 전용이다(#547) — `AuditLog.actor`가 GitHub id로 연결되기
   * 때문이며, 신청 전이 자체는 계속 내부 `actorId`(User.id)로 기록한다. 응답 계약은 그대로다.
   */
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
        if (application.status !== ApplicationStatus.SUBMITTED) {
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

        let plan: ApplicationDecisionPlan;
        switch (action.action) {
          case APPLICATION_DECISION_ACTIONS.APPROVE:
            plan = {
              kind: 'APPROVE',
              status: ApplicationStatus.APPROVED,
              rejectionReason: null,
            };
            break;
          case APPLICATION_DECISION_ACTIONS.REJECT:
            plan = {
              kind: 'REJECT',
              status: ApplicationStatus.REJECTED,
              rejectionReason: action.reason,
            };
            break;
          default: {
            const exhaustiveAction: never = action;
            return exhaustiveAction;
          }
        }

        const processedAt = new Date();
        const transitioned = await store.transitionApplication({
          applicationId,
          expectedStatus: ApplicationStatus.SUBMITTED,
          nextStatus: plan.status,
          rejectionReason: plan.rejectionReason,
          processedById: actorId,
          processedAt,
        });
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

        // #547 — 승인·거절은 actor가 명확한 중요 조작이다. 전이와 같은 트랜잭션에서
        // 기록해, 판정만 커밋되고 감사 기록이 빠지는 상태를 만들지 않는다.
        // ⚠ 반려 사유 원문(`plan.rejectionReason`)은 여기 넘기지 않는다. 사유는 이미
        // `Application.rejectionReason`에 남고, 감사 원장은 append-only 트리거로
        // UPDATE·DELETE가 막혀 있어 한 번 담기면 지울 수 없다. `GET /audit-logs`가
        // metadata를 그대로 실어 보내므로 담는 순간 곧바로 노출된다.
        await this.auditLog.record(
          {
            actorGithubId,
            action:
              plan.kind === 'APPROVE'
                ? APPLICATION_DECISION_AUDIT_ACTIONS.APPLICATION_APPROVED
                : APPLICATION_DECISION_AUDIT_ACTIONS.APPLICATION_REJECTED,
            targetType: 'APPLICATION',
            targetId: applicationId,
            metadata: createApplicationDecisionAuditMetadata({
              before: { status: application.status },
              after: { status: plan.status },
            }),
          },
          store.auditLogWriter,
        );

        switch (plan.kind) {
          case 'REJECT':
            return {
              kind: 'REJECTED',
              applicationId,
              status: plan.status,
              rejectionReason: plan.rejectionReason,
            };
          case 'APPROVE': {
            if (!application.repositoryProvisioningEnabled) {
              return {
                kind: 'APPROVED',
                applicationId,
                status: plan.status,
                repositoryProvisioning: {
                  enabled: false,
                  eventId: null,
                  jobStatus: null,
                },
              };
            }
            const event = await store.createRepositoryProvisionEvent({
              applicationId,
              programId: application.programId,
              teamId: application.teamId,
              collaboratorGithubLogins: application.collaboratorGithubLogins,
              idempotencyKey,
              requestedAt: processedAt,
            });
            return {
              kind: 'APPROVED',
              applicationId,
              status: plan.status,
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

  private error(code: ApplicationsErrorCode): DomainException {
    return new DomainException(APPLICATIONS_ERROR_CODES[code]);
  }
}
