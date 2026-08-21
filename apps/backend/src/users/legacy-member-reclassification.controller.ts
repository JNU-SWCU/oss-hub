import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OriginGuard } from '../auth/origin.guard';
import { type AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { LegacyMemberReclassificationRequestDto } from './dto/legacy-member-reclassification.dto';
import { LegacyMemberReclassificationService } from './legacy-member-reclassification.service';

type SessionIdentity = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('users/me/legacy-member-reclassification')
export class LegacyMemberReclassificationController {
  constructor(
    @Inject(LegacyMemberReclassificationService)
    private readonly service: Pick<
      LegacyMemberReclassificationService,
      'reclassify'
    >,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard, OriginGuard)
  async reclassify(
    @Req() request: SessionIdentity,
    @Body() body: LegacyMemberReclassificationRequestDto,
  ) {
    const result = await this.service.reclassify(
      request.sessionGithubId,
      body.toInput(),
    );
    return {
      memberKind: result.memberKind,
      hasStaffAccess: result.hasStaffAccess,
      hasAdminAccess: result.hasAdminAccess,
    };
  }
}
