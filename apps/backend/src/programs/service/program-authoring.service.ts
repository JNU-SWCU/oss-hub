import { Inject, Injectable } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';
import {
  createProgramCreatedAuditMetadata,
  PROGRAM_CREATED_AUDIT_ACTIONS,
} from '../../audit-log/domain/audit-log-metadata';
import { AuditLogService } from '../../audit-log/service/audit-log.service';
import { buildProgramAuthoringPlan } from '../domain/program-authoring-plan';
import { hashProgramAuthoringPayload } from '../domain/program-authoring-payload-hash';
import {
  ProgramAuthoringAttachmentRaceError,
  ProgramAuthoringRepository,
} from '../repository/program-authoring.repository';
import { assertAttachableProgramAuthoringUploads } from '../repository/program-authoring-upload-transaction';
import {
  assertProgramCoverUpload,
  assertProgramTemplateUpload,
} from '../domain/program-cover';
import {
  ProgramAuthoringIdempotencyConflictError,
  ProgramAuthoringIdempotencyRaceError,
  type ProgramAuthoringPlan,
  type ProgramAuthoringProgram,
  type ProgramAuthoringRequest,
} from '../domain/program-authoring.types';
import { type ProgramAuthoringTransactionStore } from '../repository/program-authoring-transaction';

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
    throw new ProgramAuthoringIdempotencyConflictError(actorId, idempotencyKey);
  }
  return replay.program;
}

export class ProgramAuthoringForbiddenError extends Error {
  override readonly name = 'ProgramAuthoringForbiddenError';

  constructor() {
    super('Program authoring requires staff or administrator access.');
  }
}
