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
  Body,
} from '@nestjs/common';
import { type Response } from 'express';
import { OriginGuard } from '../platform/origin.guard';
import { MultipartFileUploadInterceptor } from '../platform/multipart-file-upload.interceptor';
import {
  FilesService,
  type SubmissionFileUpload,
  MilestoneDocumentFilesService,
} from './files.service';
import {
  SUBMISSIONS_ERROR_CODES,
  SubmissionsErrorCode,
} from './submissions-error-code.error';
import { type AuthenticatedRequest } from '../auth/http-auth.types';
import { SUBMISSION_UPLOAD_MAX_BYTES } from './submission-upload.config';
import { Protected } from '../auth/auth-route.decorator';
import { UploadedMilestoneDocumentFileResponseDto } from './dto/uploaded-milestone-document-file-response.dto';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from './milestone-documents-error-code.error';
import { type MilestoneDocumentFileUpload } from './files.config';

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
export class FilesController {
  constructor(private readonly service: FilesService) {}
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

type ViewerRequest = Pick<AuthenticatedRequest, 'sessionGithubId'>;

const MilestoneDocumentFileUploadInterceptor =
  new MultipartFileUploadInterceptor(
    {
      limits: {
        fileSize: SUBMISSION_UPLOAD_MAX_BYTES,
        fieldNameSize: 100,
        fieldSize: 512,
        fields: 4,
        files: 1,
        parts: 4,
      },
    },
    {
      fileTooLarge:
        MILESTONE_DOCUMENTS_ERROR_CODES[
          MilestoneDocumentsErrorCode.FILE_TOO_LARGE
        ],
      invalidUpload:
        MILESTONE_DOCUMENTS_ERROR_CODES[
          MilestoneDocumentsErrorCode.INVALID_FILE_UPLOAD
        ],
    },
  );

@Controller('milestone-document-files')
export class MilestoneDocumentFilesController {
  constructor(private readonly service: MilestoneDocumentFilesService) {}

  @Post()
  @HttpCode(201)
  @Protected()
  @UseGuards(OriginGuard)
  @UseInterceptors(MilestoneDocumentFileUploadInterceptor)
  async upload(
    @Req() request: ViewerRequest,
    @Body('milestoneId') milestoneId: unknown,
    @Body('documentId') documentId: unknown,
    @UploadedFile() file: MilestoneDocumentFileUpload | undefined,
  ): Promise<UploadedMilestoneDocumentFileResponseDto> {
    return UploadedMilestoneDocumentFileResponseDto.from(
      await this.service.upload(
        request.sessionGithubId,
        milestoneId,
        documentId,
        file,
      ),
    );
  }

  @Post('checks')
  @HttpCode(204)
  @Protected()
  @UseGuards(OriginGuard)
  @UseInterceptors(MilestoneDocumentFileUploadInterceptor)
  check(
    @UploadedFile() file: MilestoneDocumentFileUpload | undefined,
  ): Promise<void> {
    return this.service.check(file);
  }
}
