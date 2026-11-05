import { HTTP_AUTH_KINDS } from '../platform/auth.config';
import { type OptionalSessionRequest } from '../auth/http-auth.types';
import {
  ProgramViewerService,
  type ProgramViewer,
  ProgramViewerRole,
} from './program-viewer.service';
import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import {
  ApplicationStatus,
  SubmissionStatus,
  type ProgramTrackType,
  type ProgramLifecycle,
  ProgramCategory,
} from '@prisma/client';
import {
  DomainException,
  type ProblemDetailExtensions,
} from '../platform/error-code.error';
import { PROGRAM_READ_ERROR_CODES } from './program-read-error-code.error';
import {
  ProgramsRepository,
  ProgramListRecord,
  type ProgramStatusCounts,
  ProgramAuthoringRepository,
  type ProgramAuthoringTransactionStore,
  ProgramLifecycleRepository,
  ProgramPurgeDeletedCounts,
  type ProgramDeletionScopeCounts,
} from './programs.repository';
import { MILESTONE_NOT_SUBMITTED } from './milestone-completion.config';
import { type ProgramListQuery } from './program-list-status-filter.repository';
import { type SubmissionCompletionTargetRow } from './submission-completion.config';
import { MilestoneCompletionService } from './milestone-completion.service';
import { ProgramCoverUrlService } from './program-cover-url.service';
import { ProgramScheduleService } from './program-schedule.service';
import {
  ProgramTemplatesService,
  PROGRAM_PARTICIPATION,
} from './team-application.service';
import {
  ProgramAuthoringUploadTokenError,
  ProgramAuthoringAttachmentRaceError,
  ProgramAuthoringIdempotencyConflictError,
  ProgramAuthoringIdempotencyRaceError,
} from './program-authoring.error';
import {
  ProgramErrorCode,
  PROGRAM_ERROR_CODES,
} from './program-error-code.error';
import { PROGRAM_NOTICE_ERRORS } from './program-notice-error-code.error';
import {
  ProgramNoticeFetchClient,
  type ProgramNoticePreview,
} from './program-notice-fetch.client';
import { ProgramHistoryRepository } from './programs.repository';
import { ProgramAuthoringUploadTransactionRepository } from './files.repository';
import {
  type ProgramAuthoringRequest,
  ProgramAuthoringPlan,
  type ProgramAuthoringMilestonePlan,
  type ProgramAuthoringDocumentPlan,
  type ProgramAuthoringProgram,
} from './files.config';
import {
  type ProgramAuthoringValidationIssue,
  ProgramAuthoringValidationError,
} from './program-authoring-validation.error';
import { createHash } from 'node:crypto';
import { HistoryMetadataService } from '../platform/history-metadata.service';
import { ProgramAuthoringUploadService } from './files.service';
import { PrismaSerializationRetryRepository } from '../platform/prisma-serialization-retry.repository';

export interface ProgramListItemNote {
  readonly text: string;
  readonly icon?: 'team';
}
export interface ProgramListPageItem extends PersonalizedProgramListItem {
  readonly coverImageUrl: string | null;
}
export interface PersonalizedProgramListItem extends ProgramListRecord {
  readonly note?: ProgramListItemNote;
  readonly viewerApplicationStatus?: ApplicationStatus;
  readonly applicationCount?: number;
  readonly pendingApplicationCount?: number;
}
export interface ProgramListPage {
  readonly items: readonly ProgramListPageItem[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}
type ViewerSubmissionStatusResult = SubmissionStatus | 'NOT_SUBMITTED' | null;
export interface ApplicationSubmissionSummaryResult {
  readonly notSubmitted: number;
  readonly submitted: number;
  readonly approved: number;
  readonly changesRequested: number;
  readonly rejected: number;
  readonly total: number;
}
interface ProgramMilestoneResult {
  readonly id: string;
  readonly name: string;
  readonly startAt: Date;
  readonly dueAt: Date;
  readonly dDay: number;
  readonly deadlineLabel: string;
  readonly description: string | null;
  readonly submissionItemCount: number;
  readonly viewerSubmissionStatus: ViewerSubmissionStatusResult;
  readonly applicationSubmissionSummary: ApplicationSubmissionSummaryResult | null;
}
export interface ProgramDetailResult {
  readonly teamMinSize: number;
  readonly teamMaxSize: number;
  readonly coverImageUrl: string | null;
  readonly id: string;
  readonly name: string;
  readonly organizer: string;
  readonly trackType: ProgramTrackType | null;
  readonly applicationTemplateKey: string;
  readonly lifecycle: ProgramLifecycle;
  readonly description: string;
  readonly repositoryProvisioningEnabled: boolean;
  readonly applicationPeriod: {
    readonly startsAt: Date;
    readonly endsAt: Date;
  };
  readonly operatingPeriod: {
    readonly startsAt: Date;
    readonly endsAt: Date;
  };
  readonly viewer: {
    readonly role: ProgramViewerRole;
    readonly applicationStatus: ApplicationStatus | null;
  };
  readonly milestones: readonly ProgramMilestoneResult[];
}
type SubmissionRecord = {
  readonly milestoneId: string;
  readonly status: SubmissionStatus;
};
type DocumentSubmissionRecord = {
  readonly milestoneDocumentId: string;
  readonly status: SubmissionStatus;
};
const ANONYMOUS_VIEWER: ProgramViewer = {
  githubId: null,
  userId: null,
  role: null,
};
const STUDENT_APPLICATION_STATUS_NOTE: Readonly<
  Record<ApplicationStatus, string>
> = {
  SUBMITTED: '지원서 제출됨 · 교직원 승인을 기다립니다',
  APPROVED: '축하합니다, 참가가 확정되었습니다',
  REJECTED: '아쉽지만 이번에는 함께하지 못합니다',
};
const EMPTY_SUMMARY = {
  notSubmitted: 0,
  submitted: 0,
  approved: 0,
  changesRequested: 0,
  rejected: 0,
  total: 0,
} as const satisfies ApplicationSubmissionSummaryResult;
@Injectable()
export class ProgramsService {
  constructor(
    private readonly repository: ProgramsRepository,
    private readonly milestoneCompletionService: MilestoneCompletionService,
    private readonly programCoverUrlService: ProgramCoverUrlService,
    private readonly programScheduleService: ProgramScheduleService,
    private readonly programTemplatesService: ProgramTemplatesService,
    private readonly programViewerService: ProgramViewerService,
  ) {}
  private async findStudentApplicationAxes(programId: string, userId: string) {
    const application = await this.repository.findStudentApplication(
      programId,
      userId,
    );
    return application && this.toTargetSubmissionAxes(application);
  }
  private toTargetSubmissionAxes<
    T extends {
      readonly milestoneDocumentSubmissions: readonly SubmissionCompletionTargetRow[];
    },
  >(application: T) {
    const { submissions, documentSubmissions } =
      this.milestoneCompletionService.projectSubmissionCompletionTargets(
        application.milestoneDocumentSubmissions,
      );
    return {
      ...application,
      submissions,
      milestoneDocumentSubmissions: documentSubmissions,
    };
  }
  listQueryFromRequest(request: ProgramListQuery): ProgramListQuery {
    return {
      page: request.page,
      pageSize: request.pageSize,
      search: request.search.trim(),
      status: request.status,
      year: request.year,
      sort: request.sort,
      direction: request.direction,
    };
  }
  async listFromRequest(
    request: ProgramListQuery,
    auth: OptionalSessionRequest['auth'],
  ): Promise<ProgramListPage> {
    const githubId =
      auth.kind === HTTP_AUTH_KINDS.AUTHENTICATED
        ? auth.principal.githubId
        : null;
    const viewer = await this.programViewerService.fromGithubId(githubId);
    return this.list(this.listQueryFromRequest(request), viewer);
  }
  async detailForGithubId(
    programId: string,
    githubId: bigint,
    request: {
      readonly view?: string;
    },
  ): Promise<ProgramDetailResult> {
    void request;
    return this.detail(
      programId,
      await this.programViewerService.fromGithubId(githubId),
    );
  }
  async list(
    query: ProgramListQuery,
    viewer: ProgramViewer = ANONYMOUS_VIEWER,
    now = new Date(),
  ): Promise<ProgramListPage> {
    const [rawItems, totalItems] = await this.repository.listPrograms(
      query,
      now,
    );
    return {
      items: (await this.personalize(rawItems, viewer)).map((item) => ({
        ...item,
        coverImageUrl: this.programCoverUrlService.programCoverImageUrl(
          item.id,
          item.coverId,
          item.coverExternalImageUrl,
        ),
      })),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
    };
  }
  private async personalize(
    items: readonly ProgramListRecord[],
    viewer: ProgramViewer,
  ): Promise<readonly PersonalizedProgramListItem[]> {
    if (items.length === 0 || !viewer.userId) return items;
    if (viewer.role === 'STUDENT') {
      const programIds = items.map((item) => item.id);
      const statuses = await this.repository.findViewerApplicationStatuses(
        programIds,
        viewer.userId,
      );
      return items.map((item) => {
        const status = statuses.get(item.id);
        if (!status) return item;
        return {
          ...item,
          viewerApplicationStatus: status,
          note: this.noteWithTeamIcon(
            STUDENT_APPLICATION_STATUS_NOTE[status],
            item,
          ),
        };
      });
    }
    if (viewer.role === 'STAFF') {
      const programIds = items.map((item) => item.id);
      const counts =
        await this.repository.countApplicationsByProgram(programIds);
      return items.map((item) => {
        const bucket = counts.get(item.id) ?? { total: 0, pending: 0 };
        const text =
          bucket.pending > 0
            ? `지원 ${bucket.total}건 · 승인 대기 ${bucket.pending}건`
            : `지원 ${bucket.total}건`;
        return {
          ...item,
          applicationCount: bucket.total,
          pendingApplicationCount: bucket.pending,
          note: this.noteWithTeamIcon(text, item),
        };
      });
    }
    return items;
  }
  async statusCounts(now = new Date()): Promise<ProgramStatusCounts> {
    return this.repository.countProgramsByStatus(now);
  }
  async endedYears(now = new Date()): Promise<readonly number[]> {
    return this.repository.findEndedYears(now);
  }
  async detail(
    programId: string,
    viewer: ProgramViewer,
    now: Date = new Date(),
  ): Promise<ProgramDetailResult> {
    try {
      const program = await this.repository.findProgramDetail(programId);
      if (!program)
        throw new DomainException(PROGRAM_READ_ERROR_CODES.NOT_FOUND);
      const studentApplication =
        viewer.role === 'STUDENT' && viewer.userId
          ? await this.findStudentApplicationAxes(programId, viewer.userId)
          : null;
      const staffApplications =
        viewer.role === 'STAFF'
          ? (await this.repository.findApprovedApplications(programId)).map(
              (application) => this.toTargetSubmissionAxes(application),
            )
          : null;
      return {
        id: program.id,
        coverImageUrl: this.programCoverUrlService.programCoverImageUrl(
          program.id,
          program.coverFileId,
          program.coverImageUrl,
        ),
        name: program.name,
        organizer: program.organizer,
        trackType: program.trackType,
        applicationTemplateKey: program.applicationTemplateKey,
        teamMinSize: program.teamMinSize,
        teamMaxSize: program.teamMaxSize,
        lifecycle: program.lifecycle,
        description: program.description,
        repositoryProvisioningEnabled: program.repositoryProvisioningEnabled,
        applicationPeriod: {
          startsAt: program.applicationStartAt,
          endsAt: program.applicationEndAt,
        },
        operatingPeriod: {
          startsAt: program.startAt,
          endsAt: program.endAt,
        },
        viewer: {
          role: viewer.role,
          applicationStatus: studentApplication?.status ?? null,
        },
        milestones: program.milestones.map((milestone) => {
          const deadline = this.programScheduleService.programDeadline(
            milestone.dueAt,
            now,
          );
          return {
            id: milestone.id,
            name: milestone.name,
            startAt: milestone.startAt,
            dueAt: milestone.dueAt,
            dDay: deadline.dDay,
            deadlineLabel: deadline.label,
            description: milestone.instructions,
            submissionItemCount: milestone._count.documents,
            viewerSubmissionStatus:
              milestone._count.documents > 0 && studentApplication
                ? this.milestoneStatusFor(
                    milestone,
                    studentApplication.submissions,
                    studentApplication.milestoneDocumentSubmissions,
                  )
                : null,
            applicationSubmissionSummary:
              milestone._count.documents > 0 && staffApplications
                ? this.summaryForMilestone(milestone, staffApplications)
                : null,
          };
        }),
      };
    } catch (error: unknown) {
      if (error instanceof DomainException) throw error;
      throw new DomainException(PROGRAM_READ_ERROR_CODES.DETAIL_LOAD_FAILED);
    }
  }
  private summaryForMilestone(
    milestone: {
      readonly id: string;
      readonly documents: readonly {
        readonly id: string;
      }[];
    },
    applications: readonly {
      readonly submissions: readonly SubmissionRecord[];
      readonly milestoneDocumentSubmissions: readonly DocumentSubmissionRecord[];
    }[],
  ): ApplicationSubmissionSummaryResult {
    const summary = { ...EMPTY_SUMMARY, total: applications.length };
    for (const application of applications) {
      const status = this.milestoneStatusFor(
        milestone,
        application.submissions,
        application.milestoneDocumentSubmissions,
      );
      if (status === MILESTONE_NOT_SUBMITTED) summary.notSubmitted += 1;
      else if (status === SubmissionStatus.SUBMITTED) summary.submitted += 1;
      else if (status === SubmissionStatus.APPROVED) summary.approved += 1;
      else if (status === SubmissionStatus.CHANGES_REQUESTED)
        summary.changesRequested += 1;
      else summary.rejected += 1;
    }
    return summary;
  }
  private milestoneStatusFor(
    milestone: {
      readonly id: string;
      readonly documents: readonly {
        readonly id: string;
      }[];
    },
    submissions: readonly SubmissionRecord[],
    documentSubmissions: readonly DocumentSubmissionRecord[],
  ) {
    return this.milestoneCompletionService.milestoneCompletionStatus({
      submissionAxisInUse: false,
      requiredDocumentStatuses: milestone.documents.map(
        (document) =>
          documentSubmissions.find(
            (submission) => submission.milestoneDocumentId === document.id,
          )?.status ?? null,
      ),
      submissionStatus:
        submissions.find(
          (submission) => submission.milestoneId === milestone.id,
        )?.status ?? null,
    });
  }
  private isTeamProgram(item: ProgramListRecord): boolean {
    const template = this.programTemplatesService.getTemplateByKey(
      item.applicationTemplateKey,
    );
    return template?.participation === PROGRAM_PARTICIPATION.TEAM;
  }
  private noteWithTeamIcon(
    text: string,
    item: ProgramListRecord,
  ): ProgramListItemNote {
    return this.isTeamProgram(item) ? { text, icon: 'team' } : { text };
  }
}
const MAX_MILESTONES = 50;
const MAX_DOCUMENTS_PER_MILESTONE = 20;
const MAX_DOCUMENTS_PER_PROGRAM = 100;
function documentPlan(
  document: ProgramAuthoringRequest['milestones'][number]['documents'][number],
  path: string,
  sortOrder: number,
  issues: ProgramAuthoringValidationIssue[],
  seenUploadIds: Set<string>,
  uploadTokenIds: string[],
): ProgramAuthoringDocumentPlan {
  const templateUploadId = requiredString(
    document.templateUploadId ?? '',
    `${path}.templateUploadId`,
    issues,
  );
  if (templateUploadId.length > 0) {
    if (seenUploadIds.has(templateUploadId)) {
      issues.push({
        path: `${path}.templateUploadId`,
        code: 'DUPLICATE_UPLOAD_TOKEN',
      });
    } else {
      seenUploadIds.add(templateUploadId);
      uploadTokenIds.push(templateUploadId);
    }
  }
  return {
    name: requiredString(document.name, `${path}.name`, issues),
    required: document.required,
    sortOrder,
    templateUploadId,
  };
}
function requiredString(
  value: string,
  path: string,
  issues: ProgramAuthoringValidationIssue[],
): string {
  const normalized = value.trim();
  if (normalized.length === 0) issues.push({ path, code: 'REQUIRED' });
  return normalized;
}
function optionalString(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? '';
  return normalized.length > 0 ? normalized : null;
}
function isoDate(
  value: string,
  path: string,
  issues: ProgramAuthoringValidationIssue[],
): Date | null {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    issues.push({ path, code: 'INVALID_DATE' });
    return null;
  }
  return parsed;
}
@Injectable()
export class ProgramNoticePreviewService {
  private active = 0;
  private attempts: {
    readonly actorId: string;
    readonly at: number;
  }[] = [];
  constructor(private readonly client: ProgramNoticeFetchClient) {}
  async preview(actorId: string, input: string): Promise<ProgramNoticePreview> {
    const source = this.client.parseProgramNoticeUrl(input);
    const now = Date.now();
    this.attempts = this.attempts.filter((attempt) => attempt.at > now - 60000);
    if (
      this.active >= 4 ||
      this.attempts.length >= 60 ||
      this.attempts.filter((attempt) => attempt.actorId === actorId).length >= 6
    )
      throw new DomainException(PROGRAM_NOTICE_ERRORS.RATE_LIMITED);
    this.attempts.push({ actorId, at: now });
    this.active++;
    try {
      return this.client.extractProgramNotice(
        await this.client.read(source),
        source,
      );
    } finally {
      this.active--;
    }
  }
}
type ProgramAuthoringStore = Pick<
  ProgramAuthoringRepository,
  'findReplay' | 'withTransaction'
>;
@Injectable()
export class ProgramAuthoringService {
  constructor(
    @Inject(ProgramAuthoringRepository)
    private readonly repository: ProgramAuthoringStore,
    private readonly programHistory: ProgramHistoryRepository,
    private readonly historyMetadataService: HistoryMetadataService,
    private readonly programScheduleService: ProgramScheduleService,
    private readonly programTemplatesService: ProgramTemplatesService,
    private readonly programAuthoringUploadService: ProgramAuthoringUploadService,
    private readonly programAuthoringUploadTransactionRepository: ProgramAuthoringUploadTransactionRepository,
  ) {}
  async createFromRequest(
    actor: {
      readonly id: string;
      readonly githubId: bigint;
    },
    idempotencyKey: string | undefined,
    request: ProgramAuthoringRequest,
  ): Promise<ProgramAuthoringProgram> {
    if (idempotencyKey === undefined || idempotencyKey.trim().length === 0) {
      throw new BadRequestException('A valid idempotency key is required.');
    }
    try {
      return await this.create(actor, idempotencyKey, request);
    } catch (error) {
      if (error instanceof ProgramAuthoringIdempotencyConflictError) {
        const extensions: ProblemDetailExtensions & {
          readonly existingProgramId: string;
        } = { existingProgramId: error.existingProgramId };
        throw new DomainException(
          PROGRAM_ERROR_CODES[ProgramErrorCode.AUTHORING_REQUEST_CONFLICT],
          extensions,
        );
      }
      if (
        error instanceof ProgramAuthoringValidationError ||
        error instanceof ProgramAuthoringUploadTokenError
      ) {
        throw new BadRequestException('The authoring request is invalid.');
      }
      throw error;
    }
  }
  async create(
    actor: {
      readonly id: string;
      readonly githubId: bigint;
    },
    idempotencyKey: string,
    request: ProgramAuthoringRequest,
  ): Promise<ProgramAuthoringProgram> {
    const actorId = actor.id;
    const plan = this.buildProgramAuthoringPlan(request);
    const payloadHash = this.hashProgramAuthoringPayload(plan);
    const existing = await this.repository.findReplay(actorId, idempotencyKey);
    if (existing !== null)
      return replayOrConflict(existing, payloadHash, actorId, idempotencyKey);
    try {
      return await this.repository.withTransaction((store) =>
        this.createInTransaction(
          store,
          actor.githubId,
          actorId,
          idempotencyKey,
          payloadHash,
          plan,
        ),
      );
    } catch (error) {
      if (!(error instanceof ProgramAuthoringIdempotencyRaceError)) throw error;
      const replay = await this.repository.findReplay(actorId, idempotencyKey);
      if (replay === null) throw error;
      return replayOrConflict(replay, payloadHash, actorId, idempotencyKey);
    }
  }
  private async createInTransaction(
    store: ProgramAuthoringTransactionStore,
    githubId: bigint,
    actorId: string,
    idempotencyKey: string,
    payloadHash: string,
    plan: ProgramAuthoringPlan,
  ): Promise<ProgramAuthoringProgram> {
    const uploads = await store.lockUploads(plan.uploadTokenIds);
    this.programAuthoringUploadTransactionRepository.assertAttachableProgramAuthoringUploads(
      actorId,
      plan.uploadTokenIds,
      uploads,
    );
    for (const upload of uploads) {
      if (upload.id === plan.coverUploadId)
        this.programAuthoringUploadService.assertProgramCoverUpload(upload);
      else
        this.programAuthoringUploadService.assertProgramTemplateUpload(upload);
    }
    const cover = uploads.find(({ id }) => id === plan.coverUploadId);
    const program =
      plan.externalCover !== undefined
        ? await store.createProgram(plan.program, {
            externalCover: plan.externalCover,
          })
        : cover === undefined
          ? await store.createProgram(plan.program)
          : await store.createProgram(plan.program, { actorId, upload: cover });
    try {
      await store.createRequest({
        actorId,
        idempotencyKey,
        payloadHash,
        programId: program.id,
      });
    } catch (error) {
      throw new ProgramAuthoringIdempotencyRaceError(error);
    }
    await this.programHistory.append(store.historyWriter, {
      programId: program.id,
      actorGithubId: githubId,
      event: 'CREATED',
      metadata: this.historyMetadataService.createProgramCreatedAuditMetadata({
        programName: program.name,
      }),
    });
    for (const milestone of plan.milestones) {
      const milestoneId = await store.createMilestone(program.id, milestone);
      for (const document of milestone.documents) {
        const documentId = await store.createDocument(milestoneId, document);
        if (document.templateUploadId !== null) {
          const upload = uploads.find(
            ({ id }) => id === document.templateUploadId,
          );
          if (upload === undefined)
            throw new ProgramAuthoringAttachmentRaceError();
          await store.createTemplate({
            milestoneDocumentId: documentId,
            actorId,
            upload,
          });
        }
      }
    }
    return program;
  }
  toCanonicalProgramAuthoringPayload(plan: ProgramAuthoringPlan) {
    return {
      schemaVersion: 2,
      ...(plan.coverUploadId ? { coverUploadId: plan.coverUploadId } : {}),
      ...(plan.externalCover ? { externalCover: plan.externalCover } : {}),
      program: {
        name: plan.program.name,
        organizer: plan.program.organizer,
        trackType: plan.program.trackType,
        category: plan.program.category,
        applicationTemplateKey: plan.program.applicationTemplateKey,
        applicationTemplateVersion: plan.program.applicationTemplateVersion,
        applicationStartAt: plan.program.applicationStartAt.toISOString(),
        applicationEndAt: plan.program.applicationEndAt.toISOString(),
        startAt: plan.program.startAt.toISOString(),
        endAt: plan.program.endAt.toISOString(),
        teamMinSize: plan.program.teamMinSize,
        teamMaxSize: plan.program.teamMaxSize,
        description: plan.program.description,
        repositoryProvisioningEnabled:
          plan.program.repositoryProvisioningEnabled,
        notifyOnDeadline: plan.program.notifyOnDeadline,
      },
      milestones: plan.milestones.map((milestone) => ({
        name: milestone.name,
        startAt: milestone.startAt.toISOString(),
        dueAt: milestone.dueAt.toISOString(),
        instructions: milestone.instructions,
        documents: milestone.documents.map((document) => ({
          name: document.name,
          required: document.required,
          sortOrder: document.sortOrder,
          templateUploadId: document.templateUploadId,
        })),
      })),
    } as const;
  }
  hashProgramAuthoringPayload(plan: ProgramAuthoringPlan): string {
    return createHash('sha256')
      .update(
        JSON.stringify(this.toCanonicalProgramAuthoringPayload(plan)),
        'utf8',
      )
      .digest('hex');
  }
  buildProgramAuthoringPlan(
    request: ProgramAuthoringRequest,
  ): ProgramAuthoringPlan {
    const externalCover =
      this.programAuthoringUploadService.validateProgramCoverChoice(request);
    const issues: ProgramAuthoringValidationIssue[] = [];
    const name = requiredString(request.name, 'name', issues);
    const organizer = requiredString(request.organizer, 'organizer', issues);
    const description = requiredString(
      request.description,
      'description',
      issues,
    );
    const applicationStartAt = isoDate(
      request.applicationStartAt,
      'applicationStartAt',
      issues,
    );
    const applicationEndAt = isoDate(
      request.applicationEndAt,
      'applicationEndAt',
      issues,
    );
    const startAt = isoDate(
      request.startAt ?? request.applicationEndAt,
      'startAt',
      issues,
    );
    let endAt = isoDate(request.endAt, 'endAt', issues);
    if (
      endAt !== null &&
      this.programScheduleService.isProgramEndAtUndecided(endAt)
    ) {
      issues.push({ path: 'endAt', code: 'INVALID_DATE' });
      endAt = null;
    }
    if (
      applicationStartAt === null ||
      applicationEndAt === null ||
      startAt === null ||
      endAt === null
    ) {
      throw new ProgramAuthoringValidationError(issues);
    }
    if (applicationStartAt > applicationEndAt) {
      issues.push({
        path: 'applicationEndAt',
        code: 'INVALID_APPLICATION_SCHEDULE',
      });
    }
    if (applicationEndAt > endAt) {
      issues.push({
        path: 'applicationEndAt',
        code: 'INVALID_APPLICATION_SCHEDULE',
      });
    }
    if (startAt >= endAt) {
      issues.push({ path: 'endAt', code: 'INVALID_PROGRAM_SCHEDULE' });
    }
    const template = this.programTemplatesService.getProgramTemplate(
      ProgramCategory.BASIC,
    );
    const teamMinSize = request.teamMinSize ?? template.teamSize.defaultMin;
    const teamMaxSize = request.teamMaxSize ?? template.teamSize.defaultMax;
    if (
      !Number.isInteger(teamMinSize) ||
      !Number.isInteger(teamMaxSize) ||
      teamMinSize < 1 ||
      teamMinSize > teamMaxSize
    ) {
      issues.push({ path: 'teamMinSize', code: 'INVALID_TEAM_RANGE' });
    }
    if (request.milestones.length > MAX_MILESTONES) {
      issues.push({ path: 'milestones', code: 'MILESTONE_LIMIT_EXCEEDED' });
    }
    if (request.milestones.length === 0) {
      issues.push({ path: 'milestones', code: 'MILESTONE_REQUIRED' });
    }
    const seenUploadIds = new Set<string>();
    const uploadTokenIds: string[] = [];
    const coverUploadId = request.coverUploadId ?? null;
    if (coverUploadId !== null) {
      if (!/^\S{1,128}$/u.test(coverUploadId)) {
        issues.push({ path: 'coverUploadId', code: 'INVALID_UPLOAD_TOKEN' });
      }
      seenUploadIds.add(coverUploadId);
      uploadTokenIds.push(coverUploadId);
    }
    let totalDocuments = 0;
    const milestones: ProgramAuthoringMilestonePlan[] = [];
    request.milestones.forEach((milestone, milestoneIndex) => {
      const path = `milestones.${milestoneIndex}`;
      const milestoneName = requiredString(
        milestone.name,
        `${path}.name`,
        issues,
      );
      const milestoneStartAt = isoDate(
        milestone.startAt ?? startAt.toISOString(),
        `${path}.startAt`,
        issues,
      );
      const dueAt = isoDate(milestone.dueAt, `${path}.dueAt`, issues);
      totalDocuments += milestone.documents.length;
      if (milestone.documents.length > MAX_DOCUMENTS_PER_MILESTONE) {
        issues.push({
          path: `${path}.documents`,
          code: 'DOCUMENT_LIMIT_EXCEEDED',
        });
      }
      const documents = milestone.documents.map((document, documentIndex) =>
        documentPlan(
          document,
          `${path}.documents.${documentIndex}`,
          documentIndex + 1,
          issues,
          seenUploadIds,
          uploadTokenIds,
        ),
      );
      if (milestoneStartAt !== null && dueAt !== null) {
        if (
          milestoneStartAt < startAt ||
          milestoneStartAt >= dueAt ||
          dueAt > endAt
        ) {
          issues.push({
            path: `${path}.dueAt`,
            code: 'INVALID_MILESTONE_SCHEDULE',
          });
        }
        milestones.push({
          name: milestoneName,
          startAt: milestoneStartAt,
          dueAt,
          instructions: optionalString(milestone.instructions),
          documents,
        });
      }
    });
    if (totalDocuments > MAX_DOCUMENTS_PER_PROGRAM) {
      issues.push({
        path: 'milestones',
        code: 'TOTAL_DOCUMENT_LIMIT_EXCEEDED',
      });
    }
    if (issues.length > 0) throw new ProgramAuthoringValidationError(issues);
    return {
      program: {
        name,
        organizer,
        category: ProgramCategory.BASIC,
        trackType: request.trackType,
        applicationTemplateKey: template.key,
        applicationTemplateVersion: template.version,
        applicationStartAt,
        applicationEndAt,
        startAt,
        endAt,
        teamMinSize,
        teamMaxSize,
        description,
        repositoryProvisioningEnabled:
          request.repositoryProvisioningEnabled ?? false,
        notifyOnDeadline: request.notifyOnDeadline ?? true,
      },
      milestones,
      ...(coverUploadId === null ? {} : { coverUploadId }),
      ...(externalCover == null ? {} : { externalCover }),
      uploadTokenIds: uploadTokenIds.sort(),
    };
  }
}
function replayOrConflict(
  replay: {
    readonly payloadHash: string;
    readonly program: ProgramAuthoringProgram;
  },
  payloadHash: string,
  actorId: string,
  idempotencyKey: string,
): ProgramAuthoringProgram {
  if (replay.payloadHash !== payloadHash) {
    throw new ProgramAuthoringIdempotencyConflictError(
      actorId,
      idempotencyKey,
      replay.program.id,
    );
  }
  return replay.program;
}
export type ProgramPurgeResult = {
  readonly id: string;
  readonly deleted: true;
  readonly deletedCounts: ProgramPurgeDeletedCounts;
};
@Injectable()
export class ProgramLifecycleService {
  constructor(
    private readonly repository: ProgramLifecycleRepository,
    private readonly programHistory: ProgramHistoryRepository,
    private readonly historyMetadataService: HistoryMetadataService,
    private readonly prismaSerializationRetryRepository: PrismaSerializationRetryRepository,
  ) {}
  async delete(
    githubId: bigint,
    programId: string,
  ): Promise<{
    readonly id: string;
    readonly deleted: true;
  }> {
    return this.repository.withDeleteTransaction(async (transaction) => {
      const program = await this.repository.findProgramForDeletion(
        transaction,
        programId,
      );
      if (!program) {
        throw new DomainException(
          PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_NOT_FOUND],
        );
      }
      const blockingCounts = await this.repository.readScopeCountsInTransaction(
        transaction,
        programId,
      );
      await this.repository.purgeProgramTree(transaction, programId);
      await this.repository.deleteProgram(transaction, programId);
      await this.programHistory.append(transaction, {
        programId,
        actorGithubId: githubId,
        event: 'DELETED',
        metadata:
          this.historyMetadataService.createProgramDeletionAuditMetadata({
            programName: program.name,
            lifecycle: program.lifecycle,
            blockingCounts,
          }),
      });
      return { id: programId, deleted: true as const };
    });
  }
  async purge(
    githubId: bigint,
    programId: string,
    expectedScope: ProgramDeletionScopeCounts,
  ): Promise<ProgramPurgeResult> {
    try {
      return await this.repository.withPurgeTransaction(async (transaction) => {
        const program = await this.repository.findProgramForDeletion(
          transaction,
          programId,
        );
        if (!program) {
          throw new DomainException(
            PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_NOT_FOUND],
          );
        }
        const currentScopeCounts =
          await this.repository.readScopeCountsInTransaction(
            transaction,
            programId,
          );
        if (
          !sameProgramDeletionScopeCounts(expectedScope, currentScopeCounts)
        ) {
          throw new DomainException(
            PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_PURGE_SCOPE_CHANGED],
            { currentScopeCounts },
          );
        }
        const deletedCounts = await this.repository.purgeProgramTree(
          transaction,
          programId,
        );
        await this.repository.deleteProgram(transaction, programId);
        await this.programHistory.append(transaction, {
          programId,
          actorGithubId: githubId,
          event: 'DELETED',
          metadata:
            this.historyMetadataService.createProgramDeletionAuditMetadata({
              programName: program.name,
              lifecycle: program.lifecycle,
              blockingCounts: {
                applications: 0,
                teams: 0,
                submissions: 0,
                boardPosts: 0,
              },
            }),
        });
        return { id: programId, deleted: true as const, deletedCounts };
      });
    } catch (error) {
      const serializationFailure =
        this.prismaSerializationRetryRepository.isSerializationFailure(error);
      const foreignKeyConflict = this.repository.isForeignKeyConflict(error);
      if (!serializationFailure && !foreignKeyConflict) {
        throw error;
      }
      const currentScopeCounts =
        await this.repository.readScopeCounts(programId);
      if (
        serializationFailure ||
        !sameProgramDeletionScopeCounts(expectedScope, currentScopeCounts)
      ) {
        throw new DomainException(
          PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_PURGE_SCOPE_CHANGED],
          { currentScopeCounts },
        );
      }
      throw error;
    }
  }
}
function sameProgramDeletionScopeCounts(
  left: ProgramDeletionScopeCounts,
  right: ProgramDeletionScopeCounts,
): boolean {
  return (
    left.applications === right.applications &&
    left.teams === right.teams &&
    left.boardPosts === right.boardPosts &&
    left.submissions === right.submissions &&
    left.submissionEvents === right.submissionEvents &&
    left.scopeFingerprint === right.scopeFingerprint
  );
}
