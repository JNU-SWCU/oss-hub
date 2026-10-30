import {
  Controller,
  Get,
  Header,
  Param,
  Req,
  Res,
  StreamableFile,
  UseGuards,
  Body,
  HttpCode,
  Logger,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { SessionGuard } from '../auth/session.guard';
import {
  setDownloadHeaders,
  respondWithDownloadFailure,
} from '../platform/object-storage.types';
import {
  MilestoneDocumentCurrentFileService,
  MilestoneDocumentCollectionService,
} from './milestone-document-collection.service';
import {
  presentMilestoneDocumentViewer,
  MilestoneDocumentListResponseDto,
} from './dto/milestone-document-response.dto';
import {
  presentMilestoneDocumentDeliveryCollection,
  type MilestoneDocumentDeliveryCollectionResponseDto,
} from './dto/milestone-document-collection-response.dto';
import {
  presentMilestoneDocumentHistory,
  type MilestoneDocumentHistoryPageResponseDto,
} from './dto/milestone-document-history-response.dto';
import { OriginGuard } from '../auth/origin.guard';
import { CreateMilestoneDocumentReviewRequestDto } from './dto/create-milestone-document-review-request.dto';
import { MilestoneDocumentArchiveQueryRequestDto } from './dto/milestone-document-archive-query.dto';
import { CreateMilestoneDocumentSubmissionRequestDto } from './dto/create-milestone-document-submission-request.dto';
import { MilestoneDocumentCollectionQueryRequestDto } from './dto/milestone-document-collection-query.dto';
import { MilestoneDocumentHistoryQueryRequestDto } from './dto/milestone-document-history-query.dto';
import { MilestoneDocumentReviewResponseDto } from './dto/milestone-document-review-response.dto';
import { MilestoneDocumentSubmissionResponseDto } from './dto/milestone-document-submission-response.dto';
import { UpdateMilestoneDocumentGraceRequestDto } from './dto/update-milestone-document-grace-request.dto';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from './milestone-documents-error-code.error';
import {
  MilestoneDocumentArchiveEntryError,
  MilestoneDocumentArchiveService,
} from './milestone-document-archive.service';
import type { MilestoneDocumentArchiveScope } from './milestone-document-result.types';
import { MilestoneDocumentFilesService } from './milestone-document-files.service';
import { MilestoneDocumentReviewsService } from './milestone-document-reviews.service';
import { MilestoneDocumentsService } from './milestone-documents.service';

type ViewerRequest = Pick<AuthenticatedRequest, 'sessionGithubId'>;

const archiveLogger = new Logger('MilestoneDocumentArchive');

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

@Controller('milestones/:milestoneId/documents')
export class MilestoneDocumentsController {
  constructor(
    private readonly service: MilestoneDocumentsService,
    private readonly filesService: MilestoneDocumentFilesService,
    private readonly reviewsService: MilestoneDocumentReviewsService,
    private readonly archiveService: MilestoneDocumentArchiveService,
    private readonly collectionService: MilestoneDocumentCollectionService,
    private readonly currentFileService: MilestoneDocumentCurrentFileService,
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

  @Get(':documentId/submissions/current/file')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard)
  async downloadCurrentSubmissionFile(
    @Req() request: ViewerRequest,
    @Param('milestoneId') milestoneId: string,
    @Param('documentId') documentId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const file = await this.currentFileService.download(
      request.sessionGithubId,
      milestoneId,
      documentId,
    );
    setDownloadHeaders(response, file);
    return new StreamableFile(file.body);
  }
}
