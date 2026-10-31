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
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { ProgramDocumentChangeRequestsService } from './program-document-change-requests.service';
import { ProgramDocumentChangeRequestCountResponseDto } from './dto/program-document-change-request-count-response.dto';
import { CreateProgramDocumentChangeRequestRequestDto } from './dto/create-program-document-change-request-request.dto';
import { ProgramDocumentChangeRequestTargetsRequestDto } from './dto/program-document-change-request-targets-request.dto';
import { ProgramDocumentChangeRequestTargetsResponseDto } from './dto/program-document-change-request-targets-response.dto';
import { MilestoneDocumentRulesService } from './milestone-document-rules.service';
import { Protected } from '../auth/authentication.guard';

type SessionRequest = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('programs/:programId/documents/change-requests')
export class ProgramDocumentChangeRequestsController {
  constructor(
    private readonly changeRequests: ProgramDocumentChangeRequestsService,
    private readonly milestoneDocumentRulesService: MilestoneDocumentRulesService,
  ) {}

  @Get('targets')
  @Header('Cache-Control', 'private, no-store')
  @Protected()
  async targets(
    @Req() request: SessionRequest,
    @Param('programId') programId: string,
    @Query() query: ProgramDocumentChangeRequestTargetsRequestDto,
  ): Promise<ProgramDocumentChangeRequestTargetsResponseDto> {
    return ProgramDocumentChangeRequestTargetsResponseDto.from(
      await this.changeRequests.targets(
        request.sessionGithubId,
        programId,
        this.milestoneDocumentRulesService.toProgramDocumentChangeRequestScope(
          query.scope,
          query.teamId,
        ),
      ),
    );
  }

  @Post()
  @HttpCode(201)
  @Protected()
  @UseGuards(OriginGuard)
  async create(
    @Req() request: SessionRequest,
    @Param('programId') programId: string,
    @Body() body: CreateProgramDocumentChangeRequestRequestDto,
  ): Promise<ProgramDocumentChangeRequestCountResponseDto> {
    return ProgramDocumentChangeRequestCountResponseDto.from(
      await this.changeRequests.requestChanges(
        request.sessionGithubId,
        programId,
        this.milestoneDocumentRulesService.toProgramDocumentChangeRequestInput(
          body,
        ),
      ),
    );
  }
}
