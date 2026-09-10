import {
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
} from '../audit-log/audit-log-metadata';
import { AuditLogService } from '../audit-log/audit-log.service';
import { DomainException } from '../common/error-code';
import type { ProblemDetailExtensions } from '../common/error-code';
import { parseGithubRepositoryUrl } from '../common/github-repository-url';
import type { OwnRepositoryUrlValidationService } from '../github/service/own-repository-url-validation.service';
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
  type ApplicationListItem,
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
  RepositoryProvisionJobSnapshot,
} from './domain/application-decision';
import { APPLICATION_DECISION_ACTIONS } from './domain/application-decision';
import type { CreateApplicationInput } from './domain/create-application';

/**
 * 승인·반려는 검토 대기뿐 아니라 **반대 판정에서도 곧장** 넘어온다(#1272).
 * 교직원이 오조작을 고칠 때 되돌리기 → 재판정 두 번을 요구하지 않는다 —
 * `expectedStatus`가 출발 상태를 그대로 담아 기존 CAS 한 번으로 전이한다.
 */
type ApplicationDecisionPlan =
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

/**
 * APP_023 계약 — 프로비저닝이 끝난 승인을 푸는 모든 경로(되돌리기·승인→반려)가
 * 같은 코드와 같은 `revertBlockedReason` 필드를 쓴다. 프런트가 이 필드로 사람 말
 * 안내를 고르므로(`application-presentation.ts`) 이름을 바꾸지 않는다.
 */
interface RevertBlockedExtensions extends ProblemDetailExtensions {
  readonly revertBlockedReason: string;
  readonly latestStatus: ApplicationStatus;
}

/** 제출 시 URL 사전 검증을 늘 통과시키는 기본값 — 검증 포트를 안 넘기는 기존 호출부(단위 테스트 등)를 깨지 않는다. */
const ALWAYS_VALID_OWN_REPOSITORY_URL: Pick<
  OwnRepositoryUrlValidationService,
  'validate'
> = {
  validate: () => Promise.resolve({ kind: 'VALID' }),
};

const JOIN_CODE_ATTEMPTS = 5;

@Injectable()
export class ApplicationsService {
  private readonly logger = new Logger(ApplicationsService.name);

  constructor(
    private readonly repository: ApplicationsRepository,
    private readonly auditLog: AuditLogService,
    private readonly ownRepositoryUrlValidator: Pick<
      OwnRepositoryUrlValidationService,
      'validate'
    > = ALWAYS_VALID_OWN_REPOSITORY_URL,
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

    const repositoryConnection = this.resolveRepositoryConnection(
      program.repositoryProvisioningEnabled,
      input,
    );
    if (
      repositoryConnection.mode === RepositoryConnectionMode.OWN &&
      repositoryConnection.url !== null
    ) {
      await this.requireReachableOwnRepositoryUrl(repositoryConnection.url);
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
      // 넘친 칸을 그대로 실어 보낸다 — 하나의 뭉뚱그린 문구만 주면 학생이 무엇을 줄일지 모른다.
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
        if (existingTeam) {
          // 잠금 → 권한 → 최소 인원 → 생성 순서를 지킨다. 잠금 전에 읽은 멤버십
          // 스냅샷은 권한의 정본이 아니다 — 그 사이에 팀장이 바뀌거나 본인이 팀에서
          // 빠졌을 수 있으므로, FOR UPDATE로 잠근 **뒤의** 팀장·구성원 사실로 다시 묻는다.
          // 초대받은 팀원은 합류만 하고 따로 신청하지 않는다 — 팀의 신청은 한 건이고
          // 그 제출 권한은 팀장에게만 있다(#1269).
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
          repositoryConnectionMode: repositoryConnection.mode,
          repositoryUrl: repositoryConnection.url,
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

  private resolveRepositoryConnection(
    enabled: boolean,
    input: CreateApplicationInput,
  ): {
    readonly mode: RepositoryConnectionMode;
    readonly url: string | null;
  } {
    if (!enabled) {
      if (
        input.repositoryConnectionMode !== null ||
        input.repositoryUrl !== null
      ) {
        throw this.error(
          ApplicationsErrorCode.REPOSITORY_CONNECTION_MODE_FORBIDDEN,
        );
      }
      return { mode: RepositoryConnectionMode.NEW, url: null };
    }
    if (input.repositoryConnectionMode === null) {
      throw this.error(
        ApplicationsErrorCode.REPOSITORY_CONNECTION_MODE_REQUIRED,
      );
    }
    if (input.repositoryConnectionMode === RepositoryConnectionMode.NEW) {
      return { mode: RepositoryConnectionMode.NEW, url: null };
    }
    if (
      input.repositoryUrl === null ||
      parseGithubRepositoryUrl(input.repositoryUrl) === null
    ) {
      throw this.error(ApplicationsErrorCode.OWN_REPOSITORY_URL_REQUIRED);
    }
    return {
      mode: input.repositoryConnectionMode,
      url: input.repositoryUrl,
    };
  }

  /**
   * 제출 시점 사전 검증(#9 QA econovation 배치) — 승인 시점 편입 판정(resolveOwnGithubRepository)과
   * 같은 로직을 읽기 전용으로 먼저 물어본다. 존재하지 않거나 비공개면 지원서를 만들지 않고
   * repositoryUrl 필드 오류로 즉시 안내한다 — 승인 후 worker가 같은 이유로 실패하는 것을
   * 기다리게 하지 않는다. 새 enrollment 경로가 아니다 — 기존 판정을 제출 시점에 한 번 더 물을 뿐이다.
   */
  private async requireReachableOwnRepositoryUrl(
    repositoryUrl: string,
  ): Promise<void> {
    const result = await this.ownRepositoryUrlValidator.validate(repositoryUrl);
    if (result.kind === 'VALID') {
      return;
    }
    throw new DomainException(
      APPLICATIONS_ERROR_CODES[
        ApplicationsErrorCode.OWN_REPOSITORY_URL_UNREACHABLE
      ],
      {
        fieldErrors: [
          {
            field: 'repositoryUrl',
            code: ApplicationsErrorCode.OWN_REPOSITORY_URL_UNREACHABLE,
            message:
              APPLICATIONS_ERROR_CODES[
                ApplicationsErrorCode.OWN_REPOSITORY_URL_UNREACHABLE
              ].message,
          },
        ],
      },
    );
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

  /**
   * #722 교직원 신청 상세. 목록과 달리 programId 를 받지 않는다 — 판정(`decide`)이
   * 이미 신청 id 하나로 도달하는 계약이라, 조회만 프로그램을 요구하면 같은 자원에
   * 주소 규칙이 둘 생긴다.
   */
  async getForStaff(applicationId: string): Promise<ApplicationListItem> {
    const application =
      await this.repository.findApplicationForStaff(applicationId);
    if (!application) {
      throw this.error(ApplicationsErrorCode.APPLICATION_NOT_FOUND);
    }
    return application;
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
              // application은 이 메서드 시작에서 이미 로드해 둔 값이라(findApplicationById)
              // 스냅샷을 위한 추가 쿼리는 없다.
              programName: application.programName,
              applicantGithubLogin: application.applicantGithubLogin,
              before: { status: application.status },
              after: { status: plan.nextStatus },
            }),
          },
          store.auditLogWriter,
        );

        if (
          plan.nextStatus === ApplicationStatus.APPROVED ||
          plan.nextStatus === ApplicationStatus.REJECTED
        ) {
          await store.createApplicationDecisionNotifications({
            applicationId,
            programId: application.programId,
            programName: application.programName,
            recipientUserIds: application.notificationRecipientIds,
            decision: plan.nextStatus,
            decidedAt: processedAt,
          });
        }

        switch (plan.kind) {
          case 'REJECT': {
            if (plan.expectedStatus === ApplicationStatus.APPROVED) {
              // 승인을 곧바로 반려로 뒤집을 때도 되돌리기와 똑같이 승인의 부수효과를
              // 거둔다. 진행 중이던 프로비저닝 요청(outbox 이벤트 + job)을 남기면
              // 워커가 집어 간 job이 `APPLICATION_NOT_APPROVED`로 FAILED_FINAL이 되고,
              // 그 고아 job이 남은 채로 재승인 경로를 오염시킨다.
              // SUCCEEDED는 APP_023 가드가 이미 막았으므로 여기서 지우는 건 항상 미완료다.
              await store.discardRepositoryProvisionRequest(applicationId);
            }
            return {
              kind: 'REJECTED',
              applicationId,
              status: plan.nextStatus,
              rejectionReason: plan.rejectionReason,
            };
          }
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

            // 승인은 항상 **새 요청을 발행**한다. 남아 있는 미완료 요청은 먼저 지운다.
            //
            // 기존 이벤트를 재사용하던 방식은 조용히 깨진다. 컨슈머가 이벤트를 집은 뒤
            // job을 넣기 직전에 되돌리기가 끼면 고아 job이 남고, 워커가 그걸
            // `APPLICATION_NOT_APPROVED`로 FAILED_FINAL로 만든다. `claimNext`는
            // FAILED_FINAL을 다시 집지 않으므로 재사용 경로에서는 저장소가 영영
            // 만들어지지 않는다. 지우고 새로 발행하면 그 창이 닫힌다.
            //
            // 여기 도달했다는 것은 신청이 SUBMITTED 또는 REJECTED였다는 뜻이다.
            // 프로비저닝이 완료된 승인은 APP_023이 반려·되돌리기를 모두 막아
            // 그 둘 중 어느 상태에도 SUCCEEDED job이 따라오지 않는다 — 지우는 대상은 항상 미완료다.
            await store.discardRepositoryProvisionRequest(applicationId);

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
        // 같은 판정을 다시 보내는 것만 409다(기존 ALREADY_DECIDED 재사용).
        // REJECTED에서의 승인은 반대 판정이므로 한 번의 전이로 허용한다(#1272).
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
        // 승인을 반려로 뒤집는 것은 승인을 푸는 일이다 — 되돌리기와 똑같은
        // 완료 잠금(APP_023)을 거친다. 안 거치면 반려가 잠금을 우회하는 뒷문이 된다.
        await this.assertProvisioningNotCompleted(
          application,
          input.findProvisionJob,
        );
        return {
          kind: 'REJECT',
          expectedStatus,
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

        const expectedStatus = application.status;
        await this.assertProvisioningNotCompleted(
          application,
          input.findProvisionJob,
        );

        return {
          kind: 'REVERT',
          expectedStatus,
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

  /**
   * D4 가드 ③: NEW 프로비저닝이 완료된 승인은 풀 수 없다 — 되돌리기도, 반려로
   * 뒤집는 것도 막는다. 이미 만들어진 저장소에 대한 접근이 판정 변경 한 번으로
   * 끊기는 것을 막는 것이 이 잠금의 목적이라, 어느 방향으로 푸는지는 상관없다.
   * APPROVED가 아니면 잠금 대상이 아니고, OWN은 만든 저장소가 없어 걸지 않는다(ADR-009).
   */
  private async assertProvisioningNotCompleted(
    application: ApplicationDecisionTarget,
    findProvisionJob: (
      applicationId: string,
    ) => Promise<RepositoryProvisionJobSnapshot | null>,
  ): Promise<void> {
    if (
      application.status !== ApplicationStatus.APPROVED ||
      application.repositoryConnectionMode !== RepositoryConnectionMode.NEW
    ) {
      return;
    }
    const job = await findProvisionJob(application.id);
    // 생성된 저장소는 다음 권한 재조회에서 job이 PENDING/PROCESSING이어도 보호한다.
    if (
      job === null ||
      (job.repositoryId === null &&
        job.status !== RepositoryProvisionJobStatus.SUCCEEDED)
    ) {
      return;
    }
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
