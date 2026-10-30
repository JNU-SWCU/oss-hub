import { Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { OriginGuard } from '../auth/origin.guard';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { SessionGuard } from '../auth/session.guard';
import { CollectionTriggerResponseDto } from './dto/collection-trigger-response.dto';
import { CollectionAdminService } from '../github/collection-admin.service';

@Controller('admin/collection')
export class CollectionAdminController {
  constructor(private readonly admin: CollectionAdminService) {}

  @Post('trigger')
  @HttpCode(202)
  @UseGuards(SessionGuard, OriginGuard)
  async trigger(
    @Req() request: Pick<AuthenticatedRequest, 'sessionGithubId'>,
  ): Promise<CollectionTriggerResponseDto> {
    const result = await this.admin.trigger(request.sessionGithubId);
    return new CollectionTriggerResponseDto(result.runId);
  }
}
