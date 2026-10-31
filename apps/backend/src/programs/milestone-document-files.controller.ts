import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { MultipartFileUploadInterceptor } from '../platform/multipart-file-upload.interceptor';
import { OriginGuard } from '../platform/origin.guard';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { UploadedMilestoneDocumentFileResponseDto } from './dto/uploaded-milestone-document-file-response.dto';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from './milestone-documents-error-code.error';
import {
  type MilestoneDocumentFileUpload,
  MilestoneDocumentFilesService,
} from './milestone-document-files.service';
import { SUBMISSION_UPLOAD_MAX_BYTES } from './submission-upload.config';
import { Protected } from '../auth/authentication.guard';

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
