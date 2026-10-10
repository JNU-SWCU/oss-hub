import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../auth/controller/http-auth';
import { SessionGuard } from '../../auth/controller/session.guard';
import {
  SubmissionFileCleanupFailuresService,
  type SubmissionFileCleanupFailure,
} from '../service/submission-file-cleanup-failures.service';

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
