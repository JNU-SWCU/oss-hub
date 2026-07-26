import { Injectable } from '@nestjs/common';
import { AccountStatus, Role } from '@prisma/client';
import { DomainException } from '../common/error-code';
import type { CreateProgramRequestDto } from './dto/create-program-request.dto';
import { ProgramsRepository } from './programs.repository';
import {
  PROGRAM_ERROR_CODES,
  ProgramErrorCode,
} from './program-error-code.enum';
import {
  getProgramTemplate,
  PROGRAM_PARTICIPATION,
} from './program-template.registry';

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
    const endAt =
      input.endAt === null || input.endAt === undefined
        ? null
        : new Date(input.endAt);
    const template = getProgramTemplate(input.category);
    const hasValidDates =
      !Number.isNaN(applicationStartAt.getTime()) &&
      !Number.isNaN(applicationEndAt.getTime()) &&
      applicationEndAt >= applicationStartAt;
    const hasValidEndAt =
      endAt === null ||
      (!Number.isNaN(endAt.getTime()) && endAt >= applicationEndAt);
    const hasValidTeamSize =
      template.participation === PROGRAM_PARTICIPATION.INDIVIDUAL ||
      (input.teamMinSize !== null &&
        input.teamMinSize !== undefined &&
        input.teamMaxSize !== null &&
        input.teamMaxSize !== undefined &&
        input.teamMinSize >= 1 &&
        input.teamMinSize <= input.teamMaxSize);

    if (
      !name ||
      !organizer ||
      !description ||
      !hasValidDates ||
      !hasValidTeamSize
    ) {
      throw new DomainException(
        PROGRAM_ERROR_CODES[ProgramErrorCode.VALIDATION_ERROR],
      );
    }
    if (!hasValidEndAt) {
      throw new DomainException(
        PROGRAM_ERROR_CODES[ProgramErrorCode.INVALID_APPLICATION_PERIOD],
        {
          fieldErrors: INVALID_PROGRAM_END_FIELD_ERRORS,
        },
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
      endAt,
      teamMinSize:
        template.participation === PROGRAM_PARTICIPATION.TEAM
          ? (input.teamMinSize ?? null)
          : null,
      teamMaxSize:
        template.participation === PROGRAM_PARTICIPATION.TEAM
          ? (input.teamMaxSize ?? null)
          : null,
      description,
    });
  }
}
const INVALID_PROGRAM_END_FIELD_ERRORS = [
  {
    field: 'applicationEndAt',
    code: 'INVALID_APPLICATION_PERIOD',
    message: 'Application period must end before the program ends.',
  },
  {
    field: 'endAt',
    code: 'INVALID_APPLICATION_PERIOD',
    message: 'Program end must be on or after application period end.',
  },
] as const;
