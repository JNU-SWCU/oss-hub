import { Injectable } from '@nestjs/common';
import { AccountStatus, ProgramCategory } from '@prisma/client';
import {
  createProgramCreatedAuditMetadata,
  PROGRAM_CREATED_AUDIT_ACTIONS,
} from '../../audit-log/audit-log-metadata';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { DomainException } from '../../common/error-code';
import type { CreateProgramRequestDto } from '../dto/create-program-request.dto';
import { ProgramsRepository } from '../repository/programs.repository';
import {
  PROGRAM_ERROR_CODES,
  ProgramErrorCode,
} from '../program-error-code.enum';
import { getProgramTemplate } from '../program-template.registry';

const INVALID_END_AT_FIELD_ERROR = {
  field: 'endAt',
  code: 'INVALID_END_AT',
  message:
    'Program end must be a valid date after the application period ends.',
} as const;

@Injectable()
export class ProgramCreationService {
  constructor(
    private readonly repository: ProgramsRepository,
    private readonly auditLog: AuditLogService,
  ) {}

  async create(githubId: bigint, input: CreateProgramRequestDto) {
    const user = await this.repository.findCreatorRole(githubId);
    if (
      user?.accountStatus !== AccountStatus.ACTIVE ||
      (!user.hasStaffAccess && !user.hasAdminAccess)
    ) {
      throw new DomainException(
        PROGRAM_ERROR_CODES[ProgramErrorCode.FORBIDDEN],
      );
    }

    const name = input.name.trim();
    const organizer = input.organizer.trim();
    const description = input.description.trim();
    const applicationStartAt = new Date(input.applicationStartAt);
    const applicationEndAt = new Date(input.applicationEndAt);
    const startAt = new Date(input.startAt ?? input.applicationEndAt);
    const endAt = new Date(input.endAt);
    const template = getProgramTemplate(ProgramCategory.BASIC);
    const teamMinSize = input.teamMinSize ?? template.teamSize.defaultMin;
    const teamMaxSize = input.teamMaxSize ?? template.teamSize.defaultMax;
    const hasValidApplicationPeriod =
      !Number.isNaN(applicationStartAt.getTime()) &&
      !Number.isNaN(applicationEndAt.getTime()) &&
      applicationEndAt >= applicationStartAt;
    const hasValidProgramPeriod =
      !Number.isNaN(startAt.getTime()) &&
      !Number.isNaN(endAt.getTime()) &&
      startAt >= applicationEndAt &&
      endAt > startAt;
    const hasValidTeamSize =
      Number.isInteger(teamMinSize) &&
      Number.isInteger(teamMaxSize) &&
      teamMinSize >= 1 &&
      teamMinSize <= teamMaxSize;

    if (
      !name ||
      !organizer ||
      !description ||
      !hasValidApplicationPeriod ||
      !hasValidTeamSize
    ) {
      throw new DomainException(
        PROGRAM_ERROR_CODES[ProgramErrorCode.VALIDATION_ERROR],
      );
    }

    if (
      typeof input.endAt !== 'string' ||
      !Number.isFinite(endAt.getTime()) ||
      !hasValidProgramPeriod
    ) {
      throw new DomainException(
        PROGRAM_ERROR_CODES[ProgramErrorCode.VALIDATION_ERROR],
        { fieldErrors: [INVALID_END_AT_FIELD_ERROR] },
      );
    }

    return this.repository.withCreateTransaction(async (writer) => {
      const program = await this.repository.createProgram(
        {
          name,
          organizer,
          category: ProgramCategory.BASIC,
          trackType: input.trackType,
          applicationTemplateKey: template.key,
          applicationTemplateVersion: template.version,
          applicationStartAt,
          applicationEndAt,
          startAt,
          endAt,
          teamMinSize,
          teamMaxSize,
          description,
        },
        writer,
      );
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
        writer,
      );
      return program;
    });
  }
}
