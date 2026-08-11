import { Injectable } from '@nestjs/common';
import { AccountStatus, Role } from '@prisma/client';
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
  constructor(private readonly repository: ProgramsRepository) {}

  async create(githubId: bigint, input: CreateProgramRequestDto) {
    const user = await this.repository.findCreatorRole(githubId);
    if (
      user?.accountStatus !== AccountStatus.ACTIVE ||
      (user.role !== Role.STAFF && user.role !== Role.ADMIN)
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
    const template = getProgramTemplate(input.category);
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

    return this.repository.createProgram({
      name,
      organizer,
      category: input.category,
      applicationTemplateKey: template.key,
      applicationTemplateVersion: template.version,
      applicationStartAt,
      applicationEndAt,
      startAt,
      endAt,
      teamMinSize,
      teamMaxSize,
      description,
    });
  }
}
