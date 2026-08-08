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
import { OriginGuard } from '../auth/origin.guard';
import { type AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { ApplicationDecisionNotificationsService } from './application-decision-notifications.service';
import { ApplicationDecisionNotificationResponseDto } from './dto/application-decision-notification-response.dto';

type SessionIdentity = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('users/me/notifications/application-decisions')
export class ApplicationDecisionNotificationsController {
  constructor(
    @Inject(ApplicationDecisionNotificationsService)
    private readonly service: Pick<
      ApplicationDecisionNotificationsService,
      'listUnread' | 'markRead'
    >,
  ) {}

  @Get()
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

  @Patch(':notificationId/read')
  @HttpCode(204)
  @UseGuards(SessionGuard, OriginGuard)
  async markRead(
    @Req() request: SessionIdentity,
    @Param('notificationId') notificationId: string,
  ): Promise<void> {
    await this.service.markRead(request.sessionGithubId, notificationId);
  }
}
