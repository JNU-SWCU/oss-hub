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
  ConflictException,
  Delete,
  Get,
  Headers,
  HttpStatus,
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
import { FileInterceptor } from '@nestjs/platform-express';
import { ProgramAuthoringUploadResponseDto } from './dto/program-authoring-upload-response.dto';
import { ProgramIdResponseDto } from './dto/program-id-response.dto';
import { ProgramAuthoringRequestDto } from './dto/program-authoring-request.dto';
import { ProgramAuthoringUploadPolicyResponseDto } from './dto/program-authoring-upload-policy-response.dto';
import { ProgramAuthoringUploadService } from './program-authoring-upload.service';
import { type ProgramAuthoringUploadFile } from './program-authoring-upload.error';
import { ProgramNoticePreviewRequestDto } from './dto/program-notice-preview-request.dto';
import { ProgramNoticePreviewResponseDto } from './dto/program-notice-preview-response.dto';
import { Protected } from '../auth/auth-route.decorator';
import { STAFF_AUDIENCE } from '../platform/roles.guard';
import { Roles } from '../platform/roles.decorator';

type SessionIdentity = Pick<AuthenticatedRequest, 'principal'>;

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
    return ProgramAuthoringUploadResponseDto.from(
      await this.uploads.uploadFromRequest(request.principal.id, file),
    );
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
    return ProgramAuthoringUploadResponseDto.from(
      await this.uploads.uploadCoverFromRequest(request.principal.id, file),
    );
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
    await this.uploads.deleteFromRequest(request.principal.id, uploadId);
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
    return ProgramIdResponseDto.from(
      await this.authoring.createFromRequest(
        request.principal,
        idempotencyKey,
        input,
      ),
    );
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
