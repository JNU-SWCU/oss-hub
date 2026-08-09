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
import type { Request } from 'express';
import { AuthConfig } from '../../auth/auth.config';
import { OriginGuard } from '../../auth/origin.guard';
import { resolveSession } from '../../auth/session-resolution';
import { type AuthenticatedRequest, SessionGuard } from '../../auth/session.guard';
import { CreateProgramRequestDto } from '../dto/create-program-request.dto';
import { CreateProgramResponseDto } from '../dto/create-program-response.dto';
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
export class ProgramsController {
  constructor(
    private readonly creation: ProgramCreationService,
    private readonly programs: ProgramsService,
    private readonly activity: ProgramActivityService,
    private readonly viewers: ProgramViewerService,
    private readonly config: AuthConfig,
  ) {}

  /**
   * 공개 목록 — 인증 없이 열려 있다(가드 없음). 세션 쿠키가 있으면 뷰어를
   * 해석해 개인화 필드(note/viewerApplicationStatus/집계)를 붙이고, 쿠키가
   * 없거나 무효하면 익명으로 취급해 공개 필드만 반환한다(getSession과 동일 패턴).
   */
  @Get()
  async list(
    @Query() query: ProgramListQueryRequestDto,
    @Req() request: Request,
  ): Promise<ProgramListPageResponseDto> {
    const { githubId } = await resolveSession(
      this.config,
      request.headers.cookie,
    );
    const viewer = await this.viewers.fromGithubId(githubId);
    return ProgramListPageResponseDto.from(
      await this.programs.list(query.toQuery(), viewer),
    );
  }

  /** static sibling before programs/:id — 사이드바 상태 뱃지용 공개 집계. */
  @Get('status-counts')
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
