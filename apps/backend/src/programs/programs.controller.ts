import { Controller, Get, Param, Req, UseFilters } from '@nestjs/common';
import type { Request } from 'express';
import type {
  ProgramActivityDto,
  ProgramDetailDto,
} from './dto/program-detail.dto';
import { ProgramActivityService } from './program-activity.service';
import { ProgramDetailExceptionFilter } from './program-detail-exception.filter';
import { ProgramViewerService } from './program-viewer.service';
import { ProgramsService } from './programs.service';

@Controller('programs')
@UseFilters(ProgramDetailExceptionFilter)
export class ProgramsController {
  constructor(
    private readonly programs: ProgramsService,
    private readonly activity: ProgramActivityService,
    private readonly viewers: ProgramViewerService,
  ) {}

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
