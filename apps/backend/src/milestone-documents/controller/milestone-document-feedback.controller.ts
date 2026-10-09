import { Controller, Get, Header, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../auth/controller/http-auth';
import { SessionGuard } from '../../auth/controller/session.guard';
import type { MilestoneDocumentFeedbackResponseDto } from '../dto/milestone-document-feedback-response.dto';
import { MilestoneDocumentFeedbackService } from '../service/milestone-document-feedback.service';

@Controller('dashboard/student')
export class MilestoneDocumentFeedbackController {
  constructor(private readonly service: MilestoneDocumentFeedbackService) {}

  @Get('feedback')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard)
  recentFeedback(
    @Req() request: Pick<AuthenticatedRequest, 'sessionGithubId'>,
  ): Promise<MilestoneDocumentFeedbackResponseDto> {
    return this.service.recentForParticipant(request.sessionGithubId);
  }
}
