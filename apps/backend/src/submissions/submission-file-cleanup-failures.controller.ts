import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { type AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import {
  SubmissionFileCleanupFailuresService,
  type SubmissionFileCleanupFailure,
} from './submission-file-cleanup-failures.service';

@Controller('submission-files/cleanup')
export class SubmissionFileCleanupFailuresController {
  constructor(private readonly service: SubmissionFileCleanupFailuresService) {}

  @Get('failures')
  @UseGuards(SessionGuard)
  listFailures(
    @Req() request: AuthenticatedRequest,
  ): Promise<SubmissionFileCleanupFailure[]> {
    return this.service.listExhausted(request.sessionGithubId);
  }
}
