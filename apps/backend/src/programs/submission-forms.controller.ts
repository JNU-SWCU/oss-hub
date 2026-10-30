import { Controller, Get, Header, Param, Req, UseGuards } from '@nestjs/common';
import {
  presentSubmissionForm,
  type SubmissionFormResponseDto,
} from './dto/submission-form-response.dto';
import { SubmissionsService } from './submissions.service';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { SessionGuard } from '../auth/session.guard';

type SubmissionRequest = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('programs/:programId/milestones/:milestoneId')
export class SubmissionFormsController {
  constructor(private readonly service: SubmissionsService) {}

  @Get('submission-form')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard)
  async form(
    @Req() request: SubmissionRequest,
    @Param('programId') programId: string,
    @Param('milestoneId') milestoneId: string,
  ): Promise<SubmissionFormResponseDto> {
    const result = await this.service.form(
      request.sessionGithubId,
      programId,
      milestoneId,
    );
    return presentSubmissionForm(result, programId, milestoneId);
  }
}
