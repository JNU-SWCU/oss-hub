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
import {
  MilestoneDocumentCurrentFileService,
  MilestoneDocumentCollectionService,
} from './milestone-document-collection.service';
import {
  MilestoneDocumentResponseDto,
  MilestoneDocumentListResponseDto,
} from './dto/milestone-document-response.dto';
import { MilestoneDocumentDeliveryCollectionResponseDto } from './dto/milestone-document-collection-response.dto';
import { MilestoneDocumentHistoryPageResponseDto } from './dto/milestone-document-history-page-response.dto';
import { OriginGuard } from '../platform/origin.guard';
import { CreateMilestoneDocumentReviewRequestDto } from './dto/create-milestone-document-review-request.dto';
import { MilestoneDocumentArchiveRequestDto } from './dto/milestone-document-archive-request.dto';
import { CreateMilestoneDocumentSubmissionRequestDto } from './dto/create-milestone-document-submission-request.dto';
import { MilestoneDocumentCollectionRequestDto } from './dto/milestone-document-collection-request.dto';
import { MilestoneDocumentHistoryRequestDto } from './dto/milestone-document-history-request.dto';
import { MilestoneDocumentReviewResponseDto } from './dto/milestone-document-review-response.dto';
import { MilestoneDocumentSubmissionResponseDto } from './dto/milestone-document-submission-response.dto';
import { UpdateMilestoneDocumentGraceRequestDto } from './dto/update-milestone-document-grace-request.dto';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from './milestone-documents-error-code.error';
import {
  MilestoneDocumentArchiveService,
  type MilestoneDocumentArchiveScope,
} from './milestone-document-archive.service';
import { MilestoneDocumentFilesService } from './milestone-document-files.service';
import { MilestoneDocumentReviewsService } from './milestone-document-reviews.service';
import { MilestoneDocumentsService } from './milestone-documents.service';
import { MilestoneDocumentArchiveEntryError } from './milestone-document-archive.error';
import { DownloadResponseService } from './download-response.service';
import { MilestoneDocumentRulesService } from './milestone-document-rules.service';
import { Protected } from '../auth/auth-route.decorator';
import { DomainException } from '../platform/error-code.error';
import { STAFF_AUDIENCE } from '../platform/roles.guard';
import { Roles } from '../platform/roles.decorator';

type ViewerRequest = Pick<
  AuthenticatedRequest,
  'sessionGithubId' | 'principal'
>;

const staffOnly = () =>
  new DomainException(
    MILESTONE_DOCUMENTS_ERROR_CODES[MilestoneDocumentsErrorCode.STAFF_ONLY],
  );

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

@Controller('milestones/:milestoneId/documents')
export class MilestoneDocumentsController {
  constructor(
    private readonly service: MilestoneDocumentsService,
    private readonly filesService: MilestoneDocumentFilesService,
    private readonly reviewsService: MilestoneDocumentReviewsService,
    private readonly archiveService: MilestoneDocumentArchiveService,
    private readonly collectionService: MilestoneDocumentCollectionService,
    private readonly currentFileService: MilestoneDocumentCurrentFileService,
    private readonly downloadResponseService: DownloadResponseService,
    private readonly milestoneDocumentRulesService: MilestoneDocumentRulesService,
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @Protected()
  async list(
    @Req() request: ViewerRequest,
    @Param('milestoneId') milestoneId: string,
  ): Promise<MilestoneDocumentListResponseDto> {
    return MilestoneDocumentListResponseDto.from(
      (
        await this.service.listForViewer(request.sessionGithubId, milestoneId)
      ).map((result) => MilestoneDocumentResponseDto.from(result)),
    );
  }

  @Get('collection')
  @Header('Cache-Control', 'private, no-store')
  @Protected()
  @Roles(STAFF_AUDIENCE, staffOnly)
  collection(
    @Param('milestoneId') milestoneId: string,
    @Query() query: MilestoneDocumentCollectionRequestDto,
  ): Promise<MilestoneDocumentDeliveryCollectionResponseDto> {
    return this.collectionService
      .collectForStaffFromRequest(milestoneId, query)
      .then((result) =>
        MilestoneDocumentDeliveryCollectionResponseDto.from(result),
      );
  }

  @Get('collection/archive')
  @Header('Cache-Control', 'private, no-store')
  @Protected()
  @Roles(STAFF_AUDIENCE, staffOnly)
  async archive(
    @Param('milestoneId') milestoneId: string,
    @Query() query: MilestoneDocumentArchiveRequestDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const scope = this.archiveService.milestoneArchiveScopeFromRequest(query);
    const archive = await this.archiveService.archiveForStaff(
      milestoneId,
      scope,
    );
    this.downloadResponseService.setDownloadHeaders(response, archive);

    response.once('close', () => archive.body.destroy());

    return new StreamableFile(archive.body).setErrorHandler((error) =>
      this.respondWithArchiveFailure(error, response, { milestoneId, scope }),
    );
  }

  @Patch(':documentId/grace')
  @HttpCode(204)
  @Protected()
  @Roles(STAFF_AUDIENCE, staffOnly)
  @UseGuards(OriginGuard)
  updateGrace(
    @Param('milestoneId') milestoneId: string,
    @Param('documentId') documentId: string,
    @Body() body: UpdateMilestoneDocumentGraceRequestDto,
  ): Promise<void> {
    return this.service.updateGraceDueAtFromRequest(
      milestoneId,
      documentId,
      body,
    );
  }

  @Get(':documentId/template')
  @Header('Cache-Control', 'private, no-store')
  @Protected()
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
    this.downloadResponseService.setDownloadHeaders(response, file);
    return new StreamableFile(file.body);
  }

  @Get(':documentId/applications/:applicationId/file')
  @Header('Cache-Control', 'private, no-store')
  @Protected()
  @Roles(STAFF_AUDIENCE, staffOnly)
  async downloadSubmissionFile(
    @Param('milestoneId') milestoneId: string,
    @Param('documentId') documentId: string,
    @Param('applicationId') applicationId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const file = await this.filesService.downloadSubmissionFile(
      milestoneId,
      documentId,
      applicationId,
    );
    this.downloadResponseService.setDownloadHeaders(response, file);
    return new StreamableFile(file.body);
  }

  @Get(':documentId/applications/:applicationId/history')
  @Header('Cache-Control', 'private, no-store')
  @Protected()
  @Roles(STAFF_AUDIENCE, staffOnly)
  history(
    @Param('milestoneId') milestoneId: string,
    @Param('documentId') documentId: string,
    @Param('applicationId') applicationId: string,
    @Query() query: MilestoneDocumentHistoryRequestDto,
  ): Promise<MilestoneDocumentHistoryPageResponseDto> {
    return this.service
      .historyForStaff(milestoneId, documentId, applicationId, query)
      .then((result) => MilestoneDocumentHistoryPageResponseDto.from(result));
  }

  @Get(':documentId/history')
  @Header('Cache-Control', 'private, no-store')
  @Protected()
  participantHistory(
    @Req() request: ViewerRequest,
    @Param('milestoneId') milestoneId: string,
    @Param('documentId') documentId: string,
    @Query() query: MilestoneDocumentHistoryRequestDto,
  ): Promise<MilestoneDocumentHistoryPageResponseDto> {
    return this.service
      .historyForParticipant(
        request.sessionGithubId,
        milestoneId,
        documentId,
        query,
      )
      .then((result) => MilestoneDocumentHistoryPageResponseDto.from(result));
  }

  @Post(':documentId/applications/:applicationId/reviews')
  @HttpCode(201)
  @Protected()
  @Roles(STAFF_AUDIENCE, staffOnly)
  @UseGuards(OriginGuard)
  review(
    @Req() request: ViewerRequest,
    @Param('milestoneId') milestoneId: string,
    @Param('documentId') documentId: string,
    @Param('applicationId') applicationId: string,
    @Body() body: CreateMilestoneDocumentReviewRequestDto,
  ): Promise<MilestoneDocumentReviewResponseDto> {
    return this.reviewsService
      .review(
        request.principal.id,
        milestoneId,
        documentId,
        applicationId,
        this.reviewsService.reviewInputFromRequest(body),
      )
      .then((result) => MilestoneDocumentReviewResponseDto.from(result));
  }

  @Post(':documentId/submissions')
  @HttpCode(201)
  @Protected()
  @UseGuards(OriginGuard)
  submit(
    @Req() request: ViewerRequest,
    @Param('milestoneId') milestoneId: string,
    @Param('documentId') documentId: string,
    @Body() body: CreateMilestoneDocumentSubmissionRequestDto,
  ): Promise<MilestoneDocumentSubmissionResponseDto> {
    return this.service
      .submit(
        request.sessionGithubId,
        milestoneId,
        documentId,
        this.milestoneDocumentRulesService.parseMilestoneDocumentContent(
          body.content,
        ),
      )
      .then((result) => MilestoneDocumentSubmissionResponseDto.from(result));
  }

  @Get(':documentId/submissions/current/file')
  @Header('Cache-Control', 'private, no-store')
  @Protected()
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
    this.downloadResponseService.setDownloadHeaders(response, file);
    return new StreamableFile(file.body);
  }

  private respondWithArchiveFailure(
    error: Error,
    response: Response,
    request: ArchiveFailureRequest,
  ): void {
    archiveLogger.error(
      `서류 일괄 내려받기가 압축 도중 실패했다: milestoneId=${request.milestoneId} scope=${request.scope.kind} storageKey=${failedStorageKey(error)} error=${error.message}`,
    );
    this.downloadResponseService.respondWithDownloadFailure(
      response,
      MILESTONE_DOCUMENTS_ERROR_CODES[
        MilestoneDocumentsErrorCode.FILE_STORAGE_UNAVAILABLE
      ],
      'END',
    );
  }
}
