import {
  Body,
  Controller,
  Delete,
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
import {
  OptionalSession,
  Protected,
  Public,
} from '../../auth/controller/auth-route-metadata';
import {
  HTTP_AUTH_KINDS,
  type OptionalSessionRequest,
} from '../../auth/controller/http-auth';
import { OriginGuard } from '../../auth/controller/origin.guard';
import type { AuthenticatedRequest } from '../../auth/controller/http-auth';
import { SessionGuard } from '../../auth/controller/session.guard';
import { CreateProgramRequestDto } from '../dto/create-program-request.dto';
import { CreateProgramResponseDto } from '../dto/create-program-response.dto';
import { PurgeProgramRequestDto } from '../dto/purge-program-request.dto';
import {
  ActivityTimelineQueryRequestDto,
  type ActivityTimelineResponseDto,
} from '../dto/activity-timeline.dto';
import type {
  ProgramActivityResponseDto,
  ProgramDetailResponseDto,
} from '../dto/program-detail.dto';
import { ProgramListQueryRequestDto } from '../dto/program-list-query.dto';
import { ProgramListPageResponseDto } from '../dto/program-list-response.dto';
import { ProgramStatusCountsResponseDto } from '../dto/program-status-counts-response.dto';
import { StudentDashboardResponseDto } from '../dto/student-dashboard-response.dto';
import { ProgramActivityService } from '../service/program-activity.service';
import { ProgramCreationService } from '../service/program-creation.service';
import { ProgramLifecycleService } from '../service/program-lifecycle.service';
import { ProgramViewerService } from '../service/program-viewer.service';
import { ProgramsService } from '../service/programs.service';
import { StudentDashboardService } from '../service/student-dashboard.service';

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
    private readonly lifecycle: ProgramLifecycleService,
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

  @Delete(':id/purge')
  @UseGuards(SessionGuard, OriginGuard)
  purge(
    @Param('id') programId: string,
    @Body() body: PurgeProgramRequestDto,
    @Req() request: SessionIdentity,
  ) {
    return this.lifecycle.purge(
      request.sessionGithubId,
      programId,
      body.expectedScope,
    );
  }

  @Delete(':id')
  @UseGuards(SessionGuard, OriginGuard)
  delete(
    @Param('id') programId: string,
    @Req() request: SessionIdentity,
  ): Promise<{ readonly id: string; readonly deleted: true }> {
    return this.lifecycle.delete(request.sessionGithubId, programId);
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
