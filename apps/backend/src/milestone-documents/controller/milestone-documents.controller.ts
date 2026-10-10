import {
  Body,
  type CallHandler,
  Controller,
  Delete,
  type ExecutionContext,
  Get,
  Header,
  HttpCode,
  Injectable,
  Logger,
  type NestInterceptor,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { OriginGuard } from '../../auth/controller/origin.guard';
import type { AuthenticatedRequest } from '../../auth/controller/http-auth';
import { SessionGuard } from '../../auth/controller/session.guard';
import { DomainException } from '../../common/error-code';
import { CreateMilestoneDocumentReviewRequestDto } from '../dto/create-milestone-document-review-request.dto';
import { MilestoneDocumentArchiveQueryRequestDto } from '../dto/milestone-document-archive-query.dto';
import { CreateMilestoneDocumentSubmissionRequestDto } from '../dto/create-milestone-document-submission-request.dto';
import { MilestoneDocumentCollectionQueryRequestDto } from '../dto/milestone-document-collection-query.dto';
import type { MilestoneDocumentDeliveryCollectionResponseDto } from '../dto/milestone-document-collection-response.dto';
import { MilestoneDocumentCollectionService } from '../service/milestone-document-collection.service';
import { MilestoneDocumentHistoryQueryRequestDto } from '../dto/milestone-document-history-query.dto';
import type { MilestoneDocumentHistoryPageResponseDto } from '../dto/milestone-document-history-response.dto';
import {
  MilestoneDocumentListResponseDto,
  MilestoneDocumentResponseDto,
} from '../dto/milestone-document-response.dto';
import { MilestoneDocumentReviewResponseDto } from '../dto/milestone-document-review-response.dto';
import { MilestoneDocumentSubmissionResponseDto } from '../dto/milestone-document-submission-response.dto';
import { ReorderMilestoneDocumentsRequestDto } from '../dto/reorder-milestone-documents-request.dto';
import { UpsertMilestoneDocumentRequestDto } from '../dto/upsert-milestone-document-request.dto';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from '../domain/milestone-documents-error-code.enum';
import {
  MilestoneDocumentArchiveEntryError,
  MilestoneDocumentArchiveService,
} from '../service/milestone-document-archive.service';
import type { MilestoneDocumentArchiveScope } from '../milestone-document-archive.types';
import { milestoneDocumentAttachmentDisposition } from '../domain/milestone-document-attachment-disposition';
import {
  type MilestoneDocumentFileUpload,
  MilestoneDocumentFilesService,
  type UploadedMilestoneDocumentFileResponse,
  type UploadedMilestoneDocumentTemplateResponse,
} from '../service/milestone-document-files.service';
import { MilestoneDocumentReviewsService } from '../service/milestone-document-reviews.service';
import { MilestoneDocumentsService } from '../service/milestone-documents.service';
import { SUBMISSION_UPLOAD_MAX_BYTES } from '../../submissions/domain/submission-upload-policy';

type ViewerRequest = Pick<AuthenticatedRequest, 'sessionGithubId'>;

const archiveLogger = new Logger('MilestoneDocumentArchive');

const MilestoneDocumentFileUploadOptions = {
  limits: {
    fileSize: SUBMISSION_UPLOAD_MAX_BYTES,
    fieldNameSize: 100,
    fieldSize: 512,
    fields: 4,
    files: 1,

    parts: 4,
  },
};

@Injectable()
class MilestoneDocumentFileUploadInterceptor
  extends FileInterceptor('file', MilestoneDocumentFileUploadOptions)
  implements NestInterceptor
{
  override async intercept(context: ExecutionContext, next: CallHandler) {
    try {
      return await super.intercept(context, next);
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error) {
        if (error.code === 'LIMIT_FILE_SIZE') {
          throw new DomainException(
            MILESTONE_DOCUMENTS_ERROR_CODES[
              MilestoneDocumentsErrorCode.FILE_TOO_LARGE
            ],
          );
        }
        if (
          [
            'LIMIT_FIELD_KEY',
            'LIMIT_FIELD_VALUE',
            'LIMIT_FIELD_COUNT',
            'LIMIT_FILE_COUNT',
            'LIMIT_PART_COUNT',
            'LIMIT_UNEXPECTED_FILE',
          ].includes(String(error.code))
        ) {
          throw new DomainException(
            MILESTONE_DOCUMENTS_ERROR_CODES[
              MilestoneDocumentsErrorCode.INVALID_FILE_UPLOAD
            ],
          );
        }
      }
      throw error;
    }
  }
}

@Controller('milestones/:milestoneId/documents')
export class MilestoneDocumentsController {
  constructor(
    private readonly service: MilestoneDocumentsService,
    private readonly filesService: MilestoneDocumentFilesService,
    private readonly reviewsService: MilestoneDocumentReviewsService,
    private readonly archiveService: MilestoneDocumentArchiveService,
    private readonly collectionService: MilestoneDocumentCollectionService,
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard)
  async list(
    @Req() request: ViewerRequest,
    @Param('milestoneId') milestoneId: string,
  ): Promise<MilestoneDocumentListResponseDto> {
    return MilestoneDocumentListResponseDto.from(
      await this.service.listForViewer(request.sessionGithubId, milestoneId),
    );
  }

  @Get('collection')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard)
  collection(
    @Req() request: ViewerRequest,
    @Param('milestoneId') milestoneId: string,
    @Query() query: MilestoneDocumentCollectionQueryRequestDto,
  ): Promise<MilestoneDocumentDeliveryCollectionResponseDto> {
    return this.collectionService.collectForStaff(
      request.sessionGithubId,
      milestoneId,
      query.toQuery(),
    );
  }

  @Get('collection/archive')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard)
  async archive(
    @Req() request: ViewerRequest,
    @Param('milestoneId') milestoneId: string,
    @Query() query: MilestoneDocumentArchiveQueryRequestDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const scope = query.toScope();
    const archive = await this.archiveService.archiveForStaff(
      request.sessionGithubId,
      milestoneId,
      scope,
    );
    response.setHeader('Content-Type', archive.contentType);
    if (archive.contentLength !== null) {
      response.setHeader('Content-Length', String(archive.contentLength));
    }
    response.setHeader(
      'Content-Disposition',
      milestoneDocumentAttachmentDisposition(archive.fileName),
    );

    response.once('close', () => archive.body.destroy());

    return new StreamableFile(archive.body).setErrorHandler((error) =>
      respondWithArchiveFailure(error, response, { milestoneId, scope }),
    );
  }

  @Patch('order')
  @UseGuards(SessionGuard, OriginGuard)
  reorder(
    @Req() request: ViewerRequest,
    @Param('milestoneId') milestoneId: string,
    @Body() body: ReorderMilestoneDocumentsRequestDto,
  ): Promise<MilestoneDocumentResponseDto[]> {
    return this.service.reorderDocuments(
      request.sessionGithubId,
      milestoneId,
      body.documentIds,
    );
  }

  @Post()
  @HttpCode(201)
  @UseGuards(SessionGuard, OriginGuard)
  create(
    @Req() request: ViewerRequest,
    @Param('milestoneId') milestoneId: string,
    @Body() body: UpsertMilestoneDocumentRequestDto,
  ): Promise<MilestoneDocumentResponseDto> {
    return this.service.createDocument(
      request.sessionGithubId,
      milestoneId,
      body.toInput(),
    );
  }

  @Patch(':documentId')
  @UseGuards(SessionGuard, OriginGuard)
  update(
    @Req() request: ViewerRequest,
    @Param('milestoneId') milestoneId: string,
    @Param('documentId') documentId: string,
    @Body() body: UpsertMilestoneDocumentRequestDto,
  ): Promise<MilestoneDocumentResponseDto> {
    return this.service.updateDocument(
      request.sessionGithubId,
      milestoneId,
      documentId,
      body.toInput(),
    );
  }

  @Delete(':documentId')
  @HttpCode(204)
  @UseGuards(SessionGuard, OriginGuard)
  async remove(
    @Req() request: ViewerRequest,
    @Param('milestoneId') milestoneId: string,
    @Param('documentId') documentId: string,
  ): Promise<void> {
    await this.service.deleteDocument(
      request.sessionGithubId,
      milestoneId,
      documentId,
    );
  }

  @Post(':documentId/template')
  @HttpCode(201)
  @UseGuards(SessionGuard, OriginGuard)
  @UseInterceptors(MilestoneDocumentFileUploadInterceptor)
  uploadTemplate(
    @Req() request: ViewerRequest,
    @Param('milestoneId') milestoneId: string,
    @Param('documentId') documentId: string,
    @UploadedFile() file: MilestoneDocumentFileUpload | undefined,
  ): Promise<UploadedMilestoneDocumentTemplateResponse> {
    return this.filesService.uploadTemplate(
      request.sessionGithubId,
      milestoneId,
      documentId,
      file,
    );
  }

  @Get(':documentId/template')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard)
  async downloadTemplate(
    @Req() request: ViewerRequest,
    @Param('milestoneId') milestoneId: string,
    @Param('documentId') documentId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const file = await this.filesService.downloadTemplate(
      request.sessionGithubId,
      milestoneId,
      documentId,
    );
    response.setHeader('Content-Type', file.contentType);
    response.setHeader('Content-Length', String(file.contentLength));
    response.setHeader(
      'Content-Disposition',
      milestoneDocumentAttachmentDisposition(file.fileName),
    );
    return new StreamableFile(file.body);
  }

  @Get(':documentId/applications/:applicationId/file')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard)
  async downloadSubmissionFile(
    @Req() request: ViewerRequest,
    @Param('milestoneId') milestoneId: string,
    @Param('documentId') documentId: string,
    @Param('applicationId') applicationId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const file = await this.filesService.downloadSubmissionFile(
      request.sessionGithubId,
      milestoneId,
      documentId,
      applicationId,
    );
    response.setHeader('Content-Type', file.contentType);
    response.setHeader('Content-Length', String(file.contentLength));
    response.setHeader(
      'Content-Disposition',
      milestoneDocumentAttachmentDisposition(file.fileName),
    );
    return new StreamableFile(file.body);
  }

  @Get(':documentId/applications/:applicationId/history')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard)
  history(
    @Req() request: ViewerRequest,
    @Param('milestoneId') milestoneId: string,
    @Param('documentId') documentId: string,
    @Param('applicationId') applicationId: string,
    @Query() query: MilestoneDocumentHistoryQueryRequestDto,
  ): Promise<MilestoneDocumentHistoryPageResponseDto> {
    return this.service.historyForStaff(
      request.sessionGithubId,
      milestoneId,
      documentId,
      applicationId,
      query.toQuery(),
    );
  }

  @Get(':documentId/history')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard)
  participantHistory(
    @Req() request: ViewerRequest,
    @Param('milestoneId') milestoneId: string,
    @Param('documentId') documentId: string,
    @Query() query: MilestoneDocumentHistoryQueryRequestDto,
  ): Promise<MilestoneDocumentHistoryPageResponseDto> {
    return this.service.historyForParticipant(
      request.sessionGithubId,
      milestoneId,
      documentId,
      query.toQuery(),
    );
  }

  @Post(':documentId/applications/:applicationId/reviews')
  @HttpCode(201)
  @UseGuards(SessionGuard, OriginGuard)
  review(
    @Req() request: ViewerRequest,
    @Param('milestoneId') milestoneId: string,
    @Param('documentId') documentId: string,
    @Param('applicationId') applicationId: string,
    @Body() body: CreateMilestoneDocumentReviewRequestDto,
  ): Promise<MilestoneDocumentReviewResponseDto> {
    return this.reviewsService.review(
      request.sessionGithubId,
      milestoneId,
      documentId,
      applicationId,
      body.toInput(),
    );
  }

  @Post(':documentId/submissions')
  @HttpCode(201)
  @UseGuards(SessionGuard, OriginGuard)
  submit(
    @Req() request: ViewerRequest,
    @Param('milestoneId') milestoneId: string,
    @Param('documentId') documentId: string,
    @Body() body: CreateMilestoneDocumentSubmissionRequestDto,
  ): Promise<MilestoneDocumentSubmissionResponseDto> {
    return this.service.submit(
      request.sessionGithubId,
      milestoneId,
      documentId,
      body.toInput(),
    );
  }
}

@Controller('milestone-document-files')
export class MilestoneDocumentFilesController {
  constructor(private readonly service: MilestoneDocumentFilesService) {}

  @Post()
  @HttpCode(201)
  @UseGuards(SessionGuard, OriginGuard)
  @UseInterceptors(MilestoneDocumentFileUploadInterceptor)
  upload(
    @Req() request: ViewerRequest,
    @Body('milestoneId') milestoneId: unknown,
    @Body('documentId') documentId: unknown,
    @UploadedFile() file: MilestoneDocumentFileUpload | undefined,
  ): Promise<UploadedMilestoneDocumentFileResponse> {
    return this.service.upload(
      request.sessionGithubId,
      milestoneId,
      documentId,
      file,
    );
  }

  @Post('checks')
  @HttpCode(204)
  @UseGuards(SessionGuard, OriginGuard)
  @UseInterceptors(MilestoneDocumentFileUploadInterceptor)
  check(
    @UploadedFile() file: MilestoneDocumentFileUpload | undefined,
  ): Promise<void> {
    return this.service.check(file);
  }
}

interface ArchiveFailureRequest {
  readonly milestoneId: string;
  readonly scope: MilestoneDocumentArchiveScope;
}

function failedStorageKey(error: Error): string {
  return error instanceof MilestoneDocumentArchiveEntryError
    ? error.storageKey
    : 'unknown';
}

function respondWithArchiveFailure(
  error: Error,
  response: Response,
  request: ArchiveFailureRequest,
): void {
  archiveLogger.error(
    `서류 일괄 내려받기가 압축 도중 실패했다: milestoneId=${request.milestoneId} scope=${request.scope.kind} storageKey=${failedStorageKey(error)} error=${error.message}`,
  );
  if (response.destroyed) return;
  if (response.headersSent) {
    response.end();
    return;
  }

  response.removeHeader('Content-Length');
  response.removeHeader('Content-Disposition');
  const errorCode =
    MILESTONE_DOCUMENTS_ERROR_CODES[
      MilestoneDocumentsErrorCode.FILE_STORAGE_UNAVAILABLE
    ];
  response
    .status(errorCode.status)
    .contentType('application/problem+json')
    .json({
      type: 'about:blank',
      title: 'Service Unavailable',
      status: errorCode.status,
      detail: errorCode.message,
      instance: response.req.path,
      code: errorCode.code,
    });
}
