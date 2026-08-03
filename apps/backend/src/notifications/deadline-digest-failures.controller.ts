import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { type AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import {
  DeadlineDigestFailuresService,
  type DeadlineDigestFailure,
} from './deadline-digest-failures.service';

@Controller('notifications/deadline-digests')
export class DeadlineDigestFailuresController {
  constructor(private readonly service: DeadlineDigestFailuresService) {}

  @Get('failures')
  @UseGuards(SessionGuard)
  listFailures(
    @Req() request: AuthenticatedRequest,
  ): Promise<DeadlineDigestFailure[]> {
    return this.service.listFailures(request.sessionGithubId);
  }
}
