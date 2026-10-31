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
import { OriginGuard } from '../platform/origin.guard';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { NotificationSettingsResponseDto } from './dto/notification-settings-response.dto';
import { UpdateNotificationEmailRequestDto } from './dto/update-notification-email-request.dto';
import { NotificationSettingsService } from './application-decision-notifications.service';
import { Protected } from '../auth/authentication.guard';

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
  @Protected()
  async getMyNotificationSettings(
    @Req() request: SessionIdentity,
  ): Promise<NotificationSettingsResponseDto> {
    return NotificationSettingsResponseDto.from(
      await this.service.getMyNotificationSettings(request.sessionGithubId),
    );
  }

  @Patch()
  @Protected()
  @UseGuards(OriginGuard)
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
