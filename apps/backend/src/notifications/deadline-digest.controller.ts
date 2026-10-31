import {
  Body,
  Controller,
  Header,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { OriginGuard } from '../platform/origin.guard';
import { DeadlineDigestService } from './deadline-digest.service';
import { DeadlineDigestPreviewResponseDto } from './dto/deadline-digest-preview-response.dto';
import { DeadlineDigestSendResponseDto } from './dto/deadline-digest-send-response.dto';
import { DeadlineDigestSendRequestDto } from './dto/deadline-digest-send-request.dto';
import { DeadlineDigestGuidanceRequestDto } from './dto/deadline-digest-guidance-request.dto';
import { Protected } from '../auth/authentication.guard';
import { Roles, STAFF_AUDIENCE } from '../platform/roles.guard';
import { DomainException } from '../platform/error-code.error';
import {
  NOTIFICATIONS_ERROR_CODES,
  NotificationsErrorCode,
} from './notifications-error-code.error';

const staffOnly = () =>
  new DomainException(
    NOTIFICATIONS_ERROR_CODES[NotificationsErrorCode.STAFF_ONLY],
  );

@Controller('programs/:programId/deadline-digest')
export class DeadlineDigestController {
  constructor(private readonly service: DeadlineDigestService) {}

  @Post('preview')
  @Header('Cache-Control', 'private, no-store')
  @Protected()
  @Roles(STAFF_AUDIENCE, staffOnly)
  @UseGuards(OriginGuard)
  async preview(
    @Param('programId') programId: string,
    @Body() input: DeadlineDigestGuidanceRequestDto,
  ): Promise<DeadlineDigestPreviewResponseDto> {
    return DeadlineDigestPreviewResponseDto.from(
      await this.service.previewProgram(programId, new Date(), input),
    );
  }

  @Post('send')
  @Header('Cache-Control', 'private, no-store')
  @Protected()
  @Roles(STAFF_AUDIENCE, staffOnly)
  @UseGuards(OriginGuard)
  async send(
    @Param('programId') programId: string,
    @Body() input: DeadlineDigestSendRequestDto,
  ): Promise<DeadlineDigestSendResponseDto> {
    return DeadlineDigestSendResponseDto.from(
      await this.service.sendProgramFromPreview(programId, input),
    );
  }
}
