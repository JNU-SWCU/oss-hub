import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { DomainException } from '../platform/error-code.error';
import {
  ProgramAuthoringRepository,
  ProgramAuthoringAttachmentRaceError,
} from './program-authoring.repository';
import type { ProgramAuthoringTransactionStore } from './program-authoring-transaction.types';
import { PROGRAM_NOTICE_ERRORS } from './program-notice-error-code.error';
import {
  extractProgramNotice,
  type ProgramNoticePreview,
  parseProgramNoticeUrl,
} from './program-notice.policy';
import { ProgramNoticeFetchClient } from './program-notice-fetch.client';
import { AccountStatus } from '@prisma/client';
import {
  createProgramCreatedAuditMetadata,
  PROGRAM_CREATED_AUDIT_ACTIONS,
} from '../platform/audit-log-metadata.policy';
import { AuditLogService } from '../platform/audit-log.service';
import { buildProgramAuthoringPlan } from './program-authoring-plan.policy';
import {
  hashProgramAuthoringPayload,
  ProgramAuthoringIdempotencyConflictError,
  ProgramAuthoringIdempotencyRaceError,
  type ProgramAuthoringPlan,
  type ProgramAuthoringProgram,
  type ProgramAuthoringRequest,
} from './program-authoring.policy';
import { assertAttachableProgramAuthoringUploads } from './program-authoring-upload-transaction.repository';
import {
  assertProgramCoverUpload,
  assertProgramTemplateUpload,
} from './program-cover.policy';

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
    const plan = buildProgramAuthoringPlan(request);
    const payloadHash = hashProgramAuthoringPayload(plan);
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
    assertAttachableProgramAuthoringUploads(
      actorId,
      plan.uploadTokenIds,
      uploads,
    );
    for (const upload of uploads) {
      if (upload.id === plan.coverUploadId) assertProgramCoverUpload(upload);
      else assertProgramTemplateUpload(upload);
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
        metadata: createProgramCreatedAuditMetadata({
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

export class ProgramAuthoringForbiddenError extends Error {
  override readonly name = 'ProgramAuthoringForbiddenError';

  constructor() {
    super('Program authoring requires staff or administrator access.');
  }
}
