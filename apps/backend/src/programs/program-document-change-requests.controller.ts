import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OriginGuard } from '../platform/origin.guard';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { ProgramDocumentChangeRequestsService } from './program-document-change-requests.service';
import { ProgramDocumentChangeRequestCountResponseDto } from './dto/program-document-change-request-count-response.dto';
import { CreateProgramDocumentChangeRequestRequestDto } from './dto/create-program-document-change-request-request.dto';
import { ProgramDocumentChangeRequestTargetsRequestDto } from './dto/program-document-change-request-targets-request.dto';
import { ProgramDocumentChangeRequestTargetsResponseDto } from './dto/program-document-change-request-targets-response.dto';
import { Protected } from '../auth/auth-route.decorator';
import { STAFF_AUDIENCE } from '../platform/roles.guard';
import { Roles } from '../platform/roles.decorator';
import { DomainException } from '../platform/error-code.error';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from './milestone-documents-error-code.error';

type SessionRequest = Pick<AuthenticatedRequest, 'principal'>;

const staffOnly = () =>
  new DomainException(
    MILESTONE_DOCUMENTS_ERROR_CODES[MilestoneDocumentsErrorCode.STAFF_ONLY],
  );

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
