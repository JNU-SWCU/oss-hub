import {
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
  constructor(private readonly service: SubmissionFilesService) {}
  @Get(':fileId')
  @Protected()
  async download(
    @Req()
    request: SubmissionRequest,
    @Param('fileId')
    fileId: string,
    @Res({ passthrough: true })
    response: Response,
  ): Promise<StreamableFile> {
    return this.service.downloadTo(response, request.sessionGithubId, fileId);
  }
  @Post('checks')
  @HttpCode(204)
  @Protected()
  @UseGuards(OriginGuard)
  @UseInterceptors(SubmissionFileUploadInterceptor)
  check(
    @UploadedFile()
    file: SubmissionFileUpload | undefined,
  ): Promise<void> {
    return this.service.check(file);
  }
}
