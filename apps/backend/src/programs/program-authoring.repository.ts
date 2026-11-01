import { ProgramCoverRepository } from './program-cover.repository';
import type { AuditLogTransactionWriter } from '../platform/audit-log-transaction-writer.types';
import { Injectable } from '@nestjs/common';
import { Prisma, ProgramAuthoringUploadLifecycle } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import {
  ProgramAuthoringUploadTransactionRepository,
  type ProgramAuthoringProgramPlan,
  type ProgramExternalCover,
  type ProgramAuthoringProgram,
  type ProgramAuthoringCreateRequestInput,
  type ProgramAuthoringMilestonePlan,
  type ProgramAuthoringDocumentPlan,
  type ProgramAuthoringTemplateInput,
  type ProgramAuthoringReplay,
} from './program-authoring-upload-transaction.repository';
import { type ProgramAuthoringUploadToken } from './program-authoring-upload.config';

import { ProgramAuthoringAttachmentRaceError } from './program-authoring.error';

export interface ProgramAuthoringTransactionStore {
  readonly auditLogWriter: AuditLogTransactionWriter;
  createProgram(
    plan: ProgramAuthoringProgramPlan,
    cover?:
      | {
          readonly actorId: string;
          readonly upload: ProgramAuthoringUploadToken;
        }
      | { readonly externalCover: ProgramExternalCover },
  ): Promise<ProgramAuthoringProgram>;
  createRequest(input: ProgramAuthoringCreateRequestInput): Promise<string>;
  lockUploads(
    tokenIds: readonly string[],
  ): Promise<readonly ProgramAuthoringUploadToken[]>;
  createMilestone(
    programId: string,
    plan: ProgramAuthoringMilestonePlan,
  ): Promise<string>;
  createDocument(
    milestoneId: string,
    plan: ProgramAuthoringDocumentPlan,
  ): Promise<string>;
  createTemplate(input: ProgramAuthoringTemplateInput): Promise<void>;
  attachUploads(
    actorId: string,
    requestId: string,
    tokenIds: readonly string[],
  ): Promise<void>;
}

@Injectable()
export class ProgramAuthoringRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly programAuthoringUploadTransactionRepository: ProgramAuthoringUploadTransactionRepository,
    private readonly programCoverRepository: ProgramCoverRepository,
  ) {}

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
            trackType: true,
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
      : {
          payloadHash: request.payloadHash,
          program: request.program as ProgramAuthoringProgram,
        };
  }

  withTransaction<T>(
    operation: (store: ProgramAuthoringTransactionStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((transaction) =>
      operation(this.programAuthoringTransactionStore(transaction)),
    );
  }

  private programAuthoringTransactionStore(
    prisma: Prisma.TransactionClient,
  ): ProgramAuthoringTransactionStore {
    return {
      auditLogWriter: prisma,
      createProgram: this.createProgramIn.bind(this, prisma),
      createRequest: this.createRequestIn.bind(this, prisma),
      lockUploads: this.lockUploadsIn.bind(this, prisma),
      createMilestone: this.createMilestoneIn.bind(this, prisma),
      createDocument: this.createDocumentIn.bind(this, prisma),
      createTemplate: this.createTemplateIn.bind(this, prisma),
      attachUploads: this.attachUploadsIn.bind(this, prisma),
    };
  }

  private async createProgramIn(
    prisma: Prisma.TransactionClient,
    plan: ProgramAuthoringProgramPlan,
    cover?:
      | {
          readonly actorId: string;
          readonly upload: ProgramAuthoringUploadToken;
        }
      | { readonly externalCover: ProgramExternalCover },
  ): Promise<ProgramAuthoringProgram> {
    const program = await prisma.program.create({
      data: plan,
    });
    if (cover !== undefined) {
      if ('externalCover' in cover) {
        await this.programCoverRepository.createExternalProgramCover(
          prisma,
          program.id,
          cover.externalCover,
        );
      } else {
        await this.programCoverRepository.createProgramCover(prisma, {
          programId: program.id,
          ...cover,
        });
      }
    }
    return program as ProgramAuthoringProgram;
  }

  private async createRequestIn(
    prisma: Prisma.TransactionClient,
    input: ProgramAuthoringCreateRequestInput,
  ): Promise<string> {
    const request = await prisma.programCreateRequest.create({
      data: input,
    });
    return request.id;
  }

  private lockUploadsIn(
    prisma: Prisma.TransactionClient,
    tokenIds: readonly string[],
  ): Promise<readonly ProgramAuthoringUploadToken[]> {
    return this.programAuthoringUploadTransactionRepository.lockProgramAuthoringUploads(
      prisma,
      tokenIds,
    );
  }

  private async createMilestoneIn(
    prisma: Prisma.TransactionClient,
    programId: string,
    plan: ProgramAuthoringMilestonePlan,
  ): Promise<string> {
    const milestone = await prisma.milestone.create({
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

  private async createDocumentIn(
    prisma: Prisma.TransactionClient,
    milestoneId: string,
    plan: ProgramAuthoringDocumentPlan,
  ): Promise<string> {
    const document = await prisma.milestoneDocument.create({
      data: {
        milestoneId,
        name: plan.name,
        required: plan.required,
        sortOrder: plan.sortOrder,
      },
    });
    return document.id;
  }

  private async createTemplateIn(
    prisma: Prisma.TransactionClient,
    input: ProgramAuthoringTemplateInput,
  ): Promise<void> {
    await prisma.milestoneDocumentTemplateFile.create({
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

  private async attachUploadsIn(
    prisma: Prisma.TransactionClient,
    actorId: string,
    requestId: string,
    tokenIds: readonly string[],
  ): Promise<void> {
    if (tokenIds.length === 0) return;
    const attached = await prisma.programAuthoringUpload.updateMany({
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
