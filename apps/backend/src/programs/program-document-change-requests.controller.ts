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
import { OriginGuard } from '../auth/origin.guard';
import { SessionGuard } from '../auth/session.guard';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import {
  CreateProgramDocumentChangeRequestRequestDto,
  ProgramDocumentChangeRequestTargetsQueryRequestDto,
  ProgramDocumentChangeRequestTargetsResponseDto,
} from './dto/program-document-change-request.dto';
import { ProgramDocumentChangeRequestsService } from './program-document-change-requests.service';

type SessionRequest = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('programs/:programId/documents/change-requests')
export class ProgramDocumentChangeRequestsController {
  constructor(
    private readonly changeRequests: ProgramDocumentChangeRequestsService,
  ) {}

  @Get('targets')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard)
  async targets(
    @Req() request: SessionRequest,
    @Param('programId') programId: string,
    @Query() query: ProgramDocumentChangeRequestTargetsQueryRequestDto,
  ): Promise<ProgramDocumentChangeRequestTargetsResponseDto> {
    return ProgramDocumentChangeRequestTargetsResponseDto.from(
      await this.changeRequests.targets(
        request.sessionGithubId,
        programId,
        query.toScope(),
      ),
    );
  }

  @Post()
  @HttpCode(201)
  @UseGuards(SessionGuard, OriginGuard)
  create(
    @Req() request: SessionRequest,
    @Param('programId') programId: string,
    @Body() body: CreateProgramDocumentChangeRequestRequestDto,
  ): Promise<{ readonly requestedCount: number }> {
    return this.changeRequests.requestChanges(
      request.sessionGithubId,
      programId,
      body.toInput(),
    );
  }
}
