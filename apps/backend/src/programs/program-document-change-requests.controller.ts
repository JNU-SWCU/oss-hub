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
import { ProgramDocumentChangeRequestsService } from './program-document-change-requests.service';
import { ProgramDocumentChangeRequestCountResponseDto } from './dto/program-document-change-request-count-response.dto';
import { CreateProgramDocumentChangeRequestRequestDto } from './dto/create-program-document-change-request-request.dto';
import { ProgramDocumentChangeRequestTargetsRequestDto } from './dto/program-document-change-request-targets-request.dto';
import { ProgramDocumentChangeRequestTargetsResponseDto } from './dto/program-document-change-request-targets-response.dto';

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
    @Query() query: ProgramDocumentChangeRequestTargetsRequestDto,
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
  async create(
    @Req() request: SessionRequest,
    @Param('programId') programId: string,
    @Body() body: CreateProgramDocumentChangeRequestRequestDto,
  ): Promise<ProgramDocumentChangeRequestCountResponseDto> {
    return ProgramDocumentChangeRequestCountResponseDto.from(
      await this.changeRequests.requestChanges(
        request.sessionGithubId,
        programId,
        body.toInput(),
      ),
    );
  }
}
