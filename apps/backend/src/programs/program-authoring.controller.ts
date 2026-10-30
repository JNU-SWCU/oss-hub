import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards,
  BadRequestException,
  ConflictException,
  Delete,
  Get,
  Headers,
  HttpStatus,
  NotFoundException,
  Param,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { OriginGuard } from '../auth/origin.guard';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { SessionGuard } from '../auth/session.guard';
import {
  ProgramNoticePreviewService,
  ProgramAuthoringForbiddenError,
  ProgramAuthoringService,
} from './program-authoring.service';
import {
  DomainException,
  type ProblemDetailExtensions,
} from '../platform/error-code.error';
import {
  PROGRAM_ERROR_CODES,
  ProgramErrorCode,
} from './program-error-code.error';
import { FileInterceptor } from '@nestjs/platform-express';
import { ProgramAuthoringRequestDto } from './dto/program-authoring-request.dto';
import { ProgramAuthoringUploadPolicyResponseDto } from './dto/program-authoring-upload-policy-response.dto';
import {
  ProgramAuthoringIdempotencyConflictError,
  ProgramAuthoringUploadTokenError,
} from './program-authoring.policy';
import { ProgramAuthoringValidationError } from './program-authoring-validation.error';
import { ProgramAuthoringUploadService } from './program-authoring-upload.service';
import {
  ProgramAuthoringUploadError,
  type ProgramAuthoringUploadFile,
} from './program-authoring-upload.error';
import { SUBMISSION_UPLOAD_MAX_BYTES } from './submission-file.policy';
import { PROGRAM_COVER_MAX_BYTES } from './program-cover.policy';
import { ProgramNoticePreviewRequestDto } from './dto/program-notice-preview-request.dto';
import { ProgramNoticePreviewResponseDto } from './dto/program-notice-preview-response.dto';

type SessionIdentity = Pick<AuthenticatedRequest, 'sessionGithubId'>;

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

@Controller('program-authoring')
export class ProgramAuthoringController {
  constructor(
    private readonly authoring: ProgramAuthoringService,
    private readonly uploads: ProgramAuthoringUploadService,
    private readonly previews: ProgramNoticePreviewService,
  ) {}

  @Get('upload-policy')
  @UseGuards(SessionGuard)
  async uploadPolicy(
    @Req() request: SessionIdentity,
  ): Promise<ProgramAuthoringUploadPolicyResponseDto> {
    await this.requireAuthor(request.sessionGithubId);
    return ProgramAuthoringUploadPolicyResponseDto.from();
  }

  @Post('uploads')
  @UseGuards(SessionGuard, OriginGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: SUBMISSION_UPLOAD_MAX_BYTES },
    }),
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

  @Post('cover-uploads')
  @UseGuards(SessionGuard, OriginGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: PROGRAM_COVER_MAX_BYTES, files: 1 },
    }),
  )
  async uploadCover(
    @Req() request: SessionIdentity,
    @UploadedFile() file: ProgramAuthoringUploadFile | undefined,
  ) {
    try {
      return await this.uploads.uploadCover(
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
        const extensions: ProblemDetailExtensions & {
          readonly existingProgramId: string;
        } = { existingProgramId: error.existingProgramId };
        throw new DomainException(
          PROGRAM_ERROR_CODES[ProgramErrorCode.AUTHORING_REQUEST_CONFLICT],
          extensions,
        );
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
    try {
      return await this.authoring.requireAuthor(githubId);
    } catch (error) {
      if (error instanceof ProgramAuthoringForbiddenError) {
        throw new ConflictException('Program authoring is unavailable.');
      }
      throw error;
    }
  }

  @Post('notice-preview')
  @HttpCode(200)
  @UseGuards(SessionGuard, OriginGuard)
  async preview(
    @Req() request: Pick<AuthenticatedRequest, 'sessionGithubId'>,
    @Body() input: ProgramNoticePreviewRequestDto,
  ): Promise<ProgramNoticePreviewResponseDto> {
    return ProgramNoticePreviewResponseDto.from(
      await this.previews.preview(request.sessionGithubId, input.url),
    );
  }
}
