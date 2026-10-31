import { Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { OriginGuard } from '../auth/origin.guard';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { CollectionTriggerResponseDto } from './dto/collection-trigger-response.dto';
import { CollectionAdminService } from '../github/collection-admin.service';
import { Protected } from '../auth/authentication.guard';

@Controller('admin/collection')
export class CollectionAdminController {
  constructor(private readonly admin: CollectionAdminService) {}

  @Post('trigger')
  @HttpCode(202)
  @Protected()
  @UseGuards(OriginGuard)
  async trigger(
    @Req() request: Pick<AuthenticatedRequest, 'sessionGithubId'>,
  ): Promise<CollectionTriggerResponseDto> {
    const result = await this.admin.trigger(request.sessionGithubId);
    return CollectionTriggerResponseDto.from(result.runId);
  }
}
