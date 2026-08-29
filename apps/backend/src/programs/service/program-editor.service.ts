import { AccountStatus } from '@prisma/client';
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
      const teamSize = resolveTeamSize(input, existing);
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
      if (!Number.isFinite(startAt.getTime())) {
        this.fail(ProgramErrorCode.VALIDATION_ERROR, {
          fieldErrors: [INVALID_PROGRAM_START_FIELD_ERROR],
        });
      }
      if (!Number.isFinite(endAt.getTime()) || startAt >= endAt) {
        this.fail(ProgramErrorCode.VALIDATION_ERROR, {
          fieldErrors: [INVALID_PROGRAM_END_FIELD_ERROR],
        });
      }
      if (applicationEndAt > endAt) {
        this.fail(ProgramErrorCode.VALIDATION_ERROR, {
          fieldErrors: [INVALID_PROGRAM_END_FIELD_ERROR],
        });
      }
      // Milestone starts that fall before the new program start are a startAt
      // problem. Reporting them on endAt made a later end date look invalid.
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
        ...this.milestoneData(
          input,
          milestone.programStartAt,
          milestone.endAt,
          milestone.submissionType,
        ),
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

/**
 * 요청이 팀 인원을 싣지 않으면 **지금 저장된 값을 그대로 둔다.**
 *
 * 예전에는 템플릿 기본값(1명~1명)으로 대체했다. 그러면 "이 항목을 보내지 않았다"가
 * "기본값으로 되돌려라"로 읽힌다. 개인형 유형 프로그램은 수정 화면이 팀 인원 칸을
 * 렌더하지 않아 값을 실을 수 없었고, 그래서 교직원이 설명 한 줄만 고쳐 저장해도
 * 정원이 조용히 1로 깎였다(#936). 정원이 1이 되면 참여 코드 합류·팀 초대·초대 수락이
 * 전부 `TEAM_007`·`TIV_009`로 막힌다.
 *
 * 화면 쪽 원인(칸을 안 보여 주던 것)은 따로 고쳤지만, 그 화면만 고치면 다른 호출자가
 * 값을 생략하는 순간 같은 사고가 재현된다. 생략은 변경 없음이고, 정원을 바꾸려면
 * 값을 명시해야 한다.
 */
function resolveTeamSize(
  input: Pick<UpdateProgramRequestDto, 'teamMinSize' | 'teamMaxSize'>,
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
