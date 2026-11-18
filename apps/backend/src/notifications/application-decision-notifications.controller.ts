import {
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OriginGuard } from '../platform/origin.guard';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { ApplicationDecisionNotificationsService } from './application-decision-notifications.service';
import { ApplicationDecisionNotificationPageResponseDto } from './dto/application-decision-notification-response.dto';
import { TeamDeletionNotificationPageResponseDto } from './dto/team-deletion-notification-response.dto';
import { Protected } from '../auth/auth-route.decorator';

type SessionIdentity = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('users/me/notifications')
export class ApplicationDecisionNotificationsController {
  constructor(
    @Inject(ApplicationDecisionNotificationsService)
    private readonly service: Pick<
      ApplicationDecisionNotificationsService,
      | 'listUnread'
      | 'markRead'
      | 'listUnreadTeamDeletions'
      | 'markTeamDeletionRead'
    >,
  ) {}

  @Get('team-decisions')
  @Header('Cache-Control', 'private, no-store')
  @Protected()
  async listUnread(
    @Req() request: SessionIdentity,
  ): Promise<ApplicationDecisionNotificationPageResponseDto> {
    return ApplicationDecisionNotificationPageResponseDto.from(
      await this.service.listUnread(request.sessionGithubId),
    );
  }

  @Patch('team-decisions/:notificationId/read')
  @HttpCode(204)
  @Protected()
  @UseGuards(OriginGuard)
  async markRead(
    @Req() request: SessionIdentity,
    @Param('notificationId') notificationId: string,
  ): Promise<void> {
    await this.service.markRead(request.sessionGithubId, notificationId);
  }

  @Get('team-deletions')
  @Header('Cache-Control', 'private, no-store')
  @Protected()
  async listUnreadTeamDeletions(
    @Req() request: SessionIdentity,
  ): Promise<TeamDeletionNotificationPageResponseDto> {
    return TeamDeletionNotificationPageResponseDto.from(
      await this.service.listUnreadTeamDeletions(request.sessionGithubId),
    );
  }

  @Patch('team-deletions/:notificationId/read')
  @HttpCode(204)
  @Protected()
  @UseGuards(OriginGuard)
  async markTeamDeletionRead(
    @Req() request: SessionIdentity,
    @Param('notificationId') notificationId: string,
  ): Promise<void> {
    await this.service.markTeamDeletionRead(
      request.sessionGithubId,
      notificationId,
    );
  }
}
