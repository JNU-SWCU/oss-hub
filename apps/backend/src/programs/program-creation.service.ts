import {
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  OBJECT_STORAGE,
  ObjectStorageError,
  type ObjectStoragePort,
} from '../platform/object-storage.types';
import { ProgramCoverRepository } from './program-cover.repository';
import { AccountStatus, ProgramCategory } from '@prisma/client';
import {
  createProgramCreatedAuditMetadata,
  PROGRAM_CREATED_AUDIT_ACTIONS,
} from '../platform/audit-log-metadata.policy';
import { AuditLogService } from '../platform/audit-log.service';
import { DomainException } from '../platform/error-code.error';
import type { CreateProgramCommand } from './programs.types';
import { ProgramsRepository } from './programs.repository';
import {
  PROGRAM_ERROR_CODES,
  ProgramErrorCode,
} from './program-error-code.error';
import { isProgramEndAtUndecided } from './programs.policy';
import { getProgramTemplate } from './program-template-registry.policy';

@Injectable()
export class ProgramCoverService {
  constructor(
    private readonly repository: ProgramCoverRepository,
    @Inject(OBJECT_STORAGE)
    private readonly storage: ObjectStoragePort,
  ) {}

  async read(programId: string, coverId: string) {
    const cover = await this.repository.findPublicCover(programId, coverId);
    if (cover === null)
      throw new NotFoundException('Program cover was not found.');
    try {
      return {
        body: await this.storage.get(cover.storageKey),
        contentType: cover.mimeType,
        size: cover.sizeBytes,
      };
    } catch (error) {
      if (!(error instanceof ObjectStorageError)) throw error;
      if (error.code === 'SUBMISSION_FILE_STORAGE_GET_NOT_FOUND') {
        throw new NotFoundException('Program cover was not found.');
      }
      throw new ServiceUnavailableException(
        'Program cover is temporarily unavailable.',
      );
    }
  }
}

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

  async create(githubId: bigint, input: CreateProgramCommand) {
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
      isProgramEndAtUndecided(endAt) ||
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
