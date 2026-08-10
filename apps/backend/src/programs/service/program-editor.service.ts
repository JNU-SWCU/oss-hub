import { AccountStatus, Role } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';
import { addOneCalendarYear } from '../../common/add-one-calendar-year';
import type { ProblemDetailExtensions } from '../../common/error-code';
import { DomainException } from '../../common/error-code';
import type { UpdateProgramRequestDto } from '../dto/update-program-request.dto';
import type { UpsertMilestoneRequestDto } from '../dto/upsert-milestone-request.dto';
import { ProgramEditorRepository } from '../repository/program-editor.repository';
import type {
  ProgramAuthority,
  ProgramEditorRepositoryPort,
  ProgramEditorTransactionStore,
  ProgramEditorTransactionStore as ReexportedProgramEditorTransactionStore,
  ProgramMilestoneInput,
} from '../program-editor.types';
import {
  PROGRAM_ERROR_CODES,
  ProgramErrorCode,
} from '../program-error-code.enum';
import { getProgramTemplate } from '../program-template.registry';

export type {
  ProgramEditorRepositoryPort,
  ReexportedProgramEditorTransactionStore as ProgramEditorTransactionStore,
};

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
    'Program end must be after the application period and every milestone.',
} as const;

const MILESTONE_AFTER_PROGRAM_END_FIELD_ERROR = {
  field: 'dueAt',
  code: 'INVALID_MILESTONE_PERIOD',
  message: 'Milestone due date must be before program end.',
} as const;

const INVALID_PROGRAM_START_FIELD_ERROR = {
  field: 'startAt',
  code: 'INVALID_PROGRAM_START',
  message:
    'Program start must be after applications close and before Program end.',
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
    private readonly repository: ProgramEditorRepositoryPort,
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
    input: UpdateProgramRequestDto,
  ) {
    return this.repository.withTransaction(async (store) => {
      await this.requireEditor(store, githubId);
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
      const categoryChanged = existing.category !== input.category;
      const template = getProgramTemplate(input.category);
      const teamSize = teamSizeForTemplate(input, template.teamSize);
      // Preserve template binding when category is unchanged so past Application.answers
      // keep a stable validation baseline (even if the registry later bumps versions).
      const applicationTemplateKey = categoryChanged
        ? template.key
        : existing.applicationTemplateKey;
      const applicationTemplateVersion = categoryChanged
        ? template.version
        : existing.applicationTemplateVersion;

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
      if (!Number.isFinite(startAt.getTime()) || startAt < applicationEndAt) {
        this.fail(ProgramErrorCode.VALIDATION_ERROR, {
          fieldErrors: [INVALID_PROGRAM_START_FIELD_ERROR],
        });
      }
      if (!Number.isFinite(endAt.getTime()) || startAt >= endAt) {
        this.fail(ProgramErrorCode.VALIDATION_ERROR, {
          fieldErrors: [INVALID_PROGRAM_END_FIELD_ERROR],
        });
      }
      if (
        existing.milestones.some(
          (milestone) =>
            milestone.startAt < startAt || milestone.dueAt >= endAt,
        )
      ) {
        this.fail(ProgramErrorCode.VALIDATION_ERROR, {
          fieldErrors: [INVALID_PROGRAM_END_FIELD_ERROR],
        });
      }
      if (
        (existing.applicationCount > 0 || existing.teamCount > 0) &&
        categoryChanged
      ) {
        this.fail(ProgramErrorCode.CATEGORY_LOCKED_BY_APPLICATIONS);
      }
      if (
        input.repositoryProvisioningEnabled &&
        existing.milestones.length === 0
      ) {
        this.fail(ProgramErrorCode.MILESTONE_REQUIRED);
      }
      if (
        existing.milestones.some(
          (milestone) => milestone.dueAt <= applicationEndAt,
        )
      ) {
        this.fail(ProgramErrorCode.MILESTONE_BEFORE_APPLICATION_END);
      }

      return store.updateProgram({
        programId,
        name,
        organizer,
        category: input.category,
        applicationTemplateKey,
        applicationTemplateVersion,
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
    });
  }

  createMilestone(
    githubId: bigint,
    programId: string,
    input: UpsertMilestoneRequestDto,
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
    input: UpsertMilestoneRequestDto,
  ) {
    return this.repository.withTransaction(async (store) => {
      await this.requireEditor(store, githubId);
      const milestone = await store.findMilestoneForUpdate(milestoneId);
      if (milestone === null) this.fail(ProgramErrorCode.MILESTONE_NOT_FOUND);
      return store.updateMilestone({
        milestoneId,
        ...this.milestoneData(input, milestone.programStartAt, milestone.endAt),
      });
    });
  }

  deleteMilestone(githubId: bigint, milestoneId: string): Promise<void> {
    return this.repository.withTransaction(async (store) => {
      await this.requireEditor(store, githubId);
      const milestone = await store.findMilestoneForDelete(milestoneId);
      if (milestone === null) this.fail(ProgramErrorCode.MILESTONE_NOT_FOUND);
      // 제출물이 있으면 지우지 않는다 — 옛 Submission/SubmissionFile 경로든 서류 항목
      // (MilestoneDocumentSubmission) 경로든 「제출물이 있다」는 뜻이 같아 같은 코드로 거부한다.
      if (
        milestone.submissionCount > 0 ||
        milestone.documentSubmissionCount > 0
      ) {
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

  private async requireEditor(
    store: ProgramEditorTransactionStore,
    githubId: bigint,
  ): Promise<void> {
    const authority = await store.findUserAuthorityByGithubId(githubId);
    const errorCode = editorPermissionError(authority);
    if (errorCode !== null) this.fail(errorCode);
  }

  private milestoneData(
    input: UpsertMilestoneRequestDto,
    programStartAt: Date,
    endAt: Date,
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
    if (dueAt >= endAt) {
      this.fail(ProgramErrorCode.VALIDATION_ERROR, {
        fieldErrors: [MILESTONE_AFTER_PROGRAM_END_FIELD_ERROR],
      });
    }
    const instructions = input.instructions?.trim() || null;
    return {
      name,
      startAt,
      dueAt,
      submissionType: input.submissionType,
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

function editorPermissionError(
  authority: ProgramAuthority | null,
): ProgramErrorCode | null {
  if (authority?.accountStatus !== AccountStatus.ACTIVE) {
    return ProgramErrorCode.FORBIDDEN;
  }
  if (authority.role === Role.STAFF || authority.role === Role.ADMIN) {
    return null;
  }
  if (authority.role === null && authority.roleRequests.length > 0) {
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

function teamSizeForTemplate(
  input: Pick<UpdateProgramRequestDto, 'teamMinSize' | 'teamMaxSize'>,
  defaults: {
    readonly defaultMin: number;
    readonly defaultMax: number;
  },
): {
  readonly teamMinSize: number;
  readonly teamMaxSize: number;
} | null {
  const min = input.teamMinSize ?? defaults.defaultMin;
  const max = input.teamMaxSize ?? defaults.defaultMax;
  if (min < 1 || min > max) return null;
  return { teamMinSize: min, teamMaxSize: max };
}
