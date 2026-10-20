import {
  Controller,
  Get,
  Header,
  Inject,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../../auth/controller/http-auth';
import { SessionGuard } from '../../auth/controller/session.guard';
import { ActivityTimelineQueryRequestDto } from '../dto/activity-timeline-query.dto';
import {
  activityTimelineResponse,
  type ActivityTimelineResponseDto,
} from '../dto/activity-timeline.dto';
import { StudentDashboardResponseDto } from '../dto/student-dashboard-response.dto';
import { ProgramActivityService } from '../service/program-activity.service';
import { StudentDashboardService } from '../service/student-dashboard.service';
import { ProgramViewerService } from '../service/program-viewer.service';

type SessionIdentity = Pick<AuthenticatedRequest, 'sessionGithubId'>;

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
    return activityTimelineResponse(
      await this.activity.activityTimeline(
        await this.viewers.studentFromGithubId(request.sessionGithubId),
        query.granularity,
      ),
    );
  }
}
