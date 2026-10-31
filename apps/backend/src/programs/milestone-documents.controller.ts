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
import { MilestoneDocumentArchiveService } from './milestone-document-archive.service';
import { MilestoneDocumentFilesService } from './milestone-document-files.service';
import { MilestoneDocumentReviewsService } from './milestone-document-reviews.service';
import { MilestoneDocumentsService } from './milestone-documents.service';
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
    return this.archiveService.streamArchiveForStaff(
      response,
      milestoneId,
      query,
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
    return this.filesService.downloadTemplateTo(
      response,
      request.sessionGithubId,
      milestoneId,
      documentId,
    );
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
    return this.filesService.downloadSubmissionFileTo(
      response,
      milestoneId,
      documentId,
      applicationId,
    );
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
      .reviewFromRequest(
        request.principal.id,
        milestoneId,
        documentId,
        applicationId,
        body,
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
      .submitFromRequest(request.sessionGithubId, milestoneId, documentId, body)
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
    return this.currentFileService.downloadTo(
      response,
      request.sessionGithubId,
      milestoneId,
      documentId,
    );
  }
}
