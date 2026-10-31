import {
  PROGRAM_COVER_MAX_BYTES,
  SUBMISSION_UPLOAD_MAX_BYTES,
} from './submission-upload.config';
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
import { OriginGuard } from '../platform/origin.guard';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import {
  ProgramNoticePreviewService,
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
import { ProgramAuthoringUploadResponseDto } from './dto/program-authoring-upload-response.dto';
import { ProgramIdResponseDto } from './dto/program-id-response.dto';
import { ProgramAuthoringRequestDto } from './dto/program-authoring-request.dto';
import { ProgramAuthoringUploadPolicyResponseDto } from './dto/program-authoring-upload-policy-response.dto';
import { ProgramAuthoringValidationError } from './program-authoring-validation.error';
import { ProgramAuthoringUploadService } from './program-authoring-upload.service';
import {
  ProgramAuthoringUploadError,
  type ProgramAuthoringUploadFile,
} from './program-authoring-upload.error';
import { ProgramNoticePreviewRequestDto } from './dto/program-notice-preview-request.dto';
import { ProgramNoticePreviewResponseDto } from './dto/program-notice-preview-response.dto';
import {
  ProgramAuthoringIdempotencyConflictError,
  ProgramAuthoringUploadTokenError,
} from './program-authoring.error';
import { Protected } from '../auth/auth-route.decorator';
import { STAFF_AUDIENCE } from '../platform/roles.guard';
import { Roles } from '../platform/roles.decorator';

type SessionIdentity = Pick<AuthenticatedRequest, 'principal'>;

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

const authoringUnavailable = () =>
  new ConflictException('Program authoring is unavailable.');

@Controller('program-authoring')
export class ProgramAuthoringController {
  constructor(
    private readonly authoring: ProgramAuthoringService,
    private readonly uploads: ProgramAuthoringUploadService,
    private readonly previews: ProgramNoticePreviewService,
  ) {}

  @Get('upload-policy')
  @Protected()
  @Roles(STAFF_AUDIENCE, authoringUnavailable)
  uploadPolicy(): ProgramAuthoringUploadPolicyResponseDto {
    return ProgramAuthoringUploadPolicyResponseDto.from();
  }

  @Post('uploads')
  @Protected()
  @Roles(STAFF_AUDIENCE, authoringUnavailable)
  @UseGuards(OriginGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: SUBMISSION_UPLOAD_MAX_BYTES },
    }),
  )
  async upload(
    @Req() request: SessionIdentity,
    @UploadedFile() file: ProgramAuthoringUploadFile | undefined,
  ): Promise<ProgramAuthoringUploadResponseDto> {
    try {
      return ProgramAuthoringUploadResponseDto.from(
        await this.uploads.upload(request.principal.id, file),
      );
    } catch (error) {
      throw uploadHttpError(error);
    }
  }

  @Post('cover-uploads')
  @Protected()
  @Roles(STAFF_AUDIENCE, authoringUnavailable)
  @UseGuards(OriginGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: PROGRAM_COVER_MAX_BYTES, files: 1 },
    }),
  )
  async uploadCover(
    @Req() request: SessionIdentity,
    @UploadedFile() file: ProgramAuthoringUploadFile | undefined,
  ): Promise<ProgramAuthoringUploadResponseDto> {
    try {
      return ProgramAuthoringUploadResponseDto.from(
        await this.uploads.uploadCover(request.principal.id, file),
      );
    } catch (error) {
      throw uploadHttpError(error);
    }
  }

  @Delete('uploads/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Protected()
  @Roles(STAFF_AUDIENCE, authoringUnavailable)
  @UseGuards(OriginGuard)
  async deleteUpload(
    @Req() request: SessionIdentity,
    @Param('id') uploadId: string,
  ): Promise<void> {
    try {
      await this.uploads.delete(request.principal.id, uploadId);
    } catch (error) {
      throw uploadHttpError(error);
    }
  }

  @Post('programs')
  @Protected()
  @Roles(STAFF_AUDIENCE, authoringUnavailable)
  @UseGuards(OriginGuard)
  async create(
    @Req() request: SessionIdentity,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() input: ProgramAuthoringRequestDto,
  ): Promise<ProgramIdResponseDto> {
    if (idempotencyKey === undefined || idempotencyKey.trim().length === 0) {
      throw new BadRequestException('A valid idempotency key is required.');
    }
    try {
      const program = await this.authoring.create(
        request.principal,
        idempotencyKey,
        input,
      );
      return ProgramIdResponseDto.from(program);
    } catch (error) {
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

  @Post('notice-preview')
  @HttpCode(200)
  @Protected()
  @Roles(STAFF_AUDIENCE, authoringUnavailable)
  @UseGuards(OriginGuard)
  async preview(
    @Req() request: SessionIdentity,
    @Body() input: ProgramNoticePreviewRequestDto,
  ): Promise<ProgramNoticePreviewResponseDto> {
    return ProgramNoticePreviewResponseDto.from(
      await this.previews.preview(request.principal.id, input.url),
    );
  }
}
