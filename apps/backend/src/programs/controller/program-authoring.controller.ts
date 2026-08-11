import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { OriginGuard } from '../../auth/origin.guard';
import {
  type AuthenticatedRequest,
  SessionGuard,
} from '../../auth/session.guard';
import { ProgramAuthoringRequestDto } from '../dto/program-authoring-request.dto';
import { ProgramAuthoringRepository } from '../program-authoring.repository';
import {
  ProgramAuthoringForbiddenError,
  ProgramAuthoringService,
} from '../program-authoring.service';
import {
  ProgramAuthoringIdempotencyConflictError,
  ProgramAuthoringUploadTokenError,
  ProgramAuthoringValidationError,
} from '../program-authoring.types';
import { ProgramAuthoringUploadService } from '../program-authoring-upload.service';
import {
  ProgramAuthoringUploadError,
  type ProgramAuthoringUploadFile,
} from '../program-authoring-upload.types';

type SessionIdentity = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('program-authoring')
export class ProgramAuthoringController {
  constructor(
    private readonly authoring: ProgramAuthoringService,
    private readonly repository: ProgramAuthoringRepository,
    private readonly uploads: ProgramAuthoringUploadService,
  ) {}

  @Post('uploads')
  @UseGuards(SessionGuard, OriginGuard)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  async upload(
    @Req() request: SessionIdentity,
    @UploadedFile() file: ProgramAuthoringUploadFile | undefined,
  ) {
    try {
      return await this.uploads.upload(
        await this.requireAuthor(request.sessionGithubId),
        file,
      );
    } catch (error) {
      throw uploadHttpError(error);
    }
  }

  @Delete('uploads/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionGuard, OriginGuard)
  async deleteUpload(
    @Req() request: SessionIdentity,
    @Param('id') uploadId: string,
  ): Promise<void> {
    try {
      await this.uploads.delete(
        await this.requireAuthor(request.sessionGithubId),
        uploadId,
      );
    } catch (error) {
      throw uploadHttpError(error);
    }
  }

  @Post('programs')
  @UseGuards(SessionGuard, OriginGuard)
  async create(
    @Req() request: SessionIdentity,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() input: ProgramAuthoringRequestDto,
  ): Promise<{ readonly id: string }> {
    if (idempotencyKey === undefined || idempotencyKey.trim().length === 0) {
      throw new BadRequestException('A valid idempotency key is required.');
    }
    try {
      const program = await this.authoring.create(
        request.sessionGithubId,
        idempotencyKey,
        input,
      );
      return { id: program.id };
    } catch (error) {
      if (error instanceof ProgramAuthoringForbiddenError) {
        throw new ConflictException('Program authoring is unavailable.');
      }
      if (error instanceof ProgramAuthoringIdempotencyConflictError) {
        throw new ConflictException('The idempotency key was already used.');
      }
      if (
        error instanceof ProgramAuthoringValidationError ||
        error instanceof ProgramAuthoringUploadTokenError
      ) {
        throw new BadRequestException('The authoring request is invalid.');
      }
      throw error;
    }
  }

  private async requireAuthor(githubId: bigint): Promise<string> {
    const actor = await this.repository.findActor(githubId);
    if (
      actor === null ||
      actor.accountStatus !== 'ACTIVE' ||
      (actor.role !== 'STAFF' && actor.role !== 'ADMIN')
    ) {
      throw new ConflictException('Program authoring is unavailable.');
    }
    return actor.id;
  }
}

function uploadHttpError(error: unknown): Error {
  if (!(error instanceof ProgramAuthoringUploadError)) throw error;
  switch (error.code) {
    case 'PROGRAM_AUTHORING_UPLOAD_NOT_FOUND':
      return new NotFoundException('Upload was not found.');
    case 'PROGRAM_AUTHORING_UPLOAD_ATTACHED_CONFLICT':
      return new ConflictException('Upload is already attached.');
    case 'PROGRAM_AUTHORING_UPLOAD_STORAGE_UNAVAILABLE':
      return new ConflictException('Upload storage is currently unavailable.');
    case 'PROGRAM_AUTHORING_UPLOAD_INVALID_ACTOR':
    case 'PROGRAM_AUTHORING_UPLOAD_INVALID_FILE':
    case 'PROGRAM_AUTHORING_UPLOAD_FILE_TOO_LARGE':
    case 'PROGRAM_AUTHORING_UPLOAD_UNSUPPORTED_FILE_TYPE':
      return new BadRequestException('Upload is invalid.');
  }
}
