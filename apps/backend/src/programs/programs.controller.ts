import { ProgramViewerQueryRequestDto } from './dto/program-viewer-query.dto';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  OptionalSession,
  Protected,
  Public,
} from '../auth/auth-route-metadata.policy';
import {
  HTTP_AUTH_KINDS,
  type OptionalSessionRequest,
} from '../auth/http-auth.types';
import { OriginGuard } from '../auth/origin.guard';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { SessionGuard } from '../auth/session.guard';
import { CreateProgramRequestDto } from './dto/create-program-request.dto';
import { CreateProgramResponseDto } from './dto/create-program-response.dto';
import {
  programDetailResponse,
  programActivityResponse,
  type ProgramActivityResponseDto,
  type ProgramDetailResponseDto,
} from './dto/program-detail.dto';
import { ProgramListQueryRequestDto } from './dto/program-list-query.dto';
import { ProgramEndedYearsResponseDto } from './dto/program-ended-years-response.dto';
import { ProgramListPageResponseDto } from './dto/program-list-response.dto';
import { ProgramStatusCountsResponseDto } from './dto/program-status-counts-response.dto';
import { ProgramActivityService } from './program-activity.service';
import { ProgramCreationService } from './program-creation.service';
import { ProgramViewerService } from './program-viewer.service';
import { ProgramsService } from './programs.service';

type SessionIdentity = Pick<AuthenticatedRequest, 'sessionGithubId'>;

const ANONYMOUS_VIEWER = {
  githubId: null,
  userId: null,
  role: null,
} as const;

@Controller('programs')
@Protected()
export class ProgramsController {
  constructor(
    private readonly creation: ProgramCreationService,
    private readonly programs: ProgramsService,
    private readonly activity: ProgramActivityService,
    private readonly viewers: ProgramViewerService,
  ) {}

  @Get()
  @OptionalSession()
  async list(
    @Query() query: ProgramListQueryRequestDto,
    @Req() request: OptionalSessionRequest,
  ): Promise<ProgramListPageResponseDto> {
    const githubId =
      request.auth.kind === HTTP_AUTH_KINDS.AUTHENTICATED
        ? request.auth.principal.githubId
        : null;
    const viewer = await this.viewers.fromGithubId(githubId);
    return ProgramListPageResponseDto.from(
      await this.programs.list(query.toQuery(), viewer),
    );
  }

  @Get('status-counts')
  @Public()
  async statusCounts(): Promise<ProgramStatusCountsResponseDto> {
    return ProgramStatusCountsResponseDto.from(
      await this.programs.statusCounts(),
    );
  }

  @Get('ended-years')
  @OptionalSession()
  async endedYears(): Promise<ProgramEndedYearsResponseDto> {
    return ProgramEndedYearsResponseDto.from(await this.programs.endedYears());
  }

  @Post()
  @HttpCode(201)
  @UseGuards(SessionGuard, OriginGuard)
  async create(
    @Req() request: SessionIdentity,
    @Body() input: CreateProgramRequestDto,
  ): Promise<CreateProgramResponseDto> {
    const program = await this.creation.create(request.sessionGithubId, input);
    return CreateProgramResponseDto.from(program);
  }

  @Get(':id')
  @Public()
  async detail(
    @Param('id') programId: string,
  ): Promise<ProgramDetailResponseDto> {
    return programDetailResponse(
      await this.programs.detail(programId, ANONYMOUS_VIEWER),
    );
  }

  @Get(':id/viewer')
  @UseGuards(SessionGuard)
  async viewerDetail(
    @Param('id') programId: string,
    @Req() request: SessionIdentity,
    @Query() query: ProgramViewerQueryRequestDto = {},
  ): Promise<ProgramDetailResponseDto> {
    return programDetailResponse(
      await this.programs.detail(
        programId,
        await this.viewers.fromGithubId(
          request.sessionGithubId,
          programId,
          query.view === 'operations',
        ),
      ),
    );
  }

  @Get(':id/activity')
  @UseGuards(SessionGuard)
  async programActivity(
    @Param('id') programId: string,
    @Req() request: SessionIdentity,
  ): Promise<readonly ProgramActivityResponseDto[]> {
    return (
      await this.activity.activity(
        programId,
        await this.viewers.fromGithubId(request.sessionGithubId),
      )
    ).map(programActivityResponse);
  }
}
