import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OriginGuard } from '../../auth/controller/origin.guard';
import type { AuthenticatedRequest } from '../../auth/controller/http-auth';
import { SessionGuard } from '../../auth/controller/session.guard';
import { NotificationSettingsResponseDto } from '../dto/notification-settings-response.dto';
import { UpdateNotificationEmailRequestDto } from '../dto/update-notification-email-request.dto';
import { NotificationSettingsService } from '../service/notification-settings.service';

type SessionIdentity = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('users/me/notification-email')
export class NotificationSettingsController {
  constructor(
    @Inject(NotificationSettingsService)
    private readonly service: Pick<
      NotificationSettingsService,
      'getMyNotificationSettings' | 'updateMyNotificationEmail'
    >,
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard)
  async getMyNotificationSettings(
    @Req() request: SessionIdentity,
  ): Promise<NotificationSettingsResponseDto> {
    return NotificationSettingsResponseDto.from(
      await this.service.getMyNotificationSettings(request.sessionGithubId),
    );
  }

  @Patch()
  @UseGuards(SessionGuard, OriginGuard)
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
