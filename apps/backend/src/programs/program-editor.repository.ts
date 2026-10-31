import {
  ProgramCoverRepository,
  type ProgramCoverChange,
} from './program-cover.repository';
import { Injectable } from '@nestjs/common';
import {
  MilestoneDocumentKind,
  StaffAccessRequestStatus,
  SubmissionFileLifecycle,
  type Prisma as PrismaTypes,
  type AccountStatus,
  type MilestoneSubmissionType,
  type ProgramTrackType,
  type ProgramLifecycle,
} from '@prisma/client';
import { LockProgramTreeRepository } from '../platform/lock-program-tree.repository';
import { PrismaService } from '../platform/prisma.service';
import {
  ProgramDeletionScopeRepository,
  type ProgramDeletionScopeCounts,
} from './program-deletion-scope.repository';
import {
  ProgramAuthoringUploadTransactionRepository,
  type ProgramExternalCover,
  type ProgramAuthoringPendingUploadConsumption,
} from './program-authoring-upload-transaction.repository';
import { type ProgramAuthoringUploadToken } from './program-authoring-upload.config';
import { ProgramEditorMilestoneEditRaceError } from './program-editor.error';

export type ProgramAuthority = {
  readonly id: string;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
  readonly accountStatus: AccountStatus;
  readonly staffAccessRequests: readonly {
    readonly status: StaffAccessRequestStatus;
  }[];
};

export type ProgramMilestoneView = {
  readonly id: string;
  readonly name: string;
  readonly startAt: Date;
  readonly dueAt: Date;
  readonly submissionType: MilestoneSubmissionType | null;
  readonly instructions: string | null;
};

export type ProgramMilestoneDocumentView = {
  readonly id: string;
  readonly name: string;
  readonly required: boolean;
  readonly sortOrder: number;
  readonly templateFileName: string | null;
};

type ProgramMilestoneOperationView = {
  readonly startAt: Date;
  readonly endAt: Date;
};

export type ProgramMilestoneEditView = {
  readonly milestone: ProgramMilestoneView;
  readonly operation: ProgramMilestoneOperationView;
  readonly documents: readonly ProgramMilestoneDocumentView[];
  readonly fingerprint: string;
};

export type LockedProgramMilestoneEdit = {
  readonly programId: string;
  readonly view: Omit<ProgramMilestoneEditView, 'fingerprint'>;
  readonly milestoneUpdatedAt: Date;
  readonly fingerprintDocuments: readonly {
    readonly id: string;
    readonly name: string;
    readonly required: boolean;
    readonly sortOrder: number;
    readonly updatedAt: Date;
    readonly storageKey: string | null;
  }[];
};

type ApplyProgramMilestoneEditInput = {
  readonly actorId: string;
  readonly milestoneId: string;
  readonly name: string;
  readonly startAt: Date;
  readonly dueAt: Date;
  readonly instructions: string | null;
  readonly documents: readonly {
    readonly id: string | null;
    readonly name: string;
    readonly required: boolean;
    readonly templateUploadId?: string;
  }[];
  readonly uploads: readonly ProgramAuthoringUploadToken[];
};

export type EditableProgramRow = Omit<EditableProgramView, 'coverImageUrl'> & {
  readonly coverId: string | null;
  readonly coverExternalImageUrl: string | null;
};

export type EditableProgramView = {
  readonly externalCover?: ProgramExternalCover | null;
  readonly coverImageUrl?: string | null;
  readonly id: string;
  readonly name: string;
  readonly organizer: string;
  readonly trackType: ProgramTrackType | null;
  readonly lifecycle?: ProgramLifecycle;
  readonly applicationTemplateKey: string;
  readonly applicationTemplateVersion: number;
  readonly applicationCount: number;
  readonly teamCount: number;

  readonly deletionScopeCounts?: ProgramDeletionScopeCounts;
  readonly applicationStartAt: Date;
  readonly applicationEndAt: Date;
  readonly startAt: Date;
  readonly endAt: string;
  readonly teamMinSize: number;
  readonly teamMaxSize: number;
  readonly repositoryProvisioningEnabled: boolean;
  readonly notifyOnDeadline: boolean;
  readonly description: string;
  readonly milestones: readonly ProgramMilestoneView[];
};

type ProgramSchedule = {
  readonly id: string;
  readonly startAt: Date;
  readonly endAt: Date;
};

type ProgramMilestoneDeleteTarget = {
  readonly id: string;
  readonly programId: string;

  readonly documentSubmissionCount: number;
  readonly programMilestoneCount: number;
  readonly programRepositoryProvisioningEnabled: boolean;
};

type ProgramMilestoneTarget = ProgramMilestoneView & {
  readonly programId: string;
  readonly programStartAt: Date;
  readonly endAt: Date;
};

type ProgramUpdateInput = {
  readonly coverChange?: ProgramCoverChange;
  readonly programId: string;
  readonly name: string;
  readonly organizer: string;
  readonly trackType: ProgramTrackType;
  readonly applicationTemplateKey: string;
  readonly applicationTemplateVersion: number;
  readonly liveFileExpiresAt: Date | null;
  readonly applicationStartAt: Date;
  readonly applicationEndAt: Date;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly teamMinSize: number;
  readonly teamMaxSize: number;
  readonly repositoryProvisioningEnabled: boolean;
  readonly notifyOnDeadline: boolean;
  readonly description: string;
};

export type ProgramMilestoneInput = {
  readonly name: string;
  readonly startAt: Date;
  readonly dueAt: Date;
  readonly submissionType?: MilestoneSubmissionType | null;
  readonly instructions: string | null;
};

type ProgramMilestoneCreateInput = ProgramMilestoneInput & {
  readonly programId: string;
};

type ProgramMilestoneUpdateInput = ProgramMilestoneInput & {
  readonly milestoneId: string;
};

export interface ProgramEditorTransactionStore {
  findLatestDocumentGraceDueAt(programId: string): Promise<Date | null>;
  findEarliestDocumentGraceDueAt(
    milestoneId: string,
    excludedDocumentIds?: readonly string[],
  ): Promise<Date | null>;
  findUserAuthorityByGithubId(
    githubId: bigint,
  ): Promise<ProgramAuthority | null>;
  findEditableProgramById(
    programId: string,
  ): Promise<EditableProgramRow | null>;
  findEditableProgramForUpdate(
    programId: string,
  ): Promise<EditableProgramRow | null>;
  updateProgram(input: ProgramUpdateInput): Promise<EditableProgramRow>;
  findProgramScheduleForMilestoneCreate(
    programId: string,
  ): Promise<ProgramSchedule | null>;
  createMilestone(
    input: ProgramMilestoneCreateInput,
  ): Promise<ProgramMilestoneView>;

  findMilestoneForUpdate(
    milestoneId: string,
  ): Promise<ProgramMilestoneTarget | null>;

  updateMilestone(
    input: ProgramMilestoneUpdateInput,
  ): Promise<ProgramMilestoneView>;
  findMilestoneForDelete(
    milestoneId: string,
  ): Promise<ProgramMilestoneDeleteTarget | null>;
  deleteMilestone(milestoneId: string): Promise<void>;
  lockMilestoneEdit(
    milestoneId: string,
  ): Promise<LockedProgramMilestoneEdit | null>;
  readMilestoneEdit(
    milestoneId: string,
  ): Promise<LockedProgramMilestoneEdit | null>;
  countSubmissionHistoriesForDocuments(
    documentIds: readonly string[],
  ): Promise<number>;
  lockAttachableUploads(
    actorId: string,
    tokenIds: readonly string[],
  ): Promise<readonly ProgramAuthoringUploadToken[]>;
  applyMilestoneEdit(input: ApplyProgramMilestoneEditInput): Promise<void>;
}

type ProgramRecord = PrismaTypes.ProgramGetPayload<{
  include: typeof editableProgramInclude;
}>;
type MilestoneRecord = PrismaTypes.MilestoneGetPayload<Record<string, never>>;

class PrismaProgramEditorRepository implements ProgramEditorTransactionStore {
  constructor(
    private readonly transaction: PrismaTypes.TransactionClient,
    private readonly locks: LockProgramTreeRepository,
    private readonly programDeletionScope: ProgramDeletionScopeRepository,
  ) {}

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
  ): Promise<EditableProgramRow | null> {
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
  ): Promise<EditableProgramRow | null> {
    const locked = await this.locks.lockProgramTree(this.transaction, {
      stage: 'program',
      programId,
    });
    return locked ? this.findEditableProgramById(programId) : null;
  }

  async updateProgram(input: ProgramUpdateInput): Promise<EditableProgramRow> {
    if (input.coverChange !== undefined) {
      await ProgramCoverRepository.replaceProgramCover(this.transaction, {
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
    return this.programDeletionScope.readProgramDeletionScopeCounts(
      this.transaction,
      programId,
    );
  }

  async findProgramScheduleForMilestoneCreate(
    programId: string,
  ): Promise<ProgramSchedule | null> {
    const locked = await this.locks.lockProgramTree(this.transaction, {
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
    const programLocked = await this.locks.lockProgramTree(this.transaction, {
      stage: 'program',
      programId,
    });
    if (!programLocked) return null;
    const lockedMilestone = await this.locks.lockProgramTree(this.transaction, {
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

  async findLatestDocumentGraceDueAt(programId: string): Promise<Date | null> {
    const result = await this.transaction.milestoneDocument.aggregate({
      where: { milestone: { programId }, kind: MilestoneDocumentKind.DOCUMENT },
      _max: { graceDueAt: true },
    });
    return result._max.graceDueAt;
  }

  async findEarliestDocumentGraceDueAt(
    milestoneId: string,
    excludedDocumentIds: readonly string[] = [],
  ): Promise<Date | null> {
    const result = await this.transaction.milestoneDocument.aggregate({
      where: {
        milestoneId,
        kind: MilestoneDocumentKind.DOCUMENT,
        id: { notIn: [...excludedDocumentIds] },
      },
      _min: { graceDueAt: true },
    });
    return result._min.graceDueAt;
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
    const program = await this.locks.lockProgramTree(this.transaction, {
      stage: 'program',
      programId,
    });
    if (program === null) return null;
    const lockedMilestone = await this.locks.lockProgramTree(this.transaction, {
      stage: 'milestone',
      milestoneId,
      after: program,
    });
    if (lockedMilestone === null) return null;
    return this.readMilestoneEditWith(milestoneId, programId, async () => {
      await this.locks.lockProgramTree(this.transaction, {
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
    return ProgramAuthoringUploadTransactionRepository.lockAttachableProgramAuthoringUploads(
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
    await ProgramAuthoringUploadTransactionRepository.consumePendingProgramAuthoringUploads(
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
    const programLocked = await this.locks.lockProgramTree(this.transaction, {
      stage: 'program',
      programId,
    });
    if (!programLocked) return null;
    const lockedMilestone = await this.locks.lockProgramTree(this.transaction, {
      stage: 'milestone',
      milestoneId,
      after: programLocked,
    });
    if (lockedMilestone === null || lockedMilestone.programId !== programId) {
      return null;
    }

    await this.locks.lockProgramTree(this.transaction, {
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly locks: LockProgramTreeRepository,
    private readonly programDeletionScope: ProgramDeletionScopeRepository,
  ) {}

  withTransaction<T>(
    operation: (store: ProgramEditorTransactionStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((transaction) =>
      operation(
        new PrismaProgramEditorRepository(
          transaction,
          this.locks,
          this.programDeletionScope,
        ),
      ),
    );
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
): EditableProgramRow {
  return {
    coverId: program.cover?.id ?? null,
    coverExternalImageUrl: program.cover?.imageUrl ?? null,
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
