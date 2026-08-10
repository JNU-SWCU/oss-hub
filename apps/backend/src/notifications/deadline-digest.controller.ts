import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { OriginGuard } from '../auth/origin.guard';
import { type AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { DeadlineDigestService } from './deadline-digest.service';
import type {
  DeadlineDigestPreview,
  DeadlineDigestSendResult,
} from './deadline-digest.service';
import { DeadlineDigestSendRequestDto } from './dto/deadline-digest-send-request.dto';

type SessionIdentity = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('programs/:programId/deadline-digest')
export class DeadlineDigestController {
  constructor(private readonly service: DeadlineDigestService) {}

  @Post('preview')
  @UseGuards(SessionGuard, OriginGuard)
  preview(
    @Req() request: SessionIdentity,
    @Param('programId') programId: string,
  ): Promise<DeadlineDigestPreview> {
    return this.service.previewProgram(request.sessionGithubId, programId);
  }

  @Post('send')
  @UseGuards(SessionGuard, OriginGuard)
  send(
    @Req() request: SessionIdentity,
    @Param('programId') programId: string,
    @Body() input: DeadlineDigestSendRequestDto,
  ): Promise<DeadlineDigestSendResult> {
    return this.service.sendProgramFromPreview(
      request.sessionGithubId,
      programId,
      input,
    );
  }
}
