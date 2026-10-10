import {
  Body,
  Controller,
  Header,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OriginGuard } from '../../auth/controller/origin.guard';
import type { AuthenticatedRequest } from '../../auth/controller/http-auth';
import { SessionGuard } from '../../auth/controller/session.guard';
import { DeadlineDigestService } from '../service/deadline-digest.service';
import type {
  DeadlineDigestPreview,
  DeadlineDigestSendResult,
} from '../domain/deadline-digest';
import { DeadlineDigestSendRequestDto } from '../dto/deadline-digest-send-request.dto';
import { DeadlineDigestGuidanceRequestDto } from '../dto/deadline-digest-guidance-request.dto';

type SessionIdentity = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('programs/:programId/deadline-digest')
export class DeadlineDigestController {
  constructor(private readonly service: DeadlineDigestService) {}

  @Post('preview')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard, OriginGuard)
  preview(
    @Req() request: SessionIdentity,
    @Param('programId') programId: string,
    @Body() input: DeadlineDigestGuidanceRequestDto,
  ): Promise<DeadlineDigestPreview> {
    return this.service.previewProgram(
      request.sessionGithubId,
      programId,
      new Date(),
      input,
    );
  }

  @Post('send')
  @Header('Cache-Control', 'private, no-store')
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
