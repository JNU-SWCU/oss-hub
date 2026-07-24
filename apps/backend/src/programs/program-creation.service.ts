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
    const template = getProgramTemplate(input.category);
    const hasValidDates =
      !Number.isNaN(applicationStartAt.getTime()) &&
      !Number.isNaN(applicationEndAt.getTime()) &&
      applicationEndAt >= applicationStartAt;
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

    return this.repository.createProgram({
      name,
      organizer,
      category: input.category,
      applicationTemplateKey: template.key,
      applicationTemplateVersion: template.version,
      applicationStartAt,
      applicationEndAt,
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
