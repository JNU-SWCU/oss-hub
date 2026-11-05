import { Injectable, Logger, Inject } from '@nestjs/common';
import { APPLICATION_DECISION_ACTIONS } from './applications.config';
import {
  ApplicationDecisionCommand,
  ApplicationDecisionAction,
  ApplicationListItem,
  ApplicationRepositoryProvisioning,
  RepositoryProvisioningSafeErrorClass,
  ApplicationListAnswers,
  ApplicationsRepository,
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
  type ApplyProgramRecord,
  type UpdateStudentApplicationInput,
  StudentApplicationManagementRepository,
  type OwnedStudentApplication,
  type StudentApplicationMutationFailure,
  StudentRepositoryUrlRepository,
  type StudentRepositoryUrlContext,
  type TeamRepositoryUrlContext,
} from './team.repository';
import {
  DomainException,
  type ProblemDetailExtensions,
} from '../platform/error-code.error';
import {
  APPLICATIONS_ERROR_CODES,
  ApplicationsErrorCode,
  repositoryUrlError,
} from './applications-error-code.error';
import {
  ProgramCategory,
  ApplicationStatus,
  OutboxEventStatus,
  RepositoryConnectionMode,
  RepositoryProvisionJobStatus,
  ProgramLifecycle,
  TeamHistoryEvent,
} from '@prisma/client';
import { RepositoryProvisionEventService } from '../github/repository-provision-event.service';
import {
  RepositoryEventAlreadyExistsError,
  ApplicationDuplicateError,
  ApplicationTeamMembershipConflictError,
} from './applications.error';
import { RepositoryUrlService } from '../github/repository-url.service';
import { TEAMS_ERROR_CODES, TeamsErrorCode } from './teams-error-code.error';
import {
  CANCELLABLE_STATUSES,
  RESUBMITTABLE_STATUSES,
} from './student-application-management.config';
import { ConsentsService } from '../users/consents.service';
import { CollectionTriggerService } from '../github/collection-trigger.service';
import { GithubOperationsError } from '../github/github-app.error';
import { OwnRepositoryUrlValidationService } from '../github/own-repository-url-validation.service';
import { RepositoryProvisionFailure } from '../github/repository-provision-state.error';

@Injectable()
export class ApplicationAnswersService {
  applicationAnswerTooLongMessage(key: ApplicationAnswerKey): string {
    const limit = APPLICATION_ANSWER_MAX_LENGTHS[key];
    return `${APPLICATION_ANSWER_LABELS[key]}은(는) ${limit.toLocaleString('ko-KR')}자를 넘을 수 없습니다.`;
  }

  normalizeAndValidateApplicationAnswers(
    clientAnswers: unknown,
    applicantName: string,
    lengthMode: ApplicationAnswersLengthMode,
  ): ApplicationAnswersValidationResult {
    if (!isPlainObject(clientAnswers)) {
      return { ok: false, reason: 'INVALID_SHAPE' };
    }

    const allowedKeys = lengthMode === 'skip-length' ? READ_KEYS : CLIENT_KEYS;
    const clientKeys = Object.keys(clientAnswers).filter(
      (key) => key !== 'applicantName',
    );
    const unknownKeys = clientKeys.filter((key) => !allowedKeys.has(key));
    if (unknownKeys.length > 0) {
      return { ok: false, reason: 'UNKNOWN_KEYS', unknownKeys };
    }

    const title = clientAnswers.title;
    if (!isNonEmptyString(applicantName)) {
      const missingKeys: string[] = [];
      if (!isNonEmptyString(applicantName)) missingKeys.push('applicantName');
      return { ok: false, reason: 'MISSING_REQUIRED', missingKeys };
    }

    const answers = {
      applicantName: applicantName.trim(),
      title: isNonEmptyString(title) ? title.trim() : '',
    };

    if (lengthMode === 'enforce-length') {
      const tooLongKeys = (
        Object.keys(
          APPLICATION_ANSWER_MAX_LENGTHS,
        ) as readonly ApplicationAnswerKey[]
      ).filter(
        (key) => answers[key].length > APPLICATION_ANSWER_MAX_LENGTHS[key],
      );
      if (tooLongKeys.length > 0) {
        return { ok: false, reason: 'TOO_LONG', tooLongKeys };
      }
    }

    return { ok: true, answers };
  }

  checkApplicationTemplateVersion(
    submittedVersion: number,
    stampedVersion: number,
  ): TemplateVersionCheckResult {
    if (
      !Number.isInteger(submittedVersion) ||
      !Number.isInteger(stampedVersion) ||
      submittedVersion !== stampedVersion
    ) {
      return { ok: false, reason: 'VERSION_MISMATCH' };
    }
    return { ok: true };
  }

  applicationDecisionAction(
    input: ApplicationDecisionCommand,
  ): ApplicationDecisionAction {
    switch (input.action) {
      case APPLICATION_DECISION_ACTIONS.APPROVE:
        return { action: APPLICATION_DECISION_ACTIONS.APPROVE };
      case APPLICATION_DECISION_ACTIONS.REJECT: {
        const reason = input.reason?.trim() || null;
        return { action: APPLICATION_DECISION_ACTIONS.REJECT, reason };
      }
      case APPLICATION_DECISION_ACTIONS.REVERT:
        return { action: APPLICATION_DECISION_ACTIONS.REVERT };
      default:
        throw new DomainException(
          APPLICATIONS_ERROR_CODES[
            ApplicationsErrorCode.INVALID_DECISION_ACTION
          ],
        );
    }
  }
}

const CLIENT_KEYS = new Set(['title']);

const LEGACY_READ_KEYS = new Set(['summary']);

const READ_KEYS = new Set([...CLIENT_KEYS, ...LEGACY_READ_KEYS]);

const APPLICATION_ANSWER_LABELS = {
  title: '제목',
} as const satisfies Readonly<Record<ApplicationAnswerKey, string>>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export const APPLICATION_ANSWER_MAX_LENGTHS = {
  title: 200,
} as const;

export type ApplicationAnswerKey = keyof typeof APPLICATION_ANSWER_MAX_LENGTHS;

type ApplicationAnswersValidationFailure = {
  readonly ok: false;
  readonly reason:
    'INVALID_SHAPE' | 'UNKNOWN_KEYS' | 'MISSING_REQUIRED' | 'TOO_LONG';
  readonly unknownKeys?: readonly string[];
  readonly missingKeys?: readonly string[];
  readonly tooLongKeys?: readonly ApplicationAnswerKey[];
};

export type ApplicationAnswersLengthMode = 'enforce-length' | 'skip-length';

type ApplicationAnswersValidationSuccess = {
  readonly ok: true;
  readonly answers: ApplicationAnswers;
};

export type ApplicationAnswersValidationResult =
  ApplicationAnswersValidationSuccess | ApplicationAnswersValidationFailure;

export type TemplateVersionCheckResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'VERSION_MISMATCH' };

type ApplicationAnswers = {
  readonly applicantName: string;
  readonly title: string;
};

export const PROGRAM_PARTICIPATION = {
  TEAM: 'TEAM',
} as const;

const APPLICATION_FIELD_TYPES = {
  AUTO: 'auto',
  TEXT: 'text',
  TEXTAREA: 'textarea',
} as const;

@Injectable()
export class ProgramTemplatesService {
  getProgramTemplate(category: ProgramCategory): ProgramTemplate {
    return PROGRAM_TEMPLATES[category];
  }

  listProgramTemplates(): readonly ProgramTemplate[] {
    return Object.values(PROGRAM_TEMPLATES);
  }

  getTemplateByKey(key: string): ProgramTemplate | undefined {
    return this.listProgramTemplates().find((item) => item.key === key);
  }
}

export const V1_APPLICATION_FIELDS: readonly FieldDef[] = [
  {
    key: 'applicantName',
    type: APPLICATION_FIELD_TYPES.AUTO,
    label: '신청자',
    required: true,
  },
] as const;

function template(key: string, name: string): ProgramTemplate {
  return {
    key,
    version: 1,
    name,
    participation: PROGRAM_PARTICIPATION.TEAM,
    teamSize: { defaultMin: 1, defaultMax: 1, editable: true },
    fields: V1_APPLICATION_FIELDS,
  };
}

const PROGRAM_TEMPLATES: Readonly<Record<ProgramCategory, ProgramTemplate>> = {
  [ProgramCategory.BASIC]: template('basic', '기본 신청서'),
  [ProgramCategory.SW_VALUE_SPREAD]: template(
    'sw-value-spread',
    'SW가치확산 신청서',
  ),
  [ProgramCategory.OSS_CONTEST]: template('oss-contest', 'OSS경진대회 신청서'),
  [ProgramCategory.CAPSTONE]: template('capstone', '캡스톤 신청서'),
  [ProgramCategory.SW_CONVERGENCE]: template('sw-convergence', 'SW융합 신청서'),
  [ProgramCategory.GLOBAL_MAKERTHON]: template(
    'global-makerthon',
    '글로벌메이커톤 신청서',
  ),
  [ProgramCategory.CORPORATE_INTERNSHIP]: template(
    'corporate-internship',
    '기업인턴십 신청서',
  ),
};

export interface ProgramTemplate {
  readonly key: string;
  readonly version: number;
  readonly name: string;
  readonly participation: ProgramParticipation;
  readonly teamSize: {
    readonly defaultMin: number;
    readonly defaultMax: number;
    readonly editable: boolean;
  };
  readonly fields: readonly FieldDef[];
}

export type ProgramParticipation =
  (typeof PROGRAM_PARTICIPATION)[keyof typeof PROGRAM_PARTICIPATION];

type ApplicationFieldType =
  (typeof APPLICATION_FIELD_TYPES)[keyof typeof APPLICATION_FIELD_TYPES];

type ApplicationFieldKey = 'applicantName';

export interface FieldDef {
  readonly key: ApplicationFieldKey;
  readonly type: ApplicationFieldType;
  readonly label: string;
  readonly required: boolean;
}

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
      readonly rejectionReason: string | null;
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
  APPROVE: TeamHistoryEvent.APPROVED,
  REJECT: TeamHistoryEvent.REJECTED,
  REVERT: TeamHistoryEvent.REVERTED,
} as const satisfies Record<ApplicationDecisionPlan['kind'], TeamHistoryEvent>;

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

export interface CreateApplicationRequest {
  readonly inviteeUserIds?: readonly string[];
  readonly answers: Readonly<Record<string, unknown>>;
  readonly teamName?: string | null;
  readonly applicationTemplateVersion: number;
  readonly isRepositoryPublicationPlanned?: boolean;
}

@Injectable()
export class TeamApplicationService {
  private readonly logger = new Logger(TeamApplicationService.name);

  constructor(
    private readonly repository: ApplicationsRepository,
    private readonly repositoryUrlService: RepositoryUrlService,
    private readonly applicationAnswersService: ApplicationAnswersService,
    private readonly repositoryProvisionEventService: RepositoryProvisionEventService,
  ) {}

  private readonly parseProvisionHistoryPayload = (payload: unknown) =>
    this.repositoryProvisionEventService.parseRepositoryProvisionEvent(payload);

  createInputFromRequest(
    request: CreateApplicationRequest,
  ): CreateApplicationInput {
    const trimmedTeamName = request.teamName?.trim();

    return {
      answers: request.answers,
      inviteeUserIds: request.inviteeUserIds ?? [],
      teamName:
        trimmedTeamName !== undefined && trimmedTeamName.length > 0
          ? trimmedTeamName
          : null,
      applicationTemplateVersion: request.applicationTemplateVersion,
      isRepositoryPublicationPlanned:
        request.isRepositoryPublicationPlanned ?? true,
    };
  }

  createFromRequest(
    githubId: bigint,
    programId: string,
    request: CreateApplicationRequest,
  ): Promise<CreatedApplication> {
    return this.create(
      githubId,
      programId,
      this.createInputFromRequest(request),
    );
  }

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
    const inviteeIds = input.inviteeUserIds ?? [];
    if (
      new Set(inviteeIds).size !== inviteeIds.length ||
      inviteeIds.includes(student.id)
    ) {
      throw this.error(ApplicationsErrorCode.INVALID_INVITEES);
    }

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
        if (existingTeam)
          throw this.error(ApplicationsErrorCode.DUPLICATE_APPLICATION);
        const acceptedCount = 1;
        const memberCount = acceptedCount + inviteeIds.length;
        if (memberCount < lockedProgram.teamMinSize) {
          const extensions: TeamMinimumExtensions = {
            memberCount,
            teamMinSize: lockedProgram.teamMinSize,
          };
          throw new DomainException(
            APPLICATIONS_ERROR_CODES[
              ApplicationsErrorCode.TEAM_MIN_SIZE_NOT_MET
            ],
            extensions,
          );
        }
        if (memberCount > lockedProgram.teamMaxSize) {
          throw this.error(ApplicationsErrorCode.TEAM_MAX_SIZE_EXCEEDED);
        }
        const participants = await store.validateApplicationParticipants({
          programId,
          actorId: student.id,
          inviteeIds,
        });
        switch (participants) {
          case 'student-ineligible':
            throw this.error(ApplicationsErrorCode.STUDENT_ONLY);
          case 'invitee-ineligible':
            throw this.error(ApplicationsErrorCode.INVITEE_NOT_ELIGIBLE);
          case 'invitee-unavailable':
            throw this.error(ApplicationsErrorCode.INVITEE_UNAVAILABLE);
          case 'ok':
            break;
          default: {
            const exhaustive: never = participants;
            return exhaustive;
          }
        }
        const application = await store.createTeamWithLeader({
          programId,
          name: teamName,
          leaderId: student.id,
          answers: answersResult.answers,
          applicationTemplateVersion: lockedProgram.applicationTemplateVersion,
          isRepositoryPublicationPlanned: input.isRepositoryPublicationPlanned,
        });

        await store.createApplicationInvitations({
          teamId: application.id,
          programId,
          actorId: student.id,
          inviteeIds,
        });
        await store.appendReviewHistory({
          teamId: application.id,
          eventKind: TeamHistoryEvent.SUBMITTED,
          actorId: student.id,
          occurredAt: application.submittedAt,
          rejectionReason: null,
        });

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

  listQueryFromRequest(request: ApplicationListQuery): ApplicationListQuery {
    return {
      page: request.page,
      pageSize: request.pageSize,
      search: request.search.trim(),
      status: request.status,
      view: request.view,
    };
  }

  async listForProgramView(
    programId: string,
    request: ApplicationListQuery,
  ): Promise<
    | {
        readonly view: 'team-management';
        readonly page: TeamManagementListPage;
      }
    | { readonly view: 'default'; readonly page: ApplicationListPage }
  > {
    if (request.view === 'team-management') {
      return {
        view: 'team-management',
        page: await this.listTeamManagementForProgram(programId, request),
      };
    }
    return {
      view: 'default',
      page: await this.listForProgram(programId, request),
    };
  }

  async listForProgram(
    programId: string,
    request: ApplicationListQuery,
  ): Promise<ApplicationListPage> {
    const query = this.listQueryFromRequest(request);
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
    programId: string,
    request: ApplicationListQuery,
  ): Promise<TeamManagementListPage> {
    const query = this.listQueryFromRequest(request);
    await this.requireProgram(programId);
    return this.repository.listTeamManagementForProgram(programId, query);
  }

  private async requireProgram(programId: string): Promise<void> {
    const program = await this.repository.findProgramById(programId);
    if (!program) {
      throw this.error(ApplicationsErrorCode.PROGRAM_NOT_FOUND);
    }
  }

  async getForStaff(teamId: string): Promise<StaffApplicationDetail> {
    const [application, reviewHistory] = await Promise.all([
      this.repository.findApplicationForStaff(teamId),
      this.repository.listReviewHistory(teamId),
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

  async staffSummary(): Promise<StaffDashboardSummary> {
    return this.repository.listStaffDashboardSummary();
  }

  async decide(
    actor: { readonly id: string; readonly githubId: bigint },
    teamId: string,
    input: ApplicationDecisionCommand,
  ): Promise<ApplicationDecisionResult> {
    const actorId = actor.id;
    const action =
      this.applicationAnswersService.applicationDecisionAction(input);
    const idempotencyKey = `repository-provision:${teamId}`;
    try {
      return await this.repository.withTransaction(async (store) => {
        let application = await store.findApplicationById(teamId);
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

        if (application.teamId !== null) {
          const current = await store.findApplicationById(teamId);
          if (current === null) {
            throw this.error(ApplicationsErrorCode.APPLICATION_NOT_FOUND);
          }
          application = { ...application, participants: current.participants };
        }

        const processedAt = new Date();
        const plan = await this.resolveDecisionPlan({
          application,
          action,
          actorId,
          processedAt,
          findProvisionJob: (id) => store.findRepositoryProvisionJob(id),
        });

        if (plan.kind === 'APPROVE') {
          const teamMinSize = await store.findTeamMinSize(
            application.programId,
          );
          const memberCount =
            application.teamId === null
              ? 1
              : await store.countTeamMembers(application.teamId);
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
        }

        const transition: ApplicationTransition = {
          teamId,
          expectedStatus: plan.expectedStatus,
          nextStatus: plan.nextStatus,
          rejectionReason: plan.rejectionReason,
          processedBy: plan.processedBy,
        };
        const transitioned = await store.transitionApplication(transition);
        if (!transitioned) {
          const latest = await store.findApplicationById(teamId);
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

        await store.appendReviewHistory({
          teamId: teamId,
          eventKind: REVIEW_EVENT_BY_PLAN_KIND[plan.kind],
          actorId,
          occurredAt: processedAt,
          rejectionReason: plan.rejectionReason,
        });

        await store.createApplicationDecisionNotifications({
          teamId,
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
                teamId,
                processedAt,
                this.parseProvisionHistoryPayload,
              );
            }
            return {
              kind: 'REJECTED',
              teamId,
              status: plan.nextStatus,
              rejectionReason: plan.rejectionReason,
            };
          }
          case 'REVERT': {
            if (!provisioningCompleted) {
              await store.discardRepositoryProvisionRequest(
                teamId,
                processedAt,
                this.parseProvisionHistoryPayload,
              );
            }
            return {
              kind: 'REVERTED',
              teamId,
              status: plan.nextStatus,
            };
          }
          case 'APPROVE': {
            if (!application.repositoryProvisioningEnabled) {
              return {
                kind: 'APPROVED',
                teamId,
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
                teamId,
                status: plan.nextStatus,
                repositoryProvisioning: {
                  enabled: true,
                  eventId: existing?.id ?? null,
                  jobStatus: plan.provisionJob?.status ?? null,
                },
              };
            }

            await store.discardRepositoryProvisionRequest(
              teamId,
              processedAt,
              this.parseProvisionHistoryPayload,
            );

            const event = await store.createRepositoryProvisionEvent(
              {
                teamId,
                programId: application.programId,
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
              teamId,
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
      teamId: string,
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

  private error(code: ApplicationsErrorCode): DomainException {
    return new DomainException(APPLICATIONS_ERROR_CODES[code]);
  }

  private toApplicationListItem(
    row: ApplicationListRow,
    outbox: ApplicationListOutbox | undefined,
    job: ApplicationListProvisionJob | undefined,
  ): ApplicationListItem {
    const team = {
      id: row.id,
      name: row.name,
      memberCount: row._count.members,
    };
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
        name: row.applicant.name ?? null,
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
    const jobStatus = job.status;
    return {
      enabled,
      jobStatus,
      updatedAt: job.updatedAt,
      safeErrorClass:
        jobStatus === 'FAILED_RETRYABLE' || jobStatus === 'FAILED_FINAL'
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
        jobStatus: 'FAILED_FINAL',
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

export interface StudentApplicationView {
  readonly id: string;
  readonly programId: string;
  readonly status: ApplicationStatus;
  readonly teamId: string | null;
  readonly answers: ApplicationAnswers;
  readonly submittedAt: Date;
  readonly updatedAt: Date;
  readonly isRepositoryPublicationPlanned: boolean;

  readonly rejectionReason: string | null;

  readonly isManager: boolean;
  readonly canManage: boolean;
}

function isProgramApplicationManager(
  userId: string,
  application: { readonly teamLeaderId: string },
): boolean {
  return application.teamLeaderId === userId;
}

interface StudentApplicationContext {
  readonly studentId: string;
  readonly application: OwnedStudentApplication;
  readonly policy: ApplyProgramRecord;
  readonly isManager: boolean;
}

@Injectable()
export class StudentApplicationManagementService {
  constructor(
    private readonly repository: StudentApplicationManagementRepository,
    private readonly applicationsRepository: ApplicationsRepository,
    private readonly applicationAnswersService: ApplicationAnswersService,
  ) {}

  async getMine(
    githubId: bigint,
    programId: string,
    now: Date = new Date(),
  ): Promise<StudentApplicationView | null> {
    const context = await this.findContext(githubId, programId);
    if (!context) return null;
    const editable = this.isEditable(context.application, context.policy, now);
    return this.toView(context.application, context.isManager, editable);
  }

  async updateMine(
    githubId: bigint,
    programId: string,
    input: UpdateStudentApplicationInput,
    now: Date = new Date(),
  ): Promise<StudentApplicationView> {
    const context = await this.requireContext(githubId, programId);
    this.requireManager(context);
    this.requireMutable(
      context.application,
      context.policy,
      now,
      RESUBMITTABLE_STATUSES,
    );
    const versionCheck =
      this.applicationAnswersService.checkApplicationTemplateVersion(
        input.applicationTemplateVersion,
        context.policy.applicationTemplateVersion,
      );
    if (!versionCheck.ok) {
      throw this.error(ApplicationsErrorCode.TEMPLATE_VERSION_MISMATCH);
    }
    const answers =
      this.applicationAnswersService.normalizeAndValidateApplicationAnswers(
        input.answers,
        this.resolveApplicantName(context.application),
        'enforce-length',
      );
    if (!answers.ok) {
      if (answers.reason === 'TOO_LONG')
        throw new DomainException(
          APPLICATIONS_ERROR_CODES[ApplicationsErrorCode.ANSWER_TOO_LONG],
          {
            fieldErrors: (answers.tooLongKeys ?? []).map((key) => ({
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
    const result = await this.repository.updatePendingApplication({
      programId,
      studentId: context.studentId,
      answers: answers.answers,
      applicationTemplateVersion: input.applicationTemplateVersion,
    });
    if (result.kind !== 'updated') this.throwMutationFailure(result);
    return this.toView(result.application, true, true);
  }

  async cancelMine(
    githubId: bigint,
    programId: string,
    now: Date = new Date(),
  ): Promise<{ readonly cancelled: true }> {
    const context = await this.requireContext(githubId, programId);
    this.requireManager(context);
    this.requireMutable(
      context.application,
      context.policy,
      now,
      CANCELLABLE_STATUSES,
    );
    const result = await this.repository.deletePendingApplication({
      programId,
      studentId: context.studentId,
    });
    if (result.kind !== 'cancelled') this.throwMutationFailure(result);
    return { cancelled: true };
  }

  private async requireContext(
    githubId: bigint,
    programId: string,
  ): Promise<StudentApplicationContext> {
    const context = await this.findContext(githubId, programId);
    if (!context) {
      throw this.error(ApplicationsErrorCode.APPLICATION_NOT_FOUND);
    }
    return context;
  }

  private async findContext(
    githubId: bigint,
    programId: string,
  ): Promise<StudentApplicationContext | null> {
    const student =
      await this.applicationsRepository.findActiveStudentByGithubId(githubId);
    if (!student) throw this.error(ApplicationsErrorCode.STUDENT_ONLY);
    const [application, policy] = await Promise.all([
      this.repository.findOwnedApplication(programId, student.id),
      this.applicationsRepository.findProgramById(programId),
    ]);
    if (!policy) throw this.error(ApplicationsErrorCode.PROGRAM_NOT_FOUND);
    if (!application) return null;
    return {
      studentId: student.id,
      application,
      policy,

      isManager: isProgramApplicationManager(student.id, {
        teamLeaderId: application.teamLeaderId,
      }),
    };
  }

  private requireManager(context: StudentApplicationContext): void {
    if (!context.isManager) {
      throw this.error(ApplicationsErrorCode.APPLICATION_NOT_FOUND);
    }
  }

  private throwMutationFailure(
    failure: StudentApplicationMutationFailure,
  ): never {
    if (failure.kind === 'team-has-activity')
      throw new DomainException(
        TEAMS_ERROR_CODES[TeamsErrorCode.TEAM_HAS_ACTIVITY],
      );
    const code = {
      'program-not-found': ApplicationsErrorCode.PROGRAM_NOT_FOUND,
      'application-not-found': ApplicationsErrorCode.APPLICATION_NOT_FOUND,
      'already-decided': ApplicationsErrorCode.APPLICATION_ALREADY_DECIDED,
      'period-closed': ApplicationsErrorCode.APPLICATION_PERIOD_CLOSED,
      'template-version-mismatch':
        ApplicationsErrorCode.TEMPLATE_VERSION_MISMATCH,
    }[failure.kind];
    throw this.error(code);
  }

  private requireMutable(
    application: OwnedStudentApplication,
    policy: ApplyProgramRecord,
    now: Date,
    allowedStatuses: readonly ApplicationStatus[],
  ): void {
    if (!allowedStatuses.includes(application.status)) {
      throw this.error(ApplicationsErrorCode.APPLICATION_ALREADY_DECIDED);
    }
    if (!this.isPeriodOpen(policy, now)) {
      throw this.error(ApplicationsErrorCode.APPLICATION_PERIOD_CLOSED);
    }
  }

  private isEditable(
    application: OwnedStudentApplication,
    policy: ApplyProgramRecord,
    now: Date,
  ): boolean {
    return (
      RESUBMITTABLE_STATUSES.includes(application.status) &&
      this.isPeriodOpen(policy, now)
    );
  }

  private isPeriodOpen(policy: ApplyProgramRecord, now: Date): boolean {
    return policy.applicationStartAt <= now && now <= policy.applicationEndAt;
  }

  private toView(
    application: OwnedStudentApplication,
    isManager: boolean,
    editable: boolean,
  ): StudentApplicationView {
    const answers =
      this.applicationAnswersService.normalizeAndValidateApplicationAnswers(
        application.answers,
        this.resolveApplicantName(application),
        'skip-length',
      );
    if (!answers.ok) {
      throw this.error(ApplicationsErrorCode.INVALID_ANSWERS);
    }
    return {
      id: application.id,
      programId: application.programId,
      status: application.status,
      teamId: application.teamId,
      answers: answers.answers,
      submittedAt: application.submittedAt,
      updatedAt: application.updatedAt,
      isRepositoryPublicationPlanned:
        application.isRepositoryPublicationPlanned,
      rejectionReason: application.rejectionReason,
      isManager,
      canManage: isManager && editable,
    };
  }

  private resolveApplicantName(application: OwnedStudentApplication): string {
    return (
      application.applicant.name ?? application.applicant.nickname
    ).trim();
  }

  private error(code: ApplicationsErrorCode): DomainException {
    return new DomainException(APPLICATIONS_ERROR_CODES[code]);
  }
}

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
    @Inject(CollectionTriggerService)
    private readonly collection: Pick<
      CollectionTriggerService,
      'collectRepository'
    >,
    private readonly repositoryProvisionEventService: RepositoryProvisionEventService,
  ) {}

  canEditStudentRepositoryUrl(
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
        const { repositoryId, deletedCounts } = await store
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
        await store.historyWriter.teamHistory.create({
          data: {
            teamId: current.id,
            programId,
            actorId: current.editor.id,
            event: 'REPOSITORY_URL_CHANGED',
            source: 'APPLICATION',
            data: {
              schemaVersion: 1,
              metadata: {
                schemaVersion: 2,
                programId,
                teamId: current.id,
                programName: current.program.name,
                actorGithubLogin: current.editor.nickname,
                before: {
                  repositoryId: current.repository?.id ?? null,
                  repositoryUrl: this.url(current),
                },
                after: { repositoryId, repositoryUrl },
                ...(deletedCounts === null ? {} : { deletedCounts }),
              },
            },
          },
        });
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
      !this.canEditStudentRepositoryUrl(
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
      canEditRepositoryUrl: this.canEditStudentRepositoryUrl(
        {
          status: context.status,
          endAt: context.program.endAt,
          isManager: context.leaderId === studentId,
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
