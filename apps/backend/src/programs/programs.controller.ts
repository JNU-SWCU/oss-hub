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
import { OriginGuard } from '../auth/origin.guard';
import { type AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { CreateProgramRequestDto } from './dto/create-program-request.dto';
import { CreateProgramResponseDto } from './dto/create-program-response.dto';
import type {
  ProgramActivityResponseDto,
  ProgramDetailResponseDto,
} from './dto/program-detail.dto';
import { ProgramListQueryRequestDto } from './dto/program-list-query.dto';
import { ProgramListPageResponseDto } from './dto/program-list-response.dto';
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
export class ProgramsController {
  constructor(
    private readonly creation: ProgramCreationService,
    private readonly programs: ProgramsService,
    private readonly activity: ProgramActivityService,
    private readonly viewers: ProgramViewerService,
  ) {}

  @Get()
  async list(
    @Query() query: ProgramListQueryRequestDto,
  ): Promise<ProgramListPageResponseDto> {
    return ProgramListPageResponseDto.from(
      await this.programs.list(query.toQuery()),
    );
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
  detail(@Param('id') programId: string): Promise<ProgramDetailResponseDto> {
    return this.programs.detail(programId, ANONYMOUS_VIEWER);
  }

  @Get(':id/viewer')
  @UseGuards(SessionGuard)
  async viewerDetail(
    @Param('id') programId: string,
    @Req() request: SessionIdentity,
  ): Promise<ProgramDetailResponseDto> {
    return this.programs.detail(
      programId,
      await this.viewers.fromGithubId(request.sessionGithubId),
    );
  }

  @Get(':id/activity')
  @UseGuards(SessionGuard)
  async programActivity(
    @Param('id') programId: string,
    @Req() request: SessionIdentity,
  ): Promise<readonly ProgramActivityResponseDto[]> {
    return this.activity.activity(
      programId,
      await this.viewers.fromGithubId(request.sessionGithubId),
    );
  }
}
