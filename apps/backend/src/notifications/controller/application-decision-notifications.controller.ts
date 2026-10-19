import { TeamDeletionNotificationResponseDto } from '../dto/team-deletion-notification-response.dto';
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
import { OriginGuard } from '../../auth/controller/origin.guard';
import type { AuthenticatedRequest } from '../../auth/controller/http-auth';
import { SessionGuard } from '../../auth/controller/session.guard';
import { ApplicationDecisionNotificationsService } from '../service/application-decision-notifications.service';
import { ApplicationDecisionNotificationResponseDto } from '../dto/application-decision-notification-response.dto';

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

  @Get('application-decisions')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard)
  async listUnread(
    @Req() request: SessionIdentity,
  ): Promise<readonly ApplicationDecisionNotificationResponseDto[]> {
    return (await this.service.listUnread(request.sessionGithubId)).map(
      (notification) =>
        new ApplicationDecisionNotificationResponseDto(notification),
    );
  }

  @Patch('application-decisions/:notificationId/read')
  @HttpCode(204)
  @UseGuards(SessionGuard, OriginGuard)
  async markRead(
    @Req() request: SessionIdentity,
    @Param('notificationId') notificationId: string,
  ): Promise<void> {
    await this.service.markRead(request.sessionGithubId, notificationId);
  }

  @Get('team-deletions')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard)
  async listUnreadTeamDeletions(
    @Req() request: SessionIdentity,
  ): Promise<readonly TeamDeletionNotificationResponseDto[]> {
    return (
      await this.service.listUnreadTeamDeletions(request.sessionGithubId)
    ).map(
      (notification) => new TeamDeletionNotificationResponseDto(notification),
    );
  }

  @Patch('team-deletions/:notificationId/read')
  @HttpCode(204)
  @UseGuards(SessionGuard, OriginGuard)
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
