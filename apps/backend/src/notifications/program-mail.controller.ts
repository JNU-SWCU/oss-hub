import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Protected } from '../auth/auth-route.decorator';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { DomainException } from '../platform/error-code.error';
import { OriginGuard } from '../platform/origin.guard';
import { Roles } from '../platform/roles.decorator';
import { STAFF_AUDIENCE } from '../platform/roles.guard';
import {
  NOTIFICATIONS_ERROR_CODES,
  NotificationsErrorCode,
} from './notifications-error-code.error';
import { ProgramMailDraftRequestDto } from './dto/program-mail-draft-request.dto';
import { ProgramMailPreviewResponseDto } from './dto/program-mail-preview-response.dto';
import { ProgramMailRecipientsResponseDto } from './dto/program-mail-recipients-response.dto';
import { ProgramMailSendRequestDto } from './dto/program-mail-send-request.dto';
import { ProgramMailSendResponseDto } from './dto/program-mail-send-response.dto';
import { ProgramMailService } from './program-mail.service';

const staffOnly = () =>
  new DomainException(
    NOTIFICATIONS_ERROR_CODES[NotificationsErrorCode.STAFF_ONLY],
  );

type SessionIdentity = Pick<AuthenticatedRequest, 'principal'>;

@Controller('programs/:programId/mail')
export class ProgramMailController {
  constructor(private readonly service: ProgramMailService) {}

  @Get('recipients')
  @Header('Cache-Control', 'private, no-store')
  @Protected()
  @Roles(STAFF_AUDIENCE, staffOnly)
  @UseGuards(OriginGuard)
  async recipients(
    @Param('programId') programId: string,
  ): Promise<ProgramMailRecipientsResponseDto> {
    return ProgramMailRecipientsResponseDto.from(
      await this.service.recipients(programId),
    );
  }

  @Post('preview')
  @Header('Cache-Control', 'private, no-store')
  @Protected()
  @Roles(STAFF_AUDIENCE, staffOnly)
  @UseGuards(OriginGuard)
  async preview(
    @Req() request: SessionIdentity,
    @Param('programId') programId: string,
    @Body() input: ProgramMailDraftRequestDto,
  ): Promise<ProgramMailPreviewResponseDto> {
    return ProgramMailPreviewResponseDto.from(
      await this.service.preview(programId, request.principal, input),
    );
  }

  @Post('send')
  @Header('Cache-Control', 'private, no-store')
  @Protected()
  @Roles(STAFF_AUDIENCE, staffOnly)
  @UseGuards(OriginGuard)
  async send(
    @Req() request: SessionIdentity,
    @Param('programId') programId: string,
    @Body() input: ProgramMailSendRequestDto,
  ): Promise<ProgramMailSendResponseDto> {
    return ProgramMailSendResponseDto.from(
      await this.service.send(programId, request.principal, input),
    );
  }
}
