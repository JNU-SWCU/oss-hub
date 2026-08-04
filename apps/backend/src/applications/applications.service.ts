import {
  ApplicationStatus,
  ProgramLifecycle,
  RepositoryConnectionMode,
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
  type StaffDashboardSummary,
  RepositoryEventAlreadyExistsError,
} from './applications.repository';
import type {
  ApplicationDecisionAction,
  ApplicationDecisionResult,
  ApplicationDecisionTarget,
  ApplicationTransition,
} from './domain/application-decision';
import { APPLICATION_DECISION_ACTIONS } from './domain/application-decision';
import type { CreateApplicationInput } from './domain/create-application';

type ApplicationDecisionPlan =
  | {
      readonly kind: 'APPROVE';
      readonly expectedStatus: typeof ApplicationStatus.SUBMITTED;
      readonly nextStatus: typeof ApplicationStatus.APPROVED;
      readonly rejectionReason: null;
      readonly processedBy: { readonly id: string; readonly at: Date };
    }
  | {
      readonly kind: 'REJECT';
      readonly expectedStatus: typeof ApplicationStatus.SUBMITTED;
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

interface RevertBlockedExtensions extends ProblemDetailExtensions {
  readonly revertBlockedReason: string;
  readonly latestStatus: ApplicationStatus;
}

const JOIN_CODE_ATTEMPTS = 5;

/**
 * 프로비저닝 "완료" = RepositoryProvisionJob.status === SUCCEEDED.
 * FAILED_* 는 미완료(재시도/최종실패)로 보고 되돌리기를 허용한다.
 * Repository 레코드 존재만으로는 판정하지 않는다 — job이 SUCCEEDED일 때만
 * worker가 repositoryId를 붙이지만, 잠금의 정본은 job status다.
 */
function isProvisioningCompleted(
  status: RepositoryProvisionJobStatus | undefined,
): boolean {
  return status === RepositoryProvisionJobStatus.SUCCEEDED;
}

function isHttpsUrl(value: string): boolean {
  if (value.length === 0 || !URL.canParse(value)) {
    return false;
  }
  return new URL(value).protocol === 'https:';
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

    // 팀 이름은 공개 아카이브의 표시명으로 흘러간다(`public-project-response.dto.ts`).
    // 실명(`student.name`)을 기본값으로 쓰면 무인증 공개 endpoint에 실명이 노출되므로
    // GitHub 닉네임만 쓴다 — 신청서 답안의 `applicantName`과 다른 값인 게 의도다.
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

        // 이 프로그램에 이미 팀이 있으면 그 팀으로 신청한다. 없으면 1인 팀을 만든다.
        // 재사용하지 않으면 `TeamMember @@unique([programId, userId])`에 걸려
        // 팀을 먼저 만든 학생이 영영 신청하지 못한다.
        const existingTeam = await store.findExistingTeamMembership(
          programId,
          student.id,
        );
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

        let teamId: string | null = existingTeam?.id ?? null;
        for (
          let attempt = 0;
          teamId === null && attempt < JOIN_CODE_ATTEMPTS;
          attempt += 1
        ) {
          const joinCode = this.repository.generateJoinCode();
          const joinCodeDigest =
            this.repository.computeJoinCodeDigest(joinCode);
          try {
            const team = await store.createTeamWithLeader({
              programId,
              name: teamName,
              joinCodeDigest,
              leaderId: student.id,
            });
            teamId = team.id;
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
        if (teamId === null) {
          throw new Error('join code digest collision retries exhausted');
        }

        return store.createApplication({
          programId,
          applicantId: student.id,
          teamId,
          answers: answersResult.answers,
          applicationTemplateVersion: program.applicationTemplateVersion,
          isRepositoryPublicationPlanned: input.isRepositoryPublicationPlanned,
          repositoryConnectionMode: input.repositoryConnectionMode,
          repositoryUrl: input.repositoryUrl,
        });
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

        // #547 — 승인·거절·되돌리기는 actor가 명확한 중요 조작이다. 전이와 같은
        // 트랜잭션에서 기록해, 판정만 커밋되고 감사 기록이 빠지는 상태를 만들지 않는다.
        // ⚠ 반려 사유 원문(`plan.rejectionReason`)은 여기 넘기지 않는다. 사유는 이미
        // `Application.rejectionReason`에 남고, 감사 원장은 append-only 트리거로
        // UPDATE·DELETE가 막혀 있어 한 번 담기면 지울 수 없다. `GET /audit-logs`가
        // metadata를 그대로 실어 보내므로 담는 순간 곧바로 노출된다.
        await this.auditLog.record(
          {
            actorGithubId,
            action: this.auditActionFor(plan.kind),
            targetType: 'APPLICATION',
            targetId: applicationId,
            metadata: createApplicationDecisionAuditMetadata({
              before: { status: application.status },
              after: { status: plan.nextStatus },
            }),
          },
          store.auditLogWriter,
        );

        switch (plan.kind) {
          case 'REJECT':
            return {
              kind: 'REJECTED',
              applicationId,
              status: plan.nextStatus,
              rejectionReason: plan.rejectionReason,
            };
          case 'REVERT': {
            // 되돌리기는 승인의 부수효과까지 되돌린다. 진행 중이던 프로비저닝
            // 요청(outbox 이벤트 + job)을 지우지 않으면, 워커가 이미 집어 간 job이
            // `APPLICATION_NOT_APPROVED`로 FAILED_FINAL이 되고 재승인은 기존
            // 이벤트를 재사용해 새 job을 만들지 않아 **저장소가 영영 안 만들어진다**.
            // 가드가 SUCCEEDED를 이미 막았으므로 여기서 지우는 것은 항상 미완료 건이다.
            await store.discardRepositoryProvisionRequest(applicationId);
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

            // 멱등키 `repository-provision:${applicationId}` 충돌이 구조적으로 불가능한 이유:
            // 승인 되돌리기는 프로비저닝이 SUCCEEDED가 아닐 때만 허용된다. SUCCEEDED면
            // REVERT가 409로 잠기므로 APPROVED→SUBMITTED→재승인 경로 자체가 열리지 않는다.
            // 미완료(PENDING/PROCESSING/FAILED_*) 상태에서 되돌린 뒤 재승인하면 같은
            // 멱등키의 기존 outbox 이벤트가 이미 있을 수 있으므로, 새 이벤트를 만들지 않고
            // 기존 eventId를 재사용한다. 따라서 P2002 unique 충돌 분기는 재승인 정상 경로에서
            // 발생하지 않는다(동시 이중 승인 CAS는 기존 APPLICATION_ALREADY_DECIDED로 막힘).
            const existingEvent =
              await store.findRepositoryProvisionEvent(idempotencyKey);
            if (existingEvent) {
              const job = await store.findRepositoryProvisionJob(applicationId);
              return {
                kind: 'APPROVED',
                applicationId,
                status: plan.nextStatus,
                repositoryProvisioning: {
                  enabled: true,
                  eventId: existingEvent.id,
                  jobStatus:
                    job?.status ?? RepositoryProvisionJobStatus.PENDING,
                },
              };
            }

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
    ) => Promise<{ status: RepositoryProvisionJobStatus } | null>;
  }): Promise<ApplicationDecisionPlan> {
    const { application, action, actorId, processedAt } = input;

    switch (action.action) {
      case APPLICATION_DECISION_ACTIONS.APPROVE: {
        // D4 가드 ①: 이미 APPROVED면 중복 승인 409 (기존 ALREADY_DECIDED 재사용).
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
        // D4 가드 ②: OWN인데 repositoryUrl 없거나 https가 아니면 400.
        if (
          application.repositoryConnectionMode ===
            RepositoryConnectionMode.OWN &&
          (application.repositoryUrl === null ||
            !isHttpsUrl(application.repositoryUrl))
        ) {
          throw this.error(ApplicationsErrorCode.OWN_REPOSITORY_URL_REQUIRED);
        }
        return {
          kind: 'APPROVE',
          expectedStatus: ApplicationStatus.SUBMITTED,
          nextStatus: ApplicationStatus.APPROVED,
          rejectionReason: null,
          processedBy: { id: actorId, at: processedAt },
        };
      }
      case APPLICATION_DECISION_ACTIONS.REJECT: {
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
        return {
          kind: 'REJECT',
          expectedStatus: ApplicationStatus.SUBMITTED,
          nextStatus: ApplicationStatus.REJECTED,
          rejectionReason: action.reason,
          processedBy: { id: actorId, at: processedAt },
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

        // D4 가드 ③: 완료된 프로비저닝의 승인 되돌리기 409 + revertBlockedReason.
        if (application.status === ApplicationStatus.APPROVED) {
          const job = await input.findProvisionJob(application.id);
          if (isProvisioningCompleted(job?.status)) {
            const extensions: RevertBlockedExtensions = {
              latestStatus: application.status,
              revertBlockedReason:
                'repository provision already succeeded; undo is locked to protect the provisioned repository',
            };
            throw new DomainException(
              APPLICATIONS_ERROR_CODES[
                ApplicationsErrorCode.APPLICATION_REVERT_BLOCKED
              ],
              extensions,
            );
          }
        }

        return {
          kind: 'REVERT',
          expectedStatus: application.status,
          nextStatus: ApplicationStatus.SUBMITTED,
          rejectionReason: null,
          processedBy: 'preserve',
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
