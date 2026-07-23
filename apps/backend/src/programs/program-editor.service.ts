import { AccountStatus, Role } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';
import type { ProblemDetailExtensions } from '../common/error-code';
import { DomainException } from '../common/error-code';
import type { UpdateProgramRequestDto } from './dto/update-program-request.dto';
import type { UpsertMilestoneRequestDto } from './dto/upsert-milestone-request.dto';
import { ProgramEditorRepository } from './program-editor.repository';
import type {
  ProgramAuthority,
  ProgramEditorRepositoryPort,
  ProgramEditorTransactionStore,
  ProgramEditorTransactionStore as ReexportedProgramEditorTransactionStore,
  ProgramMilestoneInput,
} from './program-editor.types';
import {
  PROGRAM_ERROR_CODES,
  ProgramErrorCode,
} from './program-error-code.enum';
import {
  getProgramTemplate,
  PROGRAM_PARTICIPATION,
} from './program-template.registry';

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
      const template = getProgramTemplate(input.category);
      const teamSize = teamSizeForTemplate(input, template.participation);

      if (!name || !organizer || !description) {
        this.fail(ProgramErrorCode.VALIDATION_ERROR);
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
      if (
        (existing.applicationCount > 0 || existing.teamCount > 0) &&
        existing.category !== input.category
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
        applicationTemplateKey: template.key,
        applicationTemplateVersion: template.version,
        applicationStartAt,
        applicationEndAt,
        teamMinSize: teamSize.teamMinSize,
        teamMaxSize: teamSize.teamMaxSize,
        repositoryProvisioningEnabled: input.repositoryProvisioningEnabled,
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
        ...this.milestoneData(input, program.applicationEndAt),
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
        ...this.milestoneData(input, milestone.applicationEndAt),
      });
    });
  }

  deleteMilestone(githubId: bigint, milestoneId: string): Promise<void> {
    return this.repository.withTransaction(async (store) => {
      await this.requireEditor(store, githubId);
      const milestone = await store.findMilestoneForDelete(milestoneId);
      if (milestone === null) this.fail(ProgramErrorCode.MILESTONE_NOT_FOUND);
      if (milestone.submissionCount > 0) {
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
    applicationEndAt: Date,
  ): ProgramMilestoneInput {
    const name = input.name.trim();
    const dueAt = new Date(input.dueAt);
    if (!name || Number.isNaN(dueAt.getTime())) {
      this.fail(ProgramErrorCode.VALIDATION_ERROR);
    }
    if (dueAt <= applicationEndAt) {
      this.fail(ProgramErrorCode.MILESTONE_BEFORE_APPLICATION_END);
    }
    const instructions = input.instructions?.trim() || null;
    return {
      name,
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
    endAt > startAt
  );
}

function teamSizeForTemplate(
  input: Pick<UpdateProgramRequestDto, 'teamMinSize' | 'teamMaxSize'>,
  participation: string,
): {
  readonly teamMinSize: number | null;
  readonly teamMaxSize: number | null;
} | null {
  if (participation === PROGRAM_PARTICIPATION.INDIVIDUAL) {
    return { teamMinSize: null, teamMaxSize: null };
  }
  const min = input.teamMinSize;
  const max = input.teamMaxSize;
  if (min === null || min === undefined || max === null || max === undefined) {
    return null;
  }
  if (min < 1 || min > max) return null;
  return { teamMinSize: min, teamMaxSize: max };
}
