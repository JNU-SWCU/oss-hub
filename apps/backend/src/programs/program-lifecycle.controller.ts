import {
  Body,
  Controller,
  Delete,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Protected } from '../auth/auth-route-metadata.policy';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { OriginGuard } from '../auth/origin.guard';
import { SessionGuard } from '../auth/session.guard';
import { PurgeProgramRequestDto } from './dto/purge-program-request.dto';
import { ProgramLifecycleService } from './program-lifecycle.service';

type SessionIdentity = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('programs')
@Protected()
export class ProgramLifecycleController {
  constructor(private readonly lifecycle: ProgramLifecycleService) {}

  @Delete(':id/purge')
  @UseGuards(SessionGuard, OriginGuard)
  purge(
    @Param('id') programId: string,
    @Body() body: PurgeProgramRequestDto,
    @Req() request: SessionIdentity,
  ) {
    return this.lifecycle.purge(
      request.sessionGithubId,
      programId,
      body.expectedScope,
    );
  }

  @Delete(':id')
  @UseGuards(SessionGuard, OriginGuard)
  delete(
    @Param('id') programId: string,
    @Req() request: SessionIdentity,
  ): Promise<{ readonly id: string; readonly deleted: true }> {
    return this.lifecycle.delete(request.sessionGithubId, programId);
  }
}
