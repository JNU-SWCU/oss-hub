import { Body, Controller, Inject, Patch, Req, UseGuards } from '@nestjs/common';
import { OriginGuard } from '../auth/origin.guard';
import { type AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { NotificationSettingsResponseDto } from './dto/notification-settings-response.dto';
import { UpdateNotificationEmailRequestDto } from './dto/update-notification-email-request.dto';
import { NotificationsStaffGuard } from './notifications-staff.guard';
import { NotificationSettingsService } from './notification-settings.service';

type SessionIdentity = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('users/me/notification-email')
export class NotificationSettingsController {
  constructor(
    @Inject(NotificationSettingsService)
    private readonly service: Pick<
      NotificationSettingsService,
      'updateMyNotificationEmail'
    >,
  ) {}

  @Patch()
  @UseGuards(SessionGuard, NotificationsStaffGuard, OriginGuard)
  async updateMyNotificationEmail(
    @Req() request: SessionIdentity,
    @Body() body: UpdateNotificationEmailRequestDto,
  ): Promise<NotificationSettingsResponseDto> {
    return NotificationSettingsResponseDto.from(
      await this.service.updateMyNotificationEmail(
        request.sessionGithubId,
        body.toInput(),
      ),
    );
  }
}
