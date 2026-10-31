import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { DomainException } from '../platform/error-code.error';
import {
  ProgramAuthoringRepository,
  type ProgramAuthoringTransactionStore,
} from './program-authoring.repository';
import { PROGRAM_NOTICE_ERRORS } from './program-notice-error-code.error';
import {
  ProgramNoticeFetchClient,
  extractProgramNotice,
  type ProgramNoticePreview,
  parseProgramNoticeUrl,
} from './program-notice-fetch.client';
import { AccountStatus, ProgramCategory } from '@prisma/client';
import { AuditLogService } from '../platform/audit-log.service';
import { PROGRAM_CREATED_AUDIT_ACTIONS } from '../platform/audit-log-metadata.config';
import {
  ProgramAuthoringUploadTransactionRepository,
  type ProgramAuthoringRequest,
  ProgramAuthoringPlan,
  type ProgramAuthoringMilestonePlan,
  type ProgramAuthoringDocumentPlan,
  type ProgramAuthoringProgram,
} from './program-authoring-upload-transaction.repository';
import {
  ProgramAuthoringAttachmentRaceError,
  ProgramAuthoringForbiddenError,
  ProgramAuthoringIdempotencyConflictError,
  ProgramAuthoringIdempotencyRaceError,
} from './program-authoring.error';
import {
  type ProgramAuthoringValidationIssue,
  ProgramAuthoringValidationError,
} from './program-authoring-validation.error';
import { createHash } from 'node:crypto';
import { AuditLogMetadataService } from '../platform/audit-log-metadata.service';
import { ProgramRulesService } from './program-rules.service';
import { ProgramUploadRulesService } from './program-upload-rules.service';

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

  private attempts: { readonly actorId: string; readonly at: number }[] = [];

  constructor(
    @Inject(ProgramAuthoringRepository)
    private readonly repository: Pick<ProgramAuthoringRepository, 'findActor'>,
    @Inject(ProgramNoticeFetchClient)
    private readonly client: Pick<ProgramNoticeFetchClient, 'read'>,
  ) {}

  async preview(
    githubId: bigint,
    input: string,
  ): Promise<ProgramNoticePreview> {
    const actor = await this.repository.findActor(githubId);
    if (
      !actor ||
      actor.accountStatus !== 'ACTIVE' ||
      (!actor.hasStaffAccess && !actor.hasAdminAccess)
    )
      throw new ConflictException('Program authoring is unavailable.');
    const source = parseProgramNoticeUrl(input);
    const now = Date.now();
    this.attempts = this.attempts.filter(
      (attempt) => attempt.at > now - 60_000,
    );
    if (
      this.active >= 4 ||
      this.attempts.length >= 60 ||
      this.attempts.filter((attempt) => attempt.actorId === actor.id).length >=
        6
    )
      throw new DomainException(PROGRAM_NOTICE_ERRORS.RATE_LIMITED);
    this.attempts.push({ actorId: actor.id, at: now });
    this.active++;
    try {
      return extractProgramNotice(await this.client.read(source), source);
    } finally {
      this.active--;
    }
  }
}

type ProgramAuthoringStore = Pick<
  ProgramAuthoringRepository,
  'findActor' | 'findReplay' | 'withTransaction'
>;

@Injectable()
export class ProgramAuthoringService {
  constructor(
    @Inject(ProgramAuthoringRepository)
    private readonly repository: ProgramAuthoringStore,
    private readonly auditLog: AuditLogService,
    private readonly auditLogMetadataService: AuditLogMetadataService,
    private readonly programRulesService: ProgramRulesService,
    private readonly programUploadRulesService: ProgramUploadRulesService,
  ) {}

  async requireAuthor(githubId: bigint): Promise<string> {
    const actor = await this.repository.findActor(githubId);
    if (
      actor === null ||
      actor.accountStatus !== AccountStatus.ACTIVE ||
      (!actor.hasStaffAccess && !actor.hasAdminAccess)
    ) {
      throw new ProgramAuthoringForbiddenError();
    }
    return actor.id;
  }

  async create(
    githubId: bigint,
    idempotencyKey: string,
    request: ProgramAuthoringRequest,
  ): Promise<ProgramAuthoringProgram> {
    const actorId = await this.requireAuthor(githubId);
    const plan = this.buildProgramAuthoringPlan(request);
    const payloadHash = this.hashProgramAuthoringPayload(plan);
    const existing = await this.repository.findReplay(actorId, idempotencyKey);
    if (existing !== null)
      return replayOrConflict(existing, payloadHash, actorId, idempotencyKey);
    try {
      return await this.repository.withTransaction((store) =>
        this.createInTransaction(
          store,
          githubId,
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
    ProgramAuthoringUploadTransactionRepository.assertAttachableProgramAuthoringUploads(
      actorId,
      plan.uploadTokenIds,
      uploads,
    );
    for (const upload of uploads) {
      if (upload.id === plan.coverUploadId)
        this.programUploadRulesService.assertProgramCoverUpload(upload);
      else this.programUploadRulesService.assertProgramTemplateUpload(upload);
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
    let requestId: string;
    try {
      requestId = await store.createRequest({
        actorId,
        idempotencyKey,
        payloadHash,
        programId: program.id,
      });
    } catch (error) {
      throw new ProgramAuthoringIdempotencyRaceError(error);
    }
    await this.auditLog.record(
      {
        actorGithubId: githubId,
        action: PROGRAM_CREATED_AUDIT_ACTIONS.PROGRAM_CREATED,
        targetType: 'PROGRAM',
        targetId: program.id,
        metadata:
          this.auditLogMetadataService.createProgramCreatedAuditMetadata({
            programName: program.name,
          }),
      },
      store.auditLogWriter,
    );
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
    await store.attachUploads(
      actorId,
      requestId,
      plan.uploadTokenIds.filter((id) => id !== plan.coverUploadId),
    );
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
        submissionType: milestone.submissionType,
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
      this.programUploadRulesService.validateProgramCoverChoice(request);
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
      this.programRulesService.isProgramEndAtUndecided(endAt)
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

    const template = this.programRulesService.getProgramTemplate(
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
          submissionType: null,
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
