import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Param,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { OriginGuard } from '../auth/origin.guard';
import { setDownloadHeaders } from '../platform/object-storage.types';
import { multipartFileUploadInterceptor } from '../platform/multipart-file-upload.interceptor';
import { SubmissionFilesService } from './submission-files.service';
import type {
  SubmissionFileUpload,
  UploadedSubmissionFileResponse,
} from './submission.types';
import {
  SUBMISSIONS_ERROR_CODES,
  SubmissionsErrorCode,
} from './submissions-error-code.error';
import { SUBMISSION_UPLOAD_MAX_BYTES } from './submission-file.policy';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { SessionGuard } from '../auth/session.guard';

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
