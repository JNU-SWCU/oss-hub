import { validateProgramCoverChoice } from './program-authoring-upload.service';
import { AccountStatus } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';
import {
  type ProblemDetailExtensions,
  DomainException,
} from '../platform/error-code.error';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from './milestone-documents-error-code.error';
import {
  ProgramEditorRepository,
  type ProgramMilestoneEditView,
  type ProgramAuthority,
  type ProgramEditorTransactionStore,
  type ProgramMilestoneInput,
  type LockedProgramMilestoneEdit,
} from './program-editor.repository';
import { ProgramAuthoringValidationError } from './program-authoring-validation.error';
import {
  PROGRAM_ERROR_CODES,
  ProgramErrorCode,
} from './program-error-code.error';
import { createHash } from 'node:crypto';
import { ProgramMilestoneEditValidationError } from './program-editor.error';
import { CreateProgramCommand } from './program-creation.service';
import { type ProgramExternalCover } from './program-authoring-upload-transaction.repository';
import { type ProgramAuthoringUploadToken } from './program-authoring-upload.config';
import { addOneCalendarYear } from './submission-file.config';
import { ProgramAuthoringUploadTokenError } from './program-authoring.error';
import { isProgramEndAtUndecided } from './programs.service';

export type UpdateProgramCommand = Omit<CreateProgramCommand, 'endAt'> & {
  readonly endAt?: string | null;
  readonly coverUploadId?: string | null;
  readonly externalCover?: ProgramExternalCover | null;
  readonly repositoryProvisioningEnabled: boolean;
  readonly notifyOnDeadline: boolean;
};

export type UpsertMilestoneCommand = {
  readonly name: string;
  readonly startAt?: string;
  readonly dueAt: string;
  readonly instructions?: string | null;
};

type EditMilestoneDocumentCommand = {
  readonly id: string | null;
  readonly name: string;
  readonly required: boolean;
  readonly templateUploadId?: string;
};

export type EditMilestoneCommand = {
  readonly name: string;
  readonly startAt: string;
  readonly dueAt: string;
  readonly instructions: string | null;
  readonly documents: readonly EditMilestoneDocumentCommand[];
  readonly expectedFingerprint: string;
};

export type MilestoneUpdateCommand =
  | { readonly kind: 'aggregate'; readonly input: EditMilestoneCommand }
  | { readonly kind: 'legacy'; readonly input: UpsertMilestoneCommand };

type ProgramMilestoneFingerprintDocument = {
  readonly id: string;
  readonly name: string;
  readonly required: boolean;
  readonly sortOrder: number;
  readonly updatedAt: Date;
  readonly storageKey: string | null;
};

export type ProgramMilestoneFingerprintInput = {
  readonly operation: ProgramMilestoneEditView['operation'];
  readonly milestone: ProgramMilestoneEditView['milestone'] & {
    readonly updatedAt: Date;
  };
  readonly documents: readonly ProgramMilestoneFingerprintDocument[];
};

export function fingerprintProgramMilestoneEdit(
  input: ProgramMilestoneFingerprintInput,
): string {
  const documents = [...input.documents]
    .sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    )
    .map((document) => [
      document.id,
      document.name,
      document.required,
      document.sortOrder,
      document.updatedAt.toISOString(),
      document.storageKey === null
        ? null
        : ['storage-key', document.storageKey],
    ]);
  const payload = [
    1,
    [
      input.operation.startAt.toISOString(),
      input.operation.endAt.toISOString(),
    ],
    [
      input.milestone.id,
      input.milestone.name,
      input.milestone.startAt.toISOString(),
      input.milestone.dueAt.toISOString(),
      input.milestone.submissionType,
      input.milestone.instructions,
      input.milestone.updatedAt.toISOString(),
    ],
    documents,
  ];
  return createHash('sha256')
    .update(JSON.stringify(payload), 'utf8')
    .digest('hex');
}

export function preflightProgramMilestoneEditDocuments(
  documents: readonly {
    readonly id: string | null;
    readonly templateUploadId?: string;
  }[],
): void {
  if (documents.length > 20) {
    throw new ProgramMilestoneEditValidationError('documents', 'MAX_SIZE');
  }
  assertDistinct(
    documents.flatMap((document, index) =>
      document.id === null ? [] : [{ value: document.id, index }],
    ),
    'id',
    'DUPLICATE_DOCUMENT_ID',
  );
  assertDistinct(
    documents.flatMap((document, index) =>
      document.templateUploadId === undefined
        ? []
        : [{ value: document.templateUploadId, index }],
    ),
    'templateUploadId',
    'DUPLICATE_UPLOAD_TOKEN',
  );
}

function assertDistinct(
  values: readonly { readonly value: string; readonly index: number }[],
  field: string,
  code: string,
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value.value)) {
      throw new ProgramMilestoneEditValidationError(
        `documents[${value.index}].${field}`,
        code,
      );
    }
    seen.add(value.value);
  }
}

const INVALID_APPLICATION_PERIOD_FIELD_ERRORS = [
  {
    field: 'applicationStartAt',
    code: 'INVALID_APPLICATION_PERIOD',
    message: 'Application period must start before it ends.',
  },
  {
    field: 'applicationEndAt',
    code: 'INVALID_APPLICATION_PERIOD',
    message: 'Application period must end after it starts.',
  },
] as const;

const INVALID_TEAM_RANGE_FIELD_ERRORS = [
  {
    field: 'teamMinSize',
    code: 'INVALID_TEAM_RANGE',
    message: 'Team minimum size is required for this category.',
  },
  {
    field: 'teamMaxSize',
    code: 'INVALID_TEAM_RANGE',
    message: 'Team maximum size must be greater than or equal to minimum size.',
  },
] as const;

const INVALID_PROGRAM_END_FIELD_ERROR = {
  field: 'endAt',
  code: 'INVALID_PROGRAM_END',
  message:
    '프로그램 종료일은 유효한 시각이어야 하고 운영 시작일 이후이며 신청 종료일과 모든 마일스톤 마감과 같거나 이후여야 합니다.',
} as const;

const MILESTONE_AFTER_PROGRAM_END_FIELD_ERROR = {
  field: 'dueAt',
  code: 'INVALID_MILESTONE_PERIOD',
  message: 'Milestone due date must be on or before program end.',
} as const;

const INVALID_PROGRAM_START_FIELD_ERROR = {
  field: 'startAt',
  code: 'INVALID_PROGRAM_START',
  message: 'Program start must be a valid date.',
} as const;

const MILESTONE_BEFORE_PROGRAM_START_FIELD_ERROR = {
  field: 'startAt',
  code: 'INVALID_PROGRAM_START',
  message:
    '운영 시작일은 모든 마일스톤 시작일보다 이르거나 같아야 합니다. 마일스톤 시작일을 먼저 바꿔 주세요.',
} as const;

const INVALID_MILESTONE_START_FIELD_ERROR = {
  field: 'startAt',
  code: 'INVALID_MILESTONE_PERIOD',
  message:
    'Milestone start must be within the Program and before its due date.',
} as const;

@Injectable()
export class ProgramEditorService {
  constructor(
    @Inject(ProgramEditorRepository)
    private readonly repository: Pick<
      ProgramEditorRepository,
      'withTransaction'
    >,
  ) {}

  getProgram(githubId: bigint, programId: string) {
    return this.repository.withTransaction(async (store) => {
      await this.requireEditor(store, githubId);
      const program = await store.findEditableProgramById(programId);
      if (program === null) this.fail(ProgramErrorCode.PROGRAM_NOT_FOUND);
      return program;
    });
  }

  updateProgram(
    githubId: bigint,
    programId: string,
    input: UpdateProgramCommand,
  ) {
    return this.repository.withTransaction(async (store) => {
      const actor = await this.requireEditor(store, githubId);
      const existing = await store.findEditableProgramForUpdate(programId);
      if (existing === null) this.fail(ProgramErrorCode.PROGRAM_NOT_FOUND);
      const name = input.name.trim();
      const organizer = input.organizer.trim();
      const description = input.description.trim();
      const applicationStartAt = new Date(input.applicationStartAt);
      const applicationEndAt = new Date(input.applicationEndAt);
      const startAt = new Date(input.startAt ?? existing.startAt.toISOString());
      const requestedEndAt =
        input.endAt === undefined ? existing.endAt : input.endAt;
      const endAt =
        requestedEndAt === null
          ? new Date(Number.NaN)
          : new Date(requestedEndAt);
      const liveFileExpiresAt =
        endAt.getTime() !== new Date(existing.endAt).getTime()
          ? addOneCalendarYear(endAt)
          : null;
      const teamSize = resolveTeamSize(input, existing);

      const emptyFieldErrors: {
        field: string;
        code: string;
        message: string;
      }[] = [];
      if (!name) {
        emptyFieldErrors.push({
          field: 'name',
          code: 'REQUIRED',
          message: '프로그램 이름을 입력해 주세요.',
        });
      }
      if (!organizer) {
        emptyFieldErrors.push({
          field: 'organizer',
          code: 'REQUIRED',
          message: '주최를 입력해 주세요.',
        });
      }
      if (!description) {
        emptyFieldErrors.push({
          field: 'description',
          code: 'REQUIRED',
          message: '프로그램 설명을 입력해 주세요.',
        });
      }
      if (emptyFieldErrors.length > 0) {
        this.fail(ProgramErrorCode.VALIDATION_ERROR, {
          fieldErrors: emptyFieldErrors,
        });
      }
      if (teamSize === null) {
        this.fail(ProgramErrorCode.VALIDATION_ERROR, {
          fieldErrors: INVALID_TEAM_RANGE_FIELD_ERRORS,
        });
      }
      if (!validPeriod(applicationStartAt, applicationEndAt)) {
        this.fail(ProgramErrorCode.INVALID_APPLICATION_PERIOD, {
          fieldErrors: INVALID_APPLICATION_PERIOD_FIELD_ERRORS,
        });
      }
      if (!Number.isFinite(startAt.getTime())) {
        this.fail(ProgramErrorCode.VALIDATION_ERROR, {
          fieldErrors: [INVALID_PROGRAM_START_FIELD_ERROR],
        });
      }
      if (
        !Number.isFinite(endAt.getTime()) ||
        startAt >= endAt ||
        (input.endAt !== undefined && isProgramEndAtUndecided(endAt))
      ) {
        this.fail(ProgramErrorCode.VALIDATION_ERROR, {
          fieldErrors: [INVALID_PROGRAM_END_FIELD_ERROR],
        });
      }
      if (applicationEndAt > endAt) {
        this.fail(ProgramErrorCode.VALIDATION_ERROR, {
          fieldErrors: [INVALID_PROGRAM_END_FIELD_ERROR],
        });
      }

      if (
        existing.milestones.some((milestone) => milestone.startAt < startAt)
      ) {
        this.fail(ProgramErrorCode.VALIDATION_ERROR, {
          fieldErrors: [MILESTONE_BEFORE_PROGRAM_START_FIELD_ERROR],
        });
      }
      if (existing.milestones.some((milestone) => milestone.dueAt > endAt)) {
        this.fail(ProgramErrorCode.VALIDATION_ERROR, {
          fieldErrors: [INVALID_PROGRAM_END_FIELD_ERROR],
        });
      }
      if (liveFileExpiresAt !== null) {
        const latestGrace = await store.findLatestDocumentGraceDueAt(programId);
        if (latestGrace !== null && latestGrace >= liveFileExpiresAt) {
          this.fail(ProgramErrorCode.VALIDATION_ERROR, {
            fieldErrors: [
              {
                field: 'endAt',
                code: 'INVALID_PROGRAM_END',
                message:
                  '프로그램 종료일을 변경하려면 서류 유예 기한이 파일 보관 만료 시각보다 앞이어야 합니다. 유예 기한을 먼저 변경해 주세요.',
              },
            ],
          });
        }
      }
      if (
        input.repositoryProvisioningEnabled &&
        existing.milestones.length === 0
      ) {
        this.fail(ProgramErrorCode.MILESTONE_REQUIRED);
      }
      try {
        const externalCover = validateProgramCoverChoice(input);
        return await store.updateProgram({
          ...(externalCover !== undefined
            ? { coverChange: { actorId: actor.id, externalCover } }
            : input.coverUploadId === undefined
              ? {}
              : {
                  coverChange: {
                    actorId: actor.id,
                    uploadId: input.coverUploadId,
                  },
                }),
          programId,
          name,
          organizer,
          trackType: input.trackType,
          applicationTemplateKey: existing.applicationTemplateKey,
          applicationTemplateVersion: existing.applicationTemplateVersion,
          applicationStartAt,
          applicationEndAt,
          startAt,
          endAt,
          liveFileExpiresAt,
          teamMinSize: teamSize.teamMinSize,
          teamMaxSize: teamSize.teamMaxSize,
          repositoryProvisioningEnabled: input.repositoryProvisioningEnabled,
          notifyOnDeadline: input.notifyOnDeadline,
          description,
        });
      } catch (error) {
        if (error instanceof ProgramAuthoringValidationError) {
          this.fail(ProgramErrorCode.VALIDATION_ERROR, {
            fieldErrors: error.issues.map(({ path, code }) => ({
              field: path,
              code,
              message: '대표 이미지 출처를 다시 확인해 주세요.',
            })),
          });
        }
        if (!(error instanceof ProgramAuthoringUploadTokenError)) throw error;
        this.fail(ProgramErrorCode.VALIDATION_ERROR, {
          fieldErrors: [
            {
              field: 'coverUploadId',
              code: 'INVALID_UPLOAD_TOKEN',
              message: '대표 이미지를 다시 선택해 주세요.',
            },
          ],
        });
      }
    });
  }

  createMilestone(
    githubId: bigint,
    programId: string,
    input: UpsertMilestoneCommand,
  ) {
    return this.repository.withTransaction(async (store) => {
      await this.requireEditor(store, githubId);
      const program =
        await store.findProgramScheduleForMilestoneCreate(programId);
      if (program === null) this.fail(ProgramErrorCode.PROGRAM_NOT_FOUND);
      return store.createMilestone({
        programId,
        ...this.milestoneData(input, program.startAt, program.endAt),
      });
    });
  }

  updateMilestone(
    githubId: bigint,
    milestoneId: string,
    input: UpsertMilestoneCommand,
  ) {
    return this.repository.withTransaction(async (store) => {
      await this.requireEditor(store, githubId);
      const milestone = await store.findMilestoneForUpdate(milestoneId);
      if (milestone === null) this.fail(ProgramErrorCode.MILESTONE_NOT_FOUND);
      const metadata = this.milestoneData(
        input,
        milestone.programStartAt,
        milestone.endAt,
        milestone.submissionType,
      );
      const earliestGraceDueAt =
        await store.findEarliestDocumentGraceDueAt(milestoneId);
      this.assertDueBeforeDocumentGrace(metadata.dueAt, earliestGraceDueAt);
      return store.updateMilestone({ milestoneId, ...metadata });
    });
  }

  getMilestoneEdit(
    githubId: bigint,
    milestoneId: string,
  ): Promise<ProgramMilestoneEditView> {
    return this.repository.withTransaction(async (store) => {
      await this.requireEditor(store, githubId);
      const locked = await store.lockMilestoneEdit(milestoneId);
      if (locked === null) this.fail(ProgramErrorCode.MILESTONE_NOT_FOUND);
      return this.snapshotMilestoneEdit(locked);
    });
  }

  updateMilestoneEdit(
    githubId: bigint,
    milestoneId: string,
    input: EditMilestoneCommand,
  ): Promise<ProgramMilestoneEditView> {
    return this.repository.withTransaction(async (store) => {
      const actor = await this.requireEditor(store, githubId);
      try {
        preflightProgramMilestoneEditDocuments(input.documents);
      } catch (error) {
        if (!(error instanceof ProgramMilestoneEditValidationError))
          throw error;
        this.fail(ProgramErrorCode.VALIDATION_ERROR, {
          fieldErrors: [
            {
              field: error.field,
              code: error.code,
              message: '마일스톤 제출 항목이 중복되었거나 너무 많습니다.',
            },
          ],
        });
      }
      const locked = await store.lockMilestoneEdit(milestoneId);
      if (locked === null) this.fail(ProgramErrorCode.MILESTONE_NOT_FOUND);
      const current = this.snapshotMilestoneEdit(locked);
      if (input.expectedFingerprint !== current.fingerprint) {
        this.fail(ProgramErrorCode.MILESTONE_EDIT_CHANGED);
      }
      const existingIds = new Set(
        locked.view.documents.map((document) => document.id),
      );
      for (const document of input.documents) {
        if (document.id !== null && !existingIds.has(document.id)) {
          this.fail(ProgramErrorCode.VALIDATION_ERROR);
        }
      }
      const requestedIds = new Set(
        input.documents.flatMap((document) =>
          document.id === null ? [] : [document.id],
        ),
      );
      if (locked.view.documents.length > 0 && input.documents.length === 0) {
        throw new DomainException(
          MILESTONE_DOCUMENTS_ERROR_CODES[
            MilestoneDocumentsErrorCode.LAST_DOCUMENT_REQUIRED
          ],
        );
      }
      const deletedIds = locked.view.documents
        .map((document) => document.id)
        .filter((documentId) => !requestedIds.has(documentId));
      if ((await store.countSubmissionHistoriesForDocuments(deletedIds)) > 0) {
        this.fail(ProgramErrorCode.MILESTONE_HAS_SUBMISSIONS);
      }
      const metadata = this.editMilestoneData(
        input,
        locked.view.operation.startAt,
        locked.view.operation.endAt,
        locked.view.milestone.submissionType,
      );
      const earliestGraceDueAt = await store.findEarliestDocumentGraceDueAt(
        milestoneId,
        deletedIds,
      );
      this.assertDueBeforeDocumentGrace(metadata.dueAt, earliestGraceDueAt);
      const tokenIds = input.documents.flatMap((document) =>
        document.templateUploadId === undefined
          ? []
          : [document.templateUploadId],
      );
      let uploads: readonly ProgramAuthoringUploadToken[];
      try {
        uploads = await store.lockAttachableUploads(actor.id, tokenIds);
      } catch (error) {
        if (!(error instanceof ProgramAuthoringUploadTokenError)) throw error;
        this.fail(ProgramErrorCode.VALIDATION_ERROR, {
          fieldErrors: uploadTokenFieldErrors(input.documents, error.tokenIds),
        });
      }
      await store.applyMilestoneEdit({
        actorId: actor.id,
        milestoneId,
        ...metadata,
        documents: input.documents,
        uploads,
      });
      const updated = await store.readMilestoneEdit(milestoneId);
      if (updated === null) this.fail(ProgramErrorCode.MILESTONE_NOT_FOUND);
      return this.snapshotMilestoneEdit(updated);
    });
  }

  deleteMilestone(githubId: bigint, milestoneId: string): Promise<void> {
    return this.repository.withTransaction(async (store) => {
      await this.requireEditor(store, githubId);
      const milestone = await store.findMilestoneForDelete(milestoneId);
      if (milestone === null) this.fail(ProgramErrorCode.MILESTONE_NOT_FOUND);

      if (milestone.documentSubmissionCount > 0) {
        this.fail(ProgramErrorCode.MILESTONE_HAS_SUBMISSIONS);
      }
      if (
        milestone.programRepositoryProvisioningEnabled &&
        milestone.programMilestoneCount === 1
      ) {
        this.fail(ProgramErrorCode.MILESTONE_REQUIRED);
      }
      await store.deleteMilestone(milestoneId);
    });
  }

  private assertDueBeforeDocumentGrace(
    dueAt: Date,
    earliestGraceDueAt: Date | null,
  ): void {
    if (
      earliestGraceDueAt !== null &&
      dueAt.getTime() >= earliestGraceDueAt.getTime()
    ) {
      this.fail(ProgramErrorCode.VALIDATION_ERROR, {
        fieldErrors: [
          {
            field: 'dueAt',
            code: 'DOCUMENT_GRACE_DUE_AT_CONFLICT',
            message:
              '마감은 서류 유예 기한보다 앞이어야 합니다. 서류 유예 기한을 먼저 변경하거나 해제해 주세요.',
          },
        ],
      });
    }
  }

  private snapshotMilestoneEdit(
    locked: LockedProgramMilestoneEdit,
  ): ProgramMilestoneEditView {
    return {
      ...locked.view,
      fingerprint: fingerprintProgramMilestoneEdit({
        operation: locked.view.operation,
        milestone: {
          ...locked.view.milestone,
          updatedAt: locked.milestoneUpdatedAt,
        },
        documents: locked.fingerprintDocuments,
      }),
    };
  }

  private editMilestoneData(
    input: EditMilestoneCommand,
    programStartAt: Date,
    endAt: Date,
    existingSubmissionType: ProgramMilestoneInput['submissionType'],
  ): ProgramMilestoneInput {
    return this.milestoneData(
      {
        name: input.name,
        startAt: input.startAt,
        dueAt: input.dueAt,
        instructions: input.instructions,
      },
      programStartAt,
      endAt,
      existingSubmissionType,
    );
  }

  private async requireEditor(
    store: ProgramEditorTransactionStore,
    githubId: bigint,
  ): Promise<ProgramAuthority> {
    const authority = await store.findUserAuthorityByGithubId(githubId);
    const errorCode = editorPermissionError(authority);
    if (errorCode !== null) this.fail(errorCode);
    if (authority === null) this.fail(ProgramErrorCode.FORBIDDEN);
    return authority;
  }

  private milestoneData(
    input: UpsertMilestoneCommand,
    programStartAt: Date,
    endAt: Date,
    existingSubmissionType: ProgramMilestoneInput['submissionType'] = null,
  ): ProgramMilestoneInput {
    const name = input.name.trim();
    const startAt = input.startAt ? new Date(input.startAt) : programStartAt;
    const dueAt = new Date(input.dueAt);
    const milestoneFieldErrors: {
      field: string;
      code: string;
      message: string;
    }[] = [];
    if (!name) {
      milestoneFieldErrors.push({
        field: 'name',
        code: 'REQUIRED',
        message: '마일스톤 이름을 입력해 주세요.',
      });
    }
    if (Number.isNaN(dueAt.getTime())) {
      milestoneFieldErrors.push({
        field: 'dueAt',
        code: 'REQUIRED',
        message: '유효한 마감일을 입력해 주세요.',
      });
    }
    if (Number.isNaN(startAt.getTime())) {
      milestoneFieldErrors.push({
        field: 'startAt',
        code: 'REQUIRED',
        message: '유효한 시작일을 입력해 주세요.',
      });
    }
    if (milestoneFieldErrors.length > 0) {
      this.fail(ProgramErrorCode.VALIDATION_ERROR, {
        fieldErrors: milestoneFieldErrors,
      });
    }
    if (startAt < programStartAt || startAt >= dueAt) {
      this.fail(ProgramErrorCode.VALIDATION_ERROR, {
        fieldErrors: [INVALID_MILESTONE_START_FIELD_ERROR],
      });
    }
    if (dueAt > endAt) {
      this.fail(ProgramErrorCode.VALIDATION_ERROR, {
        fieldErrors: [MILESTONE_AFTER_PROGRAM_END_FIELD_ERROR],
      });
    }
    const instructions = input.instructions?.trim() || null;
    return {
      name,
      startAt,
      dueAt,
      submissionType: existingSubmissionType,
      instructions,
    };
  }

  private fail(
    code: ProgramErrorCode,
    extensions: ProblemDetailExtensions = {},
  ): never {
    throw new DomainException(PROGRAM_ERROR_CODES[code], extensions);
  }
}

function uploadTokenFieldErrors(
  documents: readonly {
    readonly templateUploadId?: string;
  }[],
  tokenIds: readonly string[],
) {
  const failedTokenIds = new Set(tokenIds);
  return documents.flatMap((document, index) =>
    document.templateUploadId !== undefined &&
    failedTokenIds.has(document.templateUploadId)
      ? [
          {
            field: `documents[${index}].templateUploadId`,
            code: 'INVALID_UPLOAD_TOKEN',
            message: '업로드 파일을 다시 준비한 뒤 저장해 주세요.',
          },
        ]
      : [],
  );
}

function editorPermissionError(
  authority: ProgramAuthority | null,
): ProgramErrorCode | null {
  if (authority?.accountStatus !== AccountStatus.ACTIVE) {
    return ProgramErrorCode.FORBIDDEN;
  }
  if (authority.hasStaffAccess || authority.hasAdminAccess) {
    return null;
  }
  if (authority.staffAccessRequests.length > 0) {
    return ProgramErrorCode.STAFF_APPROVAL_REQUIRED;
  }
  return ProgramErrorCode.FORBIDDEN;
}

function validPeriod(startAt: Date, endAt: Date): boolean {
  return (
    !Number.isNaN(startAt.getTime()) &&
    !Number.isNaN(endAt.getTime()) &&
    endAt >= startAt
  );
}

function resolveTeamSize(
  input: Pick<UpdateProgramCommand, 'teamMinSize' | 'teamMaxSize'>,
  current: {
    readonly teamMinSize: number;
    readonly teamMaxSize: number;
  },
): {
  readonly teamMinSize: number;
  readonly teamMaxSize: number;
} | null {
  const min = input.teamMinSize ?? current.teamMinSize;
  const max = input.teamMaxSize ?? current.teamMaxSize;
  if (!Number.isInteger(min) || !Number.isInteger(max)) return null;
  if (min < 1 || min > max) return null;
  return { teamMinSize: min, teamMaxSize: max };
}
