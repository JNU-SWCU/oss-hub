import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { OriginGuard } from '../auth/origin.guard';
import { type AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { CreateProgramRequestDto } from './dto/create-program-request.dto';
import { CreateProgramResponseDto } from './dto/create-program-response.dto';
import type {
  ProgramActivityDto,
  ProgramDetailDto,
} from './dto/program-detail.dto';
import { ProgramCreationService } from './program-creation.service';
import { ProgramActivityService } from './program-activity.service';
import { ProgramDetailExceptionFilter } from './program-detail-exception.filter';
import { ProgramViewerService } from './program-viewer.service';
import { ProgramsService } from './programs.service';

@Controller('programs')
@UseFilters(ProgramDetailExceptionFilter)
export class ProgramsController {
  constructor(
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
  ): Promise<ProgramDetailDto> {
    return this.programs.detail(
      programId,
      await this.viewers.fromRequest(request),
    );
  }

  @Get(':id/activity')
  async programActivity(
    @Param('id') programId: string,
    @Req() request: Request,
  ): Promise<readonly ProgramActivityDto[]> {
    return this.activity.activity(
      programId,
      await this.viewers.fromRequest(request),
    );
  }
}
