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
import { OriginGuard } from '../platform/origin.guard';
import { MultipartFileUploadInterceptor } from '../platform/multipart-file-upload.interceptor';
import { UploadedSubmissionFileResponseDto } from './dto/uploaded-submission-file-response.dto';
import {
  SubmissionFilesService,
  type SubmissionFileUpload,
} from './submission-files.service';
import {
  SUBMISSIONS_ERROR_CODES,
  SubmissionsErrorCode,
} from './submissions-error-code.error';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { SUBMISSION_UPLOAD_MAX_BYTES } from './submission-upload.config';
import { DownloadResponseService } from './download-response.service';
import { Protected } from '../auth/auth-route.decorator';

type SubmissionRequest = Pick<AuthenticatedRequest, 'sessionGithubId'>;

const SubmissionFileUploadInterceptor = new MultipartFileUploadInterceptor(
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
  constructor(
    private readonly service: SubmissionFilesService,
    private readonly downloadResponseService: DownloadResponseService,
  ) {}

  @Get(':fileId')
  @Protected()
  async download(
    @Req() request: SubmissionRequest,
    @Param('fileId') fileId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const file = await this.service.download(request.sessionGithubId, fileId);
    response.setHeader('Cache-Control', 'private, no-store');
    this.downloadResponseService.setDownloadHeaders(response, file);
    return new StreamableFile(file.body);
  }

  @Post()
  @HttpCode(201)
  @Protected()
  @UseGuards(OriginGuard)
  @UseInterceptors(SubmissionFileUploadInterceptor)
  async upload(
    @Req() request: SubmissionRequest,
    @Body('applicationId') applicationId: unknown,
    @Body('milestoneId') milestoneId: unknown,
    @Body('submissionId') submissionId: unknown,
    @Body('baseRevision') baseRevision: unknown,
    @UploadedFile() file: SubmissionFileUpload | undefined,
  ): Promise<UploadedSubmissionFileResponseDto> {
    return UploadedSubmissionFileResponseDto.from(
      await this.service.upload(
        request.sessionGithubId,
        applicationId,
        milestoneId,
        file,
        submissionId,
        baseRevision,
      ),
    );
  }

  @Post('checks')
  @HttpCode(204)
  @Protected()
  @UseGuards(OriginGuard)
  @UseInterceptors(SubmissionFileUploadInterceptor)
  check(@UploadedFile() file: SubmissionFileUpload | undefined): Promise<void> {
    return this.service.check(file);
  }
}
