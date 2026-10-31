import { Controller, Get, Header, Inject, Query, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { ActivityTimelineRequestDto } from './dto/activity-timeline-request.dto';
import { ActivityTimelineResponseDto } from './dto/activity-timeline-response.dto';
import { MilestoneDocumentFeedbackResponseDto } from './dto/milestone-document-feedback-response.dto';
import { StudentDashboardResponseDto } from './dto/student-dashboard-response.dto';
import { ProgramActivityService } from '../programs/program-activity.service';
import { MilestoneDocumentFeedbackService } from './milestone-document-feedback.service';
import { StudentDashboardService } from './student-dashboard.service';
import { ProgramViewerService } from '../programs/program-viewer.service';
import { Protected } from '../auth/auth-route.decorator';

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
  @Protected()
  async dashboardSummary(
    @Req() request: SessionIdentity,
  ): Promise<StudentDashboardResponseDto> {
    return StudentDashboardResponseDto.from(
      await this.dashboard.getStudentDashboard(request.sessionGithubId),
    );
  }

  @Get('activity-timeline')
  @Protected()
  async activityTimeline(
    @Req() request: SessionIdentity,
    @Query() query: ActivityTimelineRequestDto,
  ): Promise<ActivityTimelineResponseDto> {
    return ActivityTimelineResponseDto.from(
      await this.activity.activityTimeline(
        await this.viewers.studentFromGithubId(request.sessionGithubId),
        query.granularity,
      ),
    );
  }

  @Get('feedback')
  @Header('Cache-Control', 'private, no-store')
  @Protected()
  recentFeedback(
    @Req() request: SessionIdentity,
  ): Promise<MilestoneDocumentFeedbackResponseDto> {
    return this.feedback
      .recentForParticipant(request.sessionGithubId)
      .then((result) => MilestoneDocumentFeedbackResponseDto.from(result));
  }
}
