import {
  Body,
  Controller,
  Header,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OriginGuard } from '../auth/origin.guard';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { DeadlineDigestService } from './deadline-digest.service';
import { DeadlineDigestPreviewResponseDto } from './dto/deadline-digest-preview-response.dto';
import { DeadlineDigestSendResponseDto } from './dto/deadline-digest-send-response.dto';
import { DeadlineDigestSendRequestDto } from './dto/deadline-digest-send-request.dto';
import { DeadlineDigestGuidanceRequestDto } from './dto/deadline-digest-guidance-request.dto';
import { Protected } from '../auth/authentication.guard';

type SessionIdentity = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('programs/:programId/deadline-digest')
export class DeadlineDigestController {
  constructor(private readonly service: DeadlineDigestService) {}

  @Post('preview')
  @Header('Cache-Control', 'private, no-store')
  @Protected()
  @UseGuards(OriginGuard)
  async preview(
    @Req() request: SessionIdentity,
    @Param('programId') programId: string,
    @Body() input: DeadlineDigestGuidanceRequestDto,
  ): Promise<DeadlineDigestPreviewResponseDto> {
    return DeadlineDigestPreviewResponseDto.from(
      await this.service.previewProgram(
        request.sessionGithubId,
        programId,
        new Date(),
        input,
      ),
    );
  }

  @Post('send')
  @Header('Cache-Control', 'private, no-store')
  @Protected()
  @UseGuards(OriginGuard)
  async send(
    @Req() request: SessionIdentity,
    @Param('programId') programId: string,
    @Body() input: DeadlineDigestSendRequestDto,
  ): Promise<DeadlineDigestSendResponseDto> {
    return DeadlineDigestSendResponseDto.from(
      await this.service.sendProgramFromPreview(
        request.sessionGithubId,
        programId,
        input,
      ),
    );
  }
}
