import { Injectable } from '@nestjs/common';
import {
  MilestoneDocumentKind,
  StaffAccessRequestStatus,
  SubmissionFileLifecycle,
} from '@prisma/client';
import type { Prisma as PrismaTypes } from '@prisma/client';

import { lockProgramTree } from '../../prisma/lock-program-tree';
import { PrismaService } from '../../prisma/prisma.service';
import { readProgramDeletionScopeCounts } from './program-deletion-scope';
import type { ProgramDeletionScopeCounts } from '../domain/program-deletion-scope';
import type {
  EditableProgramView,
  ProgramEditorTransactionStore,
  LockedProgramMilestoneEdit,
  ApplyProgramMilestoneEditInput,
  ProgramMilestoneCreateInput,
  ProgramMilestoneDeleteTarget,
  ProgramMilestoneTarget,
  ProgramMilestoneUpdateInput,
  ProgramMilestoneView,
  ProgramSchedule,
  ProgramUpdateInput,
} from '../domain/program-editor.types';
import {
  consumePendingProgramAuthoringUploads,
  lockAttachableProgramAuthoringUploads,
} from './program-authoring-upload-transaction';
import type { ProgramAuthoringPendingUploadConsumption } from '../domain/program-authoring.types';
import { replaceProgramCover } from './program-cover-write';
import { programCoverImageUrl } from '../domain/program-cover';

type ProgramRecord = PrismaTypes.ProgramGetPayload<{
  include: typeof editableProgramInclude;
}>;
type MilestoneRecord = PrismaTypes.MilestoneGetPayload<Record<string, never>>;

class PrismaProgramEditorStore implements ProgramEditorTransactionStore {
  constructor(private readonly transaction: PrismaTypes.TransactionClient) {}

  findUserAuthorityByGithubId(githubId: bigint) {
    return this.transaction.user.findUnique({
      where: { githubId },
      select: {
        id: true,
        hasStaffAccess: true,
        hasAdminAccess: true,
        accountStatus: true,
        staffAccessRequests: {
          where: { status: StaffAccessRequestStatus.PENDING },
          select: { status: true },
          take: 1,
        },
      },
    });
  }

  async findEditableProgramById(
    programId: string,
  ): Promise<EditableProgramView | null> {
    const [program, deletionScopeCounts] = await Promise.all([
      this.transaction.program.findUnique({
        where: { id: programId },
        include: editableProgramInclude,
      }),
      this.readDeletionScopeCounts(programId),
    ]);
    return program ? toEditableProgramView(program, deletionScopeCounts) : null;
  }

  async findEditableProgramForUpdate(
    programId: string,
  ): Promise<EditableProgramView | null> {
    const locked = await lockProgramTree(this.transaction, {
      stage: 'program',
      programId,
    });
    return locked ? this.findEditableProgramById(programId) : null;
  }

  async updateProgram(input: ProgramUpdateInput): Promise<EditableProgramView> {
    if (input.coverChange !== undefined) {
      await replaceProgramCover(this.transaction, {
        programId: input.programId,
        ...input.coverChange,
      });
    }
    if (input.liveFileExpiresAt !== null) {
      await this.transaction.submissionFile.updateMany({
        where: {
          application: { programId: input.programId },
          lifecycle: {
            in: [
              SubmissionFileLifecycle.PENDING,
              SubmissionFileLifecycle.ATTACHED,
            ],
          },
          deletedAt: null,
        },
        data: { expiresAt: input.liveFileExpiresAt },
      });
    }
    const program = await this.transaction.program.update({
      where: { id: input.programId },
      data: {
        name: input.name,
        organizer: input.organizer,
        trackType: input.trackType,
        applicationTemplateKey: input.applicationTemplateKey,
        applicationTemplateVersion: input.applicationTemplateVersion,
        applicationStartAt: input.applicationStartAt,
        applicationEndAt: input.applicationEndAt,
        startAt: input.startAt,
        endAt: input.endAt,
        teamMinSize: input.teamMinSize,
        teamMaxSize: input.teamMaxSize,
        repositoryProvisioningEnabled: input.repositoryProvisioningEnabled,
        notifyOnDeadline: input.notifyOnDeadline,
        description: input.description,
      },
      include: editableProgramInclude,
    });
    return toEditableProgramView(
      program,
      await this.readDeletionScopeCounts(input.programId),
    );
  }

  private readDeletionScopeCounts(
    programId: string,
  ): Promise<ProgramDeletionScopeCounts> {
    return readProgramDeletionScopeCounts(this.transaction, programId);
  }

  async findProgramScheduleForMilestoneCreate(
    programId: string,
  ): Promise<ProgramSchedule | null> {
    const locked = await lockProgramTree(this.transaction, {
      stage: 'program',
      programId,
    });
    if (!locked) return null;
    return this.transaction.program.findUnique({
      where: { id: programId },
      select: { id: true, startAt: true, endAt: true },
    });
  }

  async createMilestone(
    input: ProgramMilestoneCreateInput,
  ): Promise<ProgramMilestoneView> {
    const milestone = await this.transaction.milestone.create({
      data: {
        ...input,
        documents: {
          create: {
            name: '제출 항목 1',
            required: true,
            sortOrder: 1,
          },
        },
      },
    });
    return toMilestoneView(milestone);
  }

  async findMilestoneForUpdate(
    milestoneId: string,
  ): Promise<ProgramMilestoneTarget | null> {
    const programId = await this.findMilestoneProgramId(milestoneId);
    if (programId === null) return null;
    const programLocked = await lockProgramTree(this.transaction, {
      stage: 'program',
      programId,
    });
    if (!programLocked) return null;
    const lockedMilestone = await lockProgramTree(this.transaction, {
      stage: 'milestone',
      milestoneId,
      after: programLocked,
    });
    if (lockedMilestone === null || lockedMilestone.programId !== programId) {
      return null;
    }
    const milestone = await this.transaction.milestone.findUnique({
      where: { id: milestoneId },
      include: {
        program: { select: { startAt: true, endAt: true } },
      },
    });
    if (milestone === null || milestone.programId !== programId) return null;
    return {
      ...toMilestoneView(milestone),
      programId: milestone.programId,
      programStartAt: milestone.program.startAt,
      endAt: milestone.program.endAt,
    };
  }

  async updateMilestone(
    input: ProgramMilestoneUpdateInput,
  ): Promise<ProgramMilestoneView> {
    const milestone = await this.transaction.milestone.update({
      where: { id: input.milestoneId },
      data: {
        name: input.name,
        startAt: input.startAt,
        dueAt: input.dueAt,
        submissionType: input.submissionType,
        instructions: input.instructions,
      },
    });
    return toMilestoneView(milestone);
  }

  async lockMilestoneEdit(
    milestoneId: string,
  ): Promise<LockedProgramMilestoneEdit | null> {
    const programId = await this.findMilestoneProgramId(milestoneId);
    if (programId === null) return null;
    const program = await lockProgramTree(this.transaction, {
      stage: 'program',
      programId,
    });
    if (program === null) return null;
    const lockedMilestone = await lockProgramTree(this.transaction, {
      stage: 'milestone',
      milestoneId,
      after: program,
    });
    if (lockedMilestone === null) return null;
    return this.readMilestoneEditWith(milestoneId, programId, async () => {
      await lockProgramTree(this.transaction, {
        stage: 'documents',
        after: lockedMilestone,
        documentKind: 'DOCUMENT',
      });
    });
  }

  async readMilestoneEdit(
    milestoneId: string,
  ): Promise<LockedProgramMilestoneEdit | null> {
    const programId = await this.findMilestoneProgramId(milestoneId);
    if (programId === null) return null;
    return this.readMilestoneEditWith(milestoneId, programId);
  }

  private async readMilestoneEditWith(
    milestoneId: string,
    programId: string,
    lockDocuments?: () => Promise<void>,
  ): Promise<LockedProgramMilestoneEdit | null> {
    const milestone = await this.transaction.milestone.findUnique({
      where: { id: milestoneId },
      select: {
        id: true,
        programId: true,
        name: true,
        startAt: true,
        dueAt: true,
        submissionType: true,
        instructions: true,
        updatedAt: true,
        program: { select: { startAt: true, endAt: true } },
      },
    });
    if (milestone === null || milestone.programId !== programId) return null;
    await lockDocuments?.();
    const documents = await this.transaction.milestoneDocument.findMany({
      where: { milestoneId, kind: MilestoneDocumentKind.DOCUMENT },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        name: true,
        required: true,
        sortOrder: true,
        updatedAt: true,
        templateFile: { select: { storageKey: true, originalFileName: true } },
      },
    });
    return {
      programId,
      milestoneUpdatedAt: milestone.updatedAt,
      view: {
        milestone: {
          id: milestone.id,
          name: milestone.name,
          startAt: milestone.startAt,
          dueAt: milestone.dueAt,
          submissionType: milestone.submissionType,
          instructions: milestone.instructions,
        },
        operation: {
          startAt: milestone.program.startAt,
          endAt: milestone.program.endAt,
        },
        documents: [...documents]
          .sort((left, right) => left.sortOrder - right.sortOrder)
          .map((document) => ({
            id: document.id,
            name: document.name,
            required: document.required,
            sortOrder: document.sortOrder,
            templateFileName: document.templateFile?.originalFileName ?? null,
          })),
      },
      fingerprintDocuments: documents.map((document) => ({
        id: document.id,
        name: document.name,
        required: document.required,
        sortOrder: document.sortOrder,
        updatedAt: document.updatedAt,
        storageKey: document.templateFile?.storageKey ?? null,
      })),
    };
  }

  async countSubmissionHistoriesForDocuments(
    documentIds: readonly string[],
  ): Promise<number> {
    if (documentIds.length === 0) return 0;
    return this.transaction.milestoneDocumentSubmissionHistory.count({
      where: {
        submission: {
          milestoneDocumentId: { in: [...documentIds] },
        },
      },
    });
  }

  lockAttachableUploads(actorId: string, tokenIds: readonly string[]) {
    return lockAttachableProgramAuthoringUploads(
      this.transaction,
      actorId,
      tokenIds,
    );
  }

  async applyMilestoneEdit(
    input: ApplyProgramMilestoneEditInput,
  ): Promise<void> {
    const requestedExistingIds = input.documents.flatMap((document) =>
      document.id === null ? [] : [document.id],
    );
    await this.transaction.milestone.update({
      where: { id: input.milestoneId },
      data: {
        name: input.name,
        startAt: input.startAt,
        dueAt: input.dueAt,
        instructions: input.instructions,
      },
    });
    const existing = await this.transaction.milestoneDocument.findMany({
      where: {
        milestoneId: input.milestoneId,
        kind: MilestoneDocumentKind.DOCUMENT,
      },
      select: { id: true },
    });
    const deletedIds = existing
      .map((document) => document.id)
      .filter((id) => !requestedExistingIds.includes(id));
    if (deletedIds.length > 0) {
      await this.transaction.milestoneDocumentTemplateFile.deleteMany({
        where: { milestoneDocumentId: { in: deletedIds } },
      });
      await this.transaction.milestoneDocument.deleteMany({
        where: { id: { in: deletedIds }, kind: MilestoneDocumentKind.DOCUMENT },
      });
    }
    const consumptions: ProgramAuthoringPendingUploadConsumption[] = [];
    for (const [index, document] of input.documents.entries()) {
      const milestoneDocumentId =
        document.id ??
        (
          await this.transaction.milestoneDocument.create({
            data: {
              milestoneId: input.milestoneId,
              name: document.name,
              required: document.required,
              sortOrder: index + 1,
              kind: MilestoneDocumentKind.DOCUMENT,
            },
            select: { id: true },
          })
        ).id;
      if (document.id !== null) {
        await this.transaction.milestoneDocument.update({
          where: {
            id: milestoneDocumentId,
            kind: MilestoneDocumentKind.DOCUMENT,
          },
          data: {
            name: document.name,
            required: document.required,
            sortOrder: index + 1,
          },
        });
      }
      if (document.templateUploadId !== undefined) {
        const upload = input.uploads.find(
          (candidate) => candidate.id === document.templateUploadId,
        );
        if (upload === undefined) {
          throw new ProgramEditorMilestoneEditRaceError();
        }
        consumptions.push({ milestoneDocumentId, upload });
      }
    }
    await consumePendingProgramAuthoringUploads(
      this.transaction,
      input.actorId,
      consumptions,
    );
  }

  async findMilestoneForDelete(
    milestoneId: string,
  ): Promise<ProgramMilestoneDeleteTarget | null> {
    const programId = await this.findMilestoneProgramId(milestoneId);
    if (programId === null) return null;
    const programLocked = await lockProgramTree(this.transaction, {
      stage: 'program',
      programId,
    });
    if (!programLocked) return null;
    const lockedMilestone = await lockProgramTree(this.transaction, {
      stage: 'milestone',
      milestoneId,
      after: programLocked,
    });
    if (lockedMilestone === null || lockedMilestone.programId !== programId) {
      return null;
    }

    await lockProgramTree(this.transaction, {
      stage: 'documents',
      after: lockedMilestone,
      documentKind: 'ALL',
    });
    const milestone = await this.transaction.milestone.findUnique({
      where: { id: milestoneId },
      include: {
        program: { include: { _count: { select: { milestones: true } } } },
      },
    });
    if (milestone === null || milestone.programId !== programId) return null;

    const documentSubmissionCount =
      await this.transaction.milestoneDocumentSubmission.count({
        where: { milestoneDocument: { milestoneId } },
      });
    return {
      id: milestone.id,
      programId: milestone.programId,
      documentSubmissionCount,
      programMilestoneCount: milestone.program._count.milestones,
      programRepositoryProvisioningEnabled:
        milestone.program.repositoryProvisioningEnabled,
    };
  }

  async deleteMilestone(milestoneId: string): Promise<void> {
    await this.transaction.milestoneDocumentTemplateFile.deleteMany({
      where: { milestoneDocument: { milestoneId } },
    });
    await this.transaction.milestoneDocument.deleteMany({
      where: { milestoneId },
    });
    await this.transaction.milestone.delete({ where: { id: milestoneId } });
  }

  private async findMilestoneProgramId(
    milestoneId: string,
  ): Promise<string | null> {
    const milestone = await this.transaction.milestone.findUnique({
      where: { id: milestoneId },
      select: { programId: true },
    });
    return milestone?.programId ?? null;
  }
}

@Injectable()
export class ProgramEditorRepository {
  constructor(private readonly prisma: PrismaService) {}

  withTransaction<T>(
    operation: (store: ProgramEditorTransactionStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((transaction) =>
      operation(new PrismaProgramEditorStore(transaction)),
    );
  }
}

class ProgramEditorMilestoneEditRaceError extends Error {
  override readonly name = 'ProgramEditorMilestoneEditRaceError';

  constructor() {
    super('Locked upload was unavailable during milestone edit.');
  }
}

const editableProgramInclude = {
  cover: { select: { id: true, imageUrl: true, sourceUrl: true } },
  _count: { select: { applications: true, teams: true, boardPosts: true } },
  milestones: { orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }] },
} satisfies PrismaTypes.ProgramInclude;

function toEditableProgramView(
  program: ProgramRecord,
  deletionScopeCounts: ProgramDeletionScopeCounts,
): EditableProgramView {
  return {
    coverImageUrl: programCoverImageUrl(
      program.id,
      program.cover?.id,
      program.cover?.imageUrl,
    ),
    externalCover:
      program.cover?.sourceUrl != null && program.cover.imageUrl != null
        ? {
            sourceUrl: program.cover.sourceUrl,
            imageUrl: program.cover.imageUrl,
          }
        : null,
    id: program.id,
    name: program.name,
    organizer: program.organizer,
    trackType: program.trackType,
    lifecycle: program.lifecycle,
    applicationTemplateKey: program.applicationTemplateKey,
    applicationTemplateVersion: program.applicationTemplateVersion,
    applicationCount: program._count.applications,
    teamCount: program._count.teams,
    deletionScopeCounts,
    applicationStartAt: program.applicationStartAt,
    applicationEndAt: program.applicationEndAt,
    startAt: program.startAt,
    endAt: program.endAt.toISOString(),
    teamMinSize: program.teamMinSize,
    teamMaxSize: program.teamMaxSize,
    repositoryProvisioningEnabled: program.repositoryProvisioningEnabled,
    notifyOnDeadline: program.notifyOnDeadline,
    description: program.description,
    milestones: program.milestones.map(toMilestoneView),
  };
}

function toMilestoneView(milestone: MilestoneRecord): ProgramMilestoneView {
  return {
    id: milestone.id,
    name: milestone.name,
    startAt: milestone.startAt,
    dueAt: milestone.dueAt,
    submissionType: milestone.submissionType,
    instructions: milestone.instructions,
  };
}
