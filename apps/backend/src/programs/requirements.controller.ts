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
import { type Response } from 'express';
import { type AuthenticatedRequest } from '../auth/http-auth.types';
import {
  MilestoneDocumentCurrentFileService,
  MilestoneDocumentCollectionService,
  RequirementArchiveService,
} from './requirement-archive.service';
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
} from './submissions.error';
import { MilestoneDocumentFilesService } from './files.service';
import { MilestoneDocumentReviewsService } from './submissions.service';
import {
  RequirementsService,
  ProgramDocumentChangeRequestsService,
} from './requirements.service';
import { Protected } from '../auth/auth-route.decorator';
import { DomainException } from '../platform/error-code.error';
import { STAFF_AUDIENCE } from '../platform/roles.guard';
import { Roles } from '../platform/roles.decorator';
import { ProgramDocumentArchiveRequestDto } from './dto/program-document-archive-request.dto';
import { ProgramDocumentChangeRequestCountResponseDto } from './dto/program-document-change-request-count-response.dto';
import { CreateProgramDocumentChangeRequestRequestDto } from './dto/create-program-document-change-request-request.dto';
import { ProgramDocumentChangeRequestTargetsRequestDto } from './dto/program-document-change-request-targets-request.dto';
import { ProgramDocumentChangeRequestTargetsResponseDto } from './dto/program-document-change-request-targets-response.dto';
type ViewerRequest = Pick<
  AuthenticatedRequest,
  'sessionGithubId' | 'principal'
>;
const staffOnly = () =>
  new DomainException(
    MILESTONE_DOCUMENTS_ERROR_CODES[MilestoneDocumentsErrorCode.STAFF_ONLY],
  );
@Controller('milestones/:milestoneId/documents')
export class RequirementsController {
  constructor(
    private readonly service: RequirementsService,
    private readonly filesService: MilestoneDocumentFilesService,
    private readonly reviewsService: MilestoneDocumentReviewsService,
    private readonly archiveService: RequirementArchiveService,
    private readonly collectionService: MilestoneDocumentCollectionService,
    private readonly currentFileService: MilestoneDocumentCurrentFileService,
  ) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  @Protected()
  async list(
    @Req()
    request: ViewerRequest,
    @Param('milestoneId')
    milestoneId: string,
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
  async collection(
    @Param('milestoneId')
    milestoneId: string,
    @Query()
    query: MilestoneDocumentCollectionRequestDto,
  ): Promise<MilestoneDocumentDeliveryCollectionResponseDto> {
    return MilestoneDocumentDeliveryCollectionResponseDto.from(
      await this.collectionService.collectForStaffFromRequest(
        milestoneId,
        query,
      ),
    );
  }
  @Get('collection/archive')
  @Header('Cache-Control', 'private, no-store')
  @Protected()
  @Roles(STAFF_AUDIENCE, staffOnly)
  async archive(
    @Param('milestoneId')
    milestoneId: string,
    @Query()
    query: MilestoneDocumentArchiveRequestDto,
    @Res({ passthrough: true })
    response: Response,
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
    @Param('milestoneId')
    milestoneId: string,
    @Param('documentId')
    documentId: string,
    @Body()
    body: UpdateMilestoneDocumentGraceRequestDto,
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
    @Req()
    request: ViewerRequest,
    @Param('milestoneId')
    milestoneId: string,
    @Param('documentId')
    documentId: string,
    @Res({ passthrough: true })
    response: Response,
  ): Promise<StreamableFile> {
    return this.filesService.downloadTemplateTo(
      response,
      request.sessionGithubId,
      milestoneId,
      documentId,
    );
  }

  @Get(':documentId/teams/:teamId/file')
  @Header('Cache-Control', 'private, no-store')
  @Protected()
  @Roles(STAFF_AUDIENCE, staffOnly)
  async downloadSubmissionFile(
    @Param('milestoneId') milestoneId: string,
    @Param('documentId') documentId: string,
    @Param('teamId') teamId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    return this.filesService.downloadSubmissionFileTo(
      response,
      milestoneId,
      documentId,
      teamId,
    );
  }

  @Get(':documentId/teams/:teamId/history')
  @Header('Cache-Control', 'private, no-store')
  @Protected()
  @Roles(STAFF_AUDIENCE, staffOnly)
  async history(
    @Param('milestoneId') milestoneId: string,
    @Param('documentId') documentId: string,
    @Param('teamId') teamId: string,
    @Query() query: MilestoneDocumentHistoryRequestDto,
  ): Promise<MilestoneDocumentHistoryPageResponseDto> {
    return MilestoneDocumentHistoryPageResponseDto.from(
      await this.service.historyForStaff(
        milestoneId,
        documentId,
        teamId,
        query,
      ),
    );
  }
  @Get(':documentId/history')
  @Header('Cache-Control', 'private, no-store')
  @Protected()
  async participantHistory(
    @Req()
    request: ViewerRequest,
    @Param('milestoneId')
    milestoneId: string,
    @Param('documentId')
    documentId: string,
    @Query()
    query: MilestoneDocumentHistoryRequestDto,
  ): Promise<MilestoneDocumentHistoryPageResponseDto> {
    return MilestoneDocumentHistoryPageResponseDto.from(
      await this.service.historyForParticipant(
        request.sessionGithubId,
        milestoneId,
        documentId,
        query,
      ),
    );
  }

  @Post(':documentId/teams/:teamId/reviews')
  @HttpCode(201)
  @Protected()
  @Roles(STAFF_AUDIENCE, staffOnly)
  @UseGuards(OriginGuard)
  async review(
    @Req() request: ViewerRequest,
    @Param('milestoneId') milestoneId: string,
    @Param('documentId') documentId: string,
    @Param('teamId') teamId: string,
    @Body() body: CreateMilestoneDocumentReviewRequestDto,
  ): Promise<MilestoneDocumentReviewResponseDto> {
    return MilestoneDocumentReviewResponseDto.from(
      await this.reviewsService.reviewFromRequest(
        request.principal.id,
        milestoneId,
        documentId,
        teamId,
        body,
      ),
    );
  }
  @Post(':documentId/submissions')
  @HttpCode(201)
  @Protected()
  @UseGuards(OriginGuard)
  async submit(
    @Req()
    request: ViewerRequest,
    @Param('milestoneId')
    milestoneId: string,
    @Param('documentId')
    documentId: string,
    @Body()
    body: CreateMilestoneDocumentSubmissionRequestDto,
  ): Promise<MilestoneDocumentSubmissionResponseDto> {
    return MilestoneDocumentSubmissionResponseDto.from(
      await this.service.submitFromRequest(
        request.sessionGithubId,
        milestoneId,
        documentId,
        body,
      ),
    );
  }
  @Get(':documentId/submissions/current/file')
  @Header('Cache-Control', 'private, no-store')
  @Protected()
  async downloadCurrentSubmissionFile(
    @Req()
    request: ViewerRequest,
    @Param('milestoneId')
    milestoneId: string,
    @Param('documentId')
    documentId: string,
    @Res({ passthrough: true })
    response: Response,
  ): Promise<StreamableFile> {
    return this.currentFileService.downloadTo(
      response,
      request.sessionGithubId,
      milestoneId,
      documentId,
    );
  }
}
@Controller('programs/:programId/documents/collection/archive')
export class ProgramDocumentArchivesController {
  constructor(private readonly archives: RequirementArchiveService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @Protected()
  @Roles(STAFF_AUDIENCE, staffOnly)
  async archive(
    @Param('programId') programId: string,
    @Query() query: ProgramDocumentArchiveRequestDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    return this.archives.streamArchiveForProgramStaff(
      response,
      programId,
      query,
    );
  }
}
type SessionRequest = Pick<AuthenticatedRequest, 'principal'>;

@Controller('programs/:programId/documents/change-requests')
export class ProgramDocumentChangeRequestsController {
  constructor(
    private readonly changeRequests: ProgramDocumentChangeRequestsService,
  ) {}

  @Get('targets')
  @Header('Cache-Control', 'private, no-store')
  @Protected()
  @Roles(STAFF_AUDIENCE, staffOnly)
  async targets(
    @Param('programId') programId: string,
    @Query() query: ProgramDocumentChangeRequestTargetsRequestDto,
  ): Promise<ProgramDocumentChangeRequestTargetsResponseDto> {
    return ProgramDocumentChangeRequestTargetsResponseDto.from(
      await this.changeRequests.targetsFromRequest(programId, query),
    );
  }

  @Post()
  @HttpCode(201)
  @Protected()
  @Roles(STAFF_AUDIENCE, staffOnly)
  @UseGuards(OriginGuard)
  async create(
    @Req() request: SessionRequest,
    @Param('programId') programId: string,
    @Body() body: CreateProgramDocumentChangeRequestRequestDto,
  ): Promise<ProgramDocumentChangeRequestCountResponseDto> {
    return ProgramDocumentChangeRequestCountResponseDto.from(
      await this.changeRequests.requestChangesFromRequest(
        request.principal.id,
        programId,
        body,
      ),
    );
  }
}
