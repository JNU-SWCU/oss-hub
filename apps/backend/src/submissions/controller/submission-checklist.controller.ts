import { Controller, Get, Header, Param, Req, UseGuards } from '@nestjs/common';
import {
  presentSubmissionChecklist,
  type SubmissionChecklistResponseDto,
} from '../dto/submission-response.dto';
import { SubmissionsService } from '../service/submissions.service';
import type { AuthenticatedRequest } from '../../auth/controller/http-auth';
import { SessionGuard } from '../../auth/controller/session.guard';

type SubmissionRequest = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('programs/:programId/submissions')
export class SubmissionChecklistController {
  constructor(private readonly service: SubmissionsService) {}

  @Get('me')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard)
  checklist(
    @Req() request: SubmissionRequest,
    @Param('programId') programId: string,
  ): Promise<SubmissionChecklistResponseDto> {
    return this.service
      .checklist(request.sessionGithubId, programId)
      .then(presentSubmissionChecklist);
  }
}
