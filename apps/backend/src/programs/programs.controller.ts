import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
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
import {
  ActivityTimelineQueryRequestDto,
  type ActivityTimelineResponseDto,
} from './dto/activity-timeline.dto';
import type {
  ProgramActivityResponseDto,
  ProgramDetailResponseDto,
} from './dto/program-detail.dto';
import { ProgramListQueryRequestDto } from './dto/program-list-query.dto';
import { ProgramListPageResponseDto } from './dto/program-list-response.dto';
import { ProgramStatusCountsResponseDto } from './dto/program-status-counts-response.dto';
import { StudentDashboardResponseDto } from './dto/student-dashboard-response.dto';
import { ProgramActivityService } from './program-activity.service';
import { ProgramCreationService } from './program-creation.service';
import { ProgramViewerService } from './program-viewer.service';
import { ProgramsService } from './programs.service';
import { StudentDashboardService } from './student-dashboard.service';

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

  /** static sibling before programs/:id — 사이드바 상태 뱃지용 공개 집계. */
  @Get('status-counts')
  async statusCounts(): Promise<ProgramStatusCountsResponseDto> {
    return ProgramStatusCountsResponseDto.from(
      await this.programs.statusCounts(),
    );
  }

  @Get('viewer')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard)
  async viewerList(
    @Query() query: ProgramListQueryRequestDto,
    @Req() request: SessionIdentity,
  ): Promise<ProgramListPageResponseDto> {
    return ProgramListPageResponseDto.from(
      await this.programs.list(
        query.toQuery(),
        await this.viewers.fromGithubId(request.sessionGithubId),
      ),
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

@Controller('dashboard/student')
export class StudentDashboardController {
  constructor(
    @Inject(StudentDashboardService)
    private readonly dashboard: Pick<
      StudentDashboardService,
      'getStudentDashboard'
    >,
    private readonly activity: ProgramActivityService,
    private readonly viewers: ProgramViewerService,
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard)
  async dashboardSummary(
    @Req() request: SessionIdentity,
  ): Promise<StudentDashboardResponseDto> {
    return StudentDashboardResponseDto.from(
      await this.dashboard.getStudentDashboard(request.sessionGithubId),
    );
  }

  @Get('activity-timeline')
  @UseGuards(SessionGuard)
  async activityTimeline(
    @Req() request: SessionIdentity,
    @Query() query: ActivityTimelineQueryRequestDto,
  ): Promise<ActivityTimelineResponseDto> {
    return this.activity.activityTimeline(
      await this.viewers.fromGithubId(request.sessionGithubId),
      query.granularity,
    );
  }
}
