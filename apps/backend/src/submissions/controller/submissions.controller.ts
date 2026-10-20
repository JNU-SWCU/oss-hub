import { setDownloadHeaders } from '../../common/controller/download-response';
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { multipartFileUploadInterceptor } from '../../common/controller/multipart-file-upload.interceptor';
import type { Response } from 'express';
import { OriginGuard } from '../../auth/controller/origin.guard';
import type { AuthenticatedRequest } from '../../auth/controller/http-auth';
import { SessionGuard } from '../../auth/controller/session.guard';
import {
  CreateResubmissionRequestDto,
  CreateSubmissionRequestDto,
} from '../dto/create-submission-request.dto';
import { SubmissionMatrixQueryRequestDto } from '../dto/submission-matrix-query.dto';
import {
  presentCreatedSubmission,
  presentResubmittedSubmission,
  presentSubmissionChecklist,
  presentSubmissionForm,
  type CreatedSubmissionResponseDto,
  type ResubmittedSubmissionResponseDto,
  type SubmissionChecklistResponseDto,
  type SubmissionFormResponseDto,
} from '../dto/submission-response.dto';
import {
  presentSubmissionMatrix,
  type SubmissionMatrixResponseDto,
} from '../dto/submission-matrix-response.dto';
import { SubmissionFilesService } from '../service/submission-files.service';
import type {
  SubmissionFileUpload,
  UploadedSubmissionFileResponse,
} from '../submission-files.types';
import {
  SUBMISSIONS_ERROR_CODES,
  SubmissionsErrorCode,
} from '../domain/submissions-error-code.enum';
import { SubmissionMatrixService } from '../service/submission-matrix.service';
import { SubmissionsService } from '../service/submissions.service';
import { SUBMISSION_UPLOAD_MAX_BYTES } from '../domain/submission-upload-policy';

type SubmissionRequest = Pick<AuthenticatedRequest, 'sessionGithubId'>;

const SubmissionFileUploadInterceptor = multipartFileUploadInterceptor(
  {
    limits: {
      fileSize: SUBMISSION_UPLOAD_MAX_BYTES,
      fieldNameSize: 100,
      fieldSize: 512,
      fields: 4,
      files: 1,
      parts: 6,
    },
  },
  {
    fileTooLarge: SUBMISSIONS_ERROR_CODES[SubmissionsErrorCode.FILE_TOO_LARGE],
    invalidUpload:
      SUBMISSIONS_ERROR_CODES[SubmissionsErrorCode.INVALID_FILE_UPLOAD],
  },
);

@Controller('programs/:programId/milestones/:milestoneId')
export class SubmissionFormsController {
  constructor(private readonly service: SubmissionsService) {}

  @Get('submission-form')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard)
  async form(
    @Req() request: SubmissionRequest,
    @Param('programId') programId: string,
    @Param('milestoneId') milestoneId: string,
  ): Promise<SubmissionFormResponseDto> {
    const result = await this.service.form(
      request.sessionGithubId,
      programId,
      milestoneId,
    );
    return presentSubmissionForm(result, programId, milestoneId);
  }
}

@Controller('programs/:programId/submissions')
export class SubmissionChecklistController {
  constructor(private readonly service: SubmissionsService) {}

  @Get('me')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard)
  checklist(
    @Req() request: SubmissionRequest,
    @Param('programId') programId: string,
  ): Promise<SubmissionChecklistResponseDto> {
    return this.service
      .checklist(request.sessionGithubId, programId)
      .then(presentSubmissionChecklist);
  }
}

@Controller('programs/:programId/submissions')
export class SubmissionMatrixController {
  constructor(private readonly service: SubmissionMatrixService) {}

  @Get('matrix')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard)
  async matrix(
    @Req() request: SubmissionRequest,
    @Param('programId') programId: string,
    @Query() query: SubmissionMatrixQueryRequestDto,
  ): Promise<SubmissionMatrixResponseDto> {
    const result = await this.service.matrix(
      request.sessionGithubId,
      programId,
      query.toQuery(),
    );
    return presentSubmissionMatrix(result, programId);
  }
}

@Controller('submission-files')
export class SubmissionFilesController {
  constructor(private readonly service: SubmissionFilesService) {}

  @Get(':fileId')
  @UseGuards(SessionGuard)
  async download(
    @Req() request: SubmissionRequest,
    @Param('fileId') fileId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const file = await this.service.download(request.sessionGithubId, fileId);
    response.setHeader('Cache-Control', 'private, no-store');
    setDownloadHeaders(response, file);
    return new StreamableFile(file.body);
  }

  @Post()
  @HttpCode(201)
  @UseGuards(SessionGuard, OriginGuard)
  @UseInterceptors(SubmissionFileUploadInterceptor)
  upload(
    @Req() request: SubmissionRequest,
    @Body('applicationId') applicationId: unknown,
    @Body('milestoneId') milestoneId: unknown,
    @Body('submissionId') submissionId: unknown,
    @Body('baseRevision') baseRevision: unknown,
    @UploadedFile() file: SubmissionFileUpload | undefined,
  ): Promise<UploadedSubmissionFileResponse> {
    return this.service.upload(
      request.sessionGithubId,
      applicationId,
      milestoneId,
      file,
      submissionId,
      baseRevision,
    );
  }

  @Post('checks')
  @HttpCode(204)
  @UseGuards(SessionGuard, OriginGuard)
  @UseInterceptors(SubmissionFileUploadInterceptor)
  check(@UploadedFile() file: SubmissionFileUpload | undefined): Promise<void> {
    return this.service.check(file);
  }
}

@Controller('submissions')
export class SubmissionsController {
  constructor(private readonly service: SubmissionsService) {}

  @Post()
  @HttpCode(201)
  @UseGuards(SessionGuard, OriginGuard)
  create(
    @Req() request: SubmissionRequest,
    @Body() body: CreateSubmissionRequestDto,
  ): Promise<CreatedSubmissionResponseDto> {
    return this.service
      .create(request.sessionGithubId, body.toInput())
      .then(presentCreatedSubmission);
  }

  @Post(':submissionId/resubmissions')
  @HttpCode(201)
  @UseGuards(SessionGuard, OriginGuard)
  resubmit(
    @Req() request: SubmissionRequest,
    @Param('submissionId') submissionId: string,
    @Body() body: CreateResubmissionRequestDto,
  ): Promise<ResubmittedSubmissionResponseDto> {
    return this.service
      .resubmit(request.sessionGithubId, submissionId, body.toInput())
      .then(presentResubmittedSubmission);
  }
}
