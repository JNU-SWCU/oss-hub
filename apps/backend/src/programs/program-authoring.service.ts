import { Inject, Injectable } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';
import {
  createProgramCreatedAuditMetadata,
  PROGRAM_CREATED_AUDIT_ACTIONS,
} from '../audit-log/audit-log-metadata';
import { AuditLogService } from '../audit-log/audit-log.service';
import { buildProgramAuthoringPlan } from './program-authoring-plan';
import { hashProgramAuthoringPayload } from './program-authoring-payload-hash';
import {
  ProgramAuthoringAttachmentRaceError,
  ProgramAuthoringRepository,
} from './program-authoring.repository';
import {
  PROGRAM_AUTHORING_UPLOAD_TOKEN_FAILURE,
  ProgramAuthoringIdempotencyConflictError,
  ProgramAuthoringIdempotencyRaceError,
  ProgramAuthoringUploadTokenError,
  type ProgramAuthoringPlan,
  type ProgramAuthoringProgram,
  type ProgramAuthoringRequest,
  type ProgramAuthoringTransactionStore,
  type ProgramAuthoringUploadToken,
} from './program-authoring.types';

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

  async create(
    githubId: bigint,
    idempotencyKey: string,
    request: ProgramAuthoringRequest,
  ): Promise<ProgramAuthoringProgram> {
    const actor = await this.repository.findActor(githubId);
    if (
      actor === null ||
      actor.accountStatus !== AccountStatus.ACTIVE ||
      (!actor.hasStaffAccess && !actor.hasAdminAccess)
    ) {
      throw new ProgramAuthoringForbiddenError();
    }
    const plan = buildProgramAuthoringPlan(request);
    const payloadHash = hashProgramAuthoringPayload(plan);
    const existing = await this.repository.findReplay(actor.id, idempotencyKey);
    if (existing !== null)
      return replayOrConflict(existing, payloadHash, actor.id, idempotencyKey);
    try {
      return await this.repository.withTransaction((store) =>
        this.createInTransaction(
          store,
          githubId,
          actor.id,
          idempotencyKey,
          payloadHash,
          plan,
        ),
      );
    } catch (error) {
      if (!(error instanceof ProgramAuthoringIdempotencyRaceError)) throw error;
      const replay = await this.repository.findReplay(actor.id, idempotencyKey);
      if (replay === null) throw error;
      return replayOrConflict(replay, payloadHash, actor.id, idempotencyKey);
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
    assertAttachableUploads(actorId, plan.uploadTokenIds, uploads);
    const program = await store.createProgram(plan.program);
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
    await store.attachUploads(actorId, requestId, plan.uploadTokenIds);
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
    throw new ProgramAuthoringIdempotencyConflictError(actorId, idempotencyKey);
  }
  return replay.program;
}

function assertAttachableUploads(
  actorId: string,
  tokenIds: readonly string[],
  uploads: readonly ProgramAuthoringUploadToken[],
): void {
  if (uploads.length !== tokenIds.length) {
    throw new ProgramAuthoringUploadTokenError(
      PROGRAM_AUTHORING_UPLOAD_TOKEN_FAILURE.MISSING,
      tokenIds,
    );
  }
  for (const upload of uploads) {
    if (upload.actorId !== actorId) {
      throw new ProgramAuthoringUploadTokenError(
        PROGRAM_AUTHORING_UPLOAD_TOKEN_FAILURE.NOT_OWNED,
        [upload.id],
      );
    }
    if (upload.lifecycle !== 'PENDING') {
      throw new ProgramAuthoringUploadTokenError(
        PROGRAM_AUTHORING_UPLOAD_TOKEN_FAILURE.NOT_PENDING,
        [upload.id],
      );
    }
    if (!upload.unexpired) {
      throw new ProgramAuthoringUploadTokenError(
        PROGRAM_AUTHORING_UPLOAD_TOKEN_FAILURE.EXPIRED,
        [upload.id],
      );
    }
  }
}

export class ProgramAuthoringForbiddenError extends Error {
  override readonly name = 'ProgramAuthoringForbiddenError';

  constructor() {
    super('Program authoring requires staff or administrator access.');
  }
}
