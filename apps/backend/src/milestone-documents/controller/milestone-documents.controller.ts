import { presentMilestoneDocumentViewer } from '../dto/milestone-document-response.dto';
import { presentMilestoneDocumentDeliveryCollection } from '../dto/milestone-document-collection-response.dto';
import { presentMilestoneDocumentHistory } from '../dto/milestone-document-history-response.dto';
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Logger,
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
import { multipartFileUploadInterceptor } from '../../common/controller/multipart-file-upload.interceptor';
import type { Response } from 'express';
import { OriginGuard } from '../../auth/controller/origin.guard';
import type { AuthenticatedRequest } from '../../auth/controller/http-auth';
import { SessionGuard } from '../../auth/controller/session.guard';
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
import { UpdateMilestoneDocumentGraceRequestDto } from '../dto/update-milestone-document-grace-request.dto';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from '../domain/milestone-documents-error-code.enum';
import {
  MilestoneDocumentArchiveEntryError,
  MilestoneDocumentArchiveService,
} from '../service/milestone-document-archive.service';
import type { MilestoneDocumentArchiveScope } from '../milestone-document-archive.types';
import {
  setDownloadHeaders,
  respondWithDownloadFailure,
} from '../../common/controller/download-response';
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

const MilestoneDocumentFileUploadInterceptor = multipartFileUploadInterceptor(
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
      (
        await this.service.listForViewer(request.sessionGithubId, milestoneId)
      ).map(presentMilestoneDocumentViewer),
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
    return this.collectionService
      .collectForStaff(request.sessionGithubId, milestoneId, query.toQuery())
      .then(presentMilestoneDocumentDeliveryCollection);
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
    setDownloadHeaders(response, archive);

    response.once('close', () => archive.body.destroy());

    return new StreamableFile(archive.body).setErrorHandler((error) =>
      respondWithArchiveFailure(error, response, { milestoneId, scope }),
    );
  }

  @Patch(':documentId/grace')
  @HttpCode(204)
  @UseGuards(SessionGuard, OriginGuard)
  updateGrace(
    @Req() request: ViewerRequest,
    @Param('milestoneId') milestoneId: string,
    @Param('documentId') documentId: string,
    @Body() body: UpdateMilestoneDocumentGraceRequestDto,
  ): Promise<void> {
    return this.service.updateGraceDueAt(
      request.sessionGithubId,
      milestoneId,
      documentId,
      body.toDate(),
    );
  }

  @Patch('order')
  @UseGuards(SessionGuard, OriginGuard)
  reorder(
    @Req() request: ViewerRequest,
    @Param('milestoneId') milestoneId: string,
    @Body() body: ReorderMilestoneDocumentsRequestDto,
  ): Promise<MilestoneDocumentResponseDto[]> {
    return this.service
      .reorderDocuments(request.sessionGithubId, milestoneId, body.documentIds)
      .then((records) =>
        records.map((record) => MilestoneDocumentResponseDto.from(record)),
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
    return this.service
      .createDocument(request.sessionGithubId, milestoneId, body.toInput())
      .then((result) => MilestoneDocumentResponseDto.from(result));
  }

  @Patch(':documentId')
  @UseGuards(SessionGuard, OriginGuard)
  update(
    @Req() request: ViewerRequest,
    @Param('milestoneId') milestoneId: string,
    @Param('documentId') documentId: string,
    @Body() body: UpsertMilestoneDocumentRequestDto,
  ): Promise<MilestoneDocumentResponseDto> {
    return this.service
      .updateDocument(
        request.sessionGithubId,
        milestoneId,
        documentId,
        body.toInput(),
      )
      .then((result) => MilestoneDocumentResponseDto.from(result));
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
    setDownloadHeaders(response, file);
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
    setDownloadHeaders(response, file);
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
    return this.service
      .historyForStaff(
        request.sessionGithubId,
        milestoneId,
        documentId,
        applicationId,
        query.toQuery(),
      )
      .then(presentMilestoneDocumentHistory);
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
    return this.service
      .historyForParticipant(
        request.sessionGithubId,
        milestoneId,
        documentId,
        query.toQuery(),
      )
      .then(presentMilestoneDocumentHistory);
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
    return this.reviewsService
      .review(
        request.sessionGithubId,
        milestoneId,
        documentId,
        applicationId,
        body.toInput(),
      )
      .then((result) => MilestoneDocumentReviewResponseDto.from(result));
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
    return this.service
      .submit(request.sessionGithubId, milestoneId, documentId, body.toInput())
      .then((result) => MilestoneDocumentSubmissionResponseDto.from(result));
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
  respondWithDownloadFailure(
    response,
    MILESTONE_DOCUMENTS_ERROR_CODES[
      MilestoneDocumentsErrorCode.FILE_STORAGE_UNAVAILABLE
    ],
    'END',
  );
}
