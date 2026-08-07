import { Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { OriginGuard } from '../auth/origin.guard';
import { type AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import {
  DeadlineDigestFailuresService,
  type DeadlineDigestFailure,
} from './deadline-digest-failures.service';
import { DeadlineDigestTriggerService } from './deadline-digest-trigger.service';

@Controller('notifications/deadline-digests')
export class DeadlineDigestFailuresController {
  constructor(
    private readonly failuresService: DeadlineDigestFailuresService,
    private readonly triggerService: DeadlineDigestTriggerService,
  ) {}

  @Get('failures')
  @UseGuards(SessionGuard)
  listFailures(
    @Req() request: AuthenticatedRequest,
  ): Promise<DeadlineDigestFailure[]> {
    return this.failuresService.listFailures(request.sessionGithubId);
  }

  @Post('send')
  @UseGuards(SessionGuard, OriginGuard)
  async triggerSend(
    @Req() request: AuthenticatedRequest,
  ): Promise<{ readonly ok: true }> {
    await this.triggerService.triggerSend(request.sessionGithubId);
    return { ok: true };
  }
}
