import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OriginGuard } from '../auth/origin.guard';
import { type AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import {
  ProgramNoticePreviewRequestDto,
  ProgramNoticePreviewResponseDto,
} from './dto/program-notice-preview.dto';
import { ProgramNoticePreviewService } from './program-notice-preview.service';

@Controller('program-authoring')
export class ProgramNoticePreviewController {
  constructor(private readonly previews: ProgramNoticePreviewService) {}

  @Post('notice-preview')
  @HttpCode(200)
  @UseGuards(SessionGuard, OriginGuard)
  async preview(
    @Req() request: Pick<AuthenticatedRequest, 'sessionGithubId'>,
    @Body() input: ProgramNoticePreviewRequestDto,
  ): Promise<ProgramNoticePreviewResponseDto> {
    return new ProgramNoticePreviewResponseDto(
      await this.previews.preview(request.sessionGithubId, input.url),
    );
  }
}
