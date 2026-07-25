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
import { OriginGuard } from '../auth/origin.guard';
import { type AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { NotificationSettingsResponseDto } from './dto/notification-settings-response.dto';
import { UpdateNotificationEmailRequestDto } from './dto/update-notification-email-request.dto';
import { NotificationSettingsService } from './notification-settings.service';

type SessionIdentity = Pick<AuthenticatedRequest, 'sessionGithubId'>;

/**
 * 본인 알림 채널 설정 — 역할 무관 로그인 사용자(#156 settings).
 * 발송 배치 수신자는 여전히 STAFF + notifyEnabled 만(deadline-digest).
 */
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
