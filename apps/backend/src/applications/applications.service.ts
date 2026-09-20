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
} from '../audit-log/audit-log-metadata';
import { AuditLogService } from '../audit-log/audit-log.service';
import { DomainException } from '../common/error-code';
import type { ProblemDetailExtensions } from '../common/error-code';
import { parseGithubRepositoryUrl } from '../common/github-repository-url';
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
type ApplicationDecisionPlan = {
  /**
   * 판정 시점의 프로비저닝 잡 스냅샷. 한 번만 읽어 계획에 싣고 아래 부수효과 분기가
   * 그것을 재사용한다 — 같은 트랜잭션 안에서 두 번 읽으면 같은 값이고, 두 번 읽는
   * 모양이 「읽은 사실로 판단했다」는 계약을 흐린다.
   */
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

/**
 * 저장소가 이미 만들어졌는가(또는 연결이 끝났는가).
 *
 * 잡이 SUCCEEDED거나 저장소 포인터가 생겼으면 완료다 — job이 아직 PENDING이더라도
 * `repositoryId`가 채워졌다면 실제 저장소가 있다. 예전에는 이 조건이 반려·되돌리기를
 * 409로 막는 잠금(APP_023)이었고, 지금은 「지우지 않고 보존한다」는 분기 조건이다.
 */
function isProvisioningCompleted(
  job: RepositoryProvisionJobSnapshot | null,
): boolean {
  if (job === null) return false;
  return (
    job.repositoryId !== null ||
    job.status === RepositoryProvisionJobStatus.SUCCEEDED
  );
}

/** 판정 종류와 이력 사건의 짝. 제출·재제출은 판정이 아니므로 여기 없다. */
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
          repositoryConnectionMode: RepositoryConnectionMode.NEW,
          repositoryUrl: null,
        });

        // 최초 제출도 판정 이력의 첫 사건이다 — 신청 생성과 같은 트랜잭션에서 쌓는다.
        // 이것이 빠지면 교직원의 이력 타임라인이 「승인」부터 시작해 언제 냈는지가 사라진다.
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

        // 상태 갱신과 같은 트랜잭션에서 판정 이력을 쌓는다. CAS가 성공한 뒤에만
        // 도달하므로 경합에서 밀린 요청은 이력을 남기지 않는다.
        await store.appendReviewHistory({
          applicationId,
          eventKind: REVIEW_EVENT_BY_PLAN_KIND[plan.kind],
          actorId,
          occurredAt: processedAt,
          rejectionReason: plan.rejectionReason,
        });

        // 세 전환 모두 학생에게 알린다 — 되돌림(→SUBMITTED)도 포함한다.
        await store.createApplicationDecisionNotifications({
          applicationId,
          programId: application.programId,
          programName: application.programName,
          recipientUserIds: application.notificationRecipientIds,
          decision: plan.nextStatus,
          decidedAt: processedAt,
        });

        // 완료된 프로비저닝은 판정을 되돌려도 거두지 않는다 — 삭제할 대상은
        // 항상 미완료(PENDING/PROCESSING) 요청뿐이다. 이미 만들어진 저장소의 job·outbox
        // 이력을 지우면 「언제 무엇이 발급됐는가」가 사라지고, 저장소 연결
        // (`GithubRepository`)은 반려를 받아도 그대로 남아야 한다(f-github-repo-survives).
        const provisioningCompleted = isProvisioningCompleted(plan.provisionJob);

        switch (plan.kind) {
          case 'REJECT': {
            if (
              plan.expectedStatus === ApplicationStatus.APPROVED &&
              !provisioningCompleted
            ) {
              // 승인을 곧바로 반려로 뒤집을 때도 되돌리기와 똑같이 승인의 부수효과를
              // 거둔다. 진행 중이던 프로비저닝 요청(outbox 이벤트 + job)을 남기면
              // 워커가 집어 간 job이 `APPLICATION_NOT_APPROVED`로 FAILED_FINAL이 되고,
              // 그 고아 job이 남은 채로 재승인 경로를 오염한다.
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
            // 되돌리기는 승인의 부수효과까지 되돌린다. 진행 중이던 프로비저닝
            // 요청(outbox 이벤트 + job)을 지우지 않으면, 워커가 이미 집어 간 job이
            // `APPLICATION_NOT_APPROVED`로 FAILED_FINAL이 되고 재승인은 기존
            // 이벤트를 재사용해 새 job을 만들지 않아 **저장소가 영영 안 만들어진다**.
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

            // 승인은 항상 **새 요청을 발행**한다. 남아 있는 미완료 요청은 먼저 지운다.
            //
            // 기존 이벤트를 재사용하던 방식은 조용히 깨진다. 컨슈머가 이벤트를 집은 뒤
            // job을 넣기 직전에 되돌리기가 끼면 고아 job이 남고, 워커가 그걸
            // `APPLICATION_NOT_APPROVED`로 FAILED_FINAL로 만든다. `claimNext`는
            // FAILED_FINAL을 다시 집지 않으므로 재사용 경로에서는 저장소가 영영
            // 만들어지지 않는다. 지우고 새로 발행하면 그 창이 닫힌다.
            //
            // 이미 저장소가 만들어진 신청의 재승인은 새 요청을 발행하지 않는다.
            // APP_023을 없애면서 승인→반려→재승인이 가능해졌고, 그때 이미 끝난
            // 프로비저닝을 다시 발행하면 같은 팀에 저장소가 두 번 만들어진다.
            // 보존된 요청의 현재 상태를 그대로 돌려준다.
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

            // 여기 도달했다는 것은 남은 요청이 미완료라는 뜻이다 — 지우고 다시 발행한다.
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
