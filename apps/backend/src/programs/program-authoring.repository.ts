import { Injectable } from '@nestjs/common';
import {
  AccountStatus,
  Prisma,
  ProgramAuthoringUploadLifecycle,
} from '@prisma/client';
import type { AuditLogTransactionWriter } from '../audit-log/audit-log.repository';
import { PrismaService } from '../prisma/prisma.service';
import { e2eProgramAuthoringControlEnabled } from '../e2e-program-authoring/e2e-program-authoring.config';
import { e2eProgramAuthoringExternalPorts } from '../e2e-program-authoring/e2e-external-ports';
import {
  E2E_EXTERNAL_FAILURE_OPERATIONS,
  E2eExternalPortFault,
} from '../e2e-program-authoring/e2e-external-port-registry';
import type {
  ProgramAuthoringCreateRequestInput,
  ProgramAuthoringDocumentPlan,
  ProgramAuthoringMilestonePlan,
  ProgramAuthoringProgram,
  ProgramAuthoringProgramPlan,
  ProgramAuthoringReplay,
  ProgramAuthoringTemplateInput,
  ProgramAuthoringTransactionStore,
  ProgramAuthoringUploadToken,
} from './program-authoring.types';

type AuthoringActor = {
  readonly id: string;
  readonly accountStatus: AccountStatus;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
};

@Injectable()
export class ProgramAuthoringRepository {
  constructor(private readonly prisma: PrismaService) {}

  findActor(githubId: bigint): Promise<AuthoringActor | null> {
    return this.prisma.user.findUnique({
      where: { githubId },
      select: {
        id: true,
        accountStatus: true,
        hasStaffAccess: true,
        hasAdminAccess: true,
      },
    });
  }

  async findReplay(
    actorId: string,
    idempotencyKey: string,
  ): Promise<ProgramAuthoringReplay | null> {
    const request = await this.prisma.programCreateRequest.findUnique({
      where: { actorId_idempotencyKey: { actorId, idempotencyKey } },
      select: {
        payloadHash: true,
        program: {
          select: {
            id: true,
            name: true,
            organizer: true,
            category: true,
            applicationTemplateKey: true,
            applicationTemplateVersion: true,
            applicationStartAt: true,
            applicationEndAt: true,
            startAt: true,
            endAt: true,
            teamMinSize: true,
            teamMaxSize: true,
            description: true,
            repositoryProvisioningEnabled: true,
            notifyOnDeadline: true,
            lifecycle: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });
    return request === null
      ? null
      : { payloadHash: request.payloadHash, program: request.program };
  }

  async withTransaction<T>(
    operation: (store: ProgramAuthoringTransactionStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (transaction) => {
      const result = await operation(
        new ProgramAuthoringTransactionRepository(transaction),
      );
      if (
        e2eProgramAuthoringControlEnabled() &&
        e2eProgramAuthoringExternalPorts.failures.consume(
          E2E_EXTERNAL_FAILURE_OPERATIONS.PRISMA_TRANSACTION,
        )
      ) {
        throw new E2eExternalPortFault();
      }
      return result;
    });
  }
}

class ProgramAuthoringTransactionRepository implements ProgramAuthoringTransactionStore {
  constructor(private readonly prisma: Prisma.TransactionClient) {}

  get auditLogWriter(): AuditLogTransactionWriter {
    return this.prisma;
  }

  createProgram(
    plan: ProgramAuthoringProgramPlan,
  ): Promise<ProgramAuthoringProgram> {
    return this.prisma.program.create({ data: plan });
  }

  async createRequest(
    input: ProgramAuthoringCreateRequestInput,
  ): Promise<string> {
    const request = await this.prisma.programCreateRequest.create({
      data: input,
    });
    return request.id;
  }

  lockUploads(
    tokenIds: readonly string[],
  ): Promise<readonly ProgramAuthoringUploadToken[]> {
    if (tokenIds.length === 0) return Promise.resolve([]);
    return this.prisma.$queryRaw<readonly ProgramAuthoringUploadToken[]>(
      Prisma.sql`
        SELECT "id", "actorId", "lifecycle", ("expiresAt" > NOW()) AS "unexpired",
               "storageKey", "originalFileName", "mimeType", "sizeBytes"
        FROM "ProgramAuthoringUpload"
        WHERE "id" IN (${Prisma.join(tokenIds)})
        ORDER BY "id"
        FOR UPDATE
      `,
    );
  }

  async createMilestone(
    programId: string,
    plan: ProgramAuthoringMilestonePlan,
  ): Promise<string> {
    const milestone = await this.prisma.milestone.create({
      data: {
        programId,
        name: plan.name,
        startAt: plan.startAt,
        dueAt: plan.dueAt,
        submissionType: plan.submissionType,
        instructions: plan.instructions,
      },
    });
    return milestone.id;
  }

  async createDocument(
    milestoneId: string,
    plan: ProgramAuthoringDocumentPlan,
  ): Promise<string> {
    const document = await this.prisma.milestoneDocument.create({
      data: {
        milestoneId,
        name: plan.name,
        required: plan.required,
        sortOrder: plan.sortOrder,
        submissionType: plan.submissionType,
      },
    });
    return document.id;
  }

  async createTemplate(input: ProgramAuthoringTemplateInput): Promise<void> {
    await this.prisma.milestoneDocumentTemplateFile.create({
      data: {
        milestoneDocumentId: input.milestoneDocumentId,
        storageKey: input.upload.storageKey,
        originalFileName: input.upload.originalFileName,
        mimeType: input.upload.mimeType,
        sizeBytes: input.upload.sizeBytes,
        uploadedById: input.actorId,
      },
    });
  }

  async attachUploads(
    actorId: string,
    requestId: string,
    tokenIds: readonly string[],
  ): Promise<void> {
    if (tokenIds.length === 0) return;
    const attached = await this.prisma.programAuthoringUpload.updateMany({
      where: {
        id: { in: [...tokenIds] },
        actorId,
        lifecycle: ProgramAuthoringUploadLifecycle.PENDING,
      },
      data: {
        lifecycle: ProgramAuthoringUploadLifecycle.ATTACHED,
        attachedAt: new Date(),
        createRequestActorId: actorId,
        createRequestId: requestId,
      },
    });
    if (attached.count !== tokenIds.length) {
      throw new ProgramAuthoringAttachmentRaceError();
    }
  }
}

export class ProgramAuthoringAttachmentRaceError extends Error {
  override readonly name = 'ProgramAuthoringAttachmentRaceError';

  constructor() {
    super('Program authoring uploads changed before attachment.');
  }
}
