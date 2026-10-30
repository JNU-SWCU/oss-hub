import {
  Controller,
  Get,
  Header,
  Inject,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { SessionGuard } from '../auth/session.guard';
import { ActivityTimelineQueryRequestDto } from './dto/activity-timeline-query.dto';
import {
  activityTimelineResponse,
  type ActivityTimelineResponseDto,
} from './dto/activity-timeline.dto';
import {
  presentMilestoneDocumentFeedback,
  type MilestoneDocumentFeedbackResponseDto,
} from './dto/milestone-document-feedback-response.dto';
import { StudentDashboardResponseDto } from './dto/student-dashboard-response.dto';
import { ProgramActivityService } from '../programs/program-activity.service';
import { MilestoneDocumentFeedbackService } from './milestone-document-feedback.service';
import { StudentDashboardService } from './student-dashboard.service';
import { ProgramViewerService } from '../programs/program-viewer.service';

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
    private readonly feedback: MilestoneDocumentFeedbackService,
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

  @Get('feedback')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard)
  recentFeedback(
    @Req() request: SessionIdentity,
  ): Promise<MilestoneDocumentFeedbackResponseDto> {
    return this.feedback
      .recentForParticipant(request.sessionGithubId)
      .then(presentMilestoneDocumentFeedback);
  }
}
