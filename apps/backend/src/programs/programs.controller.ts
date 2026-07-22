import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthConfig } from '../auth/auth.config';
import { OriginGuard } from '../auth/origin.guard';
import { resolveSession } from '../auth/session-resolution';
import { type AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { CreateProgramRequestDto } from './dto/create-program-request.dto';
import { CreateProgramResponseDto } from './dto/create-program-response.dto';
import type {
  ProgramActivityResponseDto,
  ProgramDetailResponseDto,
} from './dto/program-detail.dto';
import { ProgramCreationService } from './program-creation.service';
import { ProgramActivityService } from './program-activity.service';
import { ProgramViewerService } from './program-viewer.service';
import { ProgramsService } from './programs.service';

@Controller('programs')
export class ProgramsController {
  constructor(
    private readonly config: AuthConfig,
    private readonly creation: ProgramCreationService,
    private readonly programs: ProgramsService,
    private readonly activity: ProgramActivityService,
    private readonly viewers: ProgramViewerService,
  ) {}

  @Post()
  @HttpCode(201)
  @UseGuards(SessionGuard, OriginGuard)
  async create(
    @Req() request: AuthenticatedRequest,
    @Body() input: CreateProgramRequestDto,
  ): Promise<CreateProgramResponseDto> {
    const program = await this.creation.create(request.sessionGithubId, input);
    return CreateProgramResponseDto.from(program);
  }

  @Get(':id')
  async detail(
    @Param('id') programId: string,
    @Req() request: Request,
  ): Promise<ProgramDetailResponseDto> {
    return this.programs.detail(programId, await this.viewer(request));
  }

  @Get(':id/activity')
  async programActivity(
    @Param('id') programId: string,
    @Req() request: Request,
  ): Promise<readonly ProgramActivityResponseDto[]> {
    return this.activity.activity(programId, await this.viewer(request));
  }

  private async viewer(request: Request) {
    const session = await resolveSession(this.config, request.headers.cookie);
    return this.viewers.fromGithubId(session.githubId);
  }
}
