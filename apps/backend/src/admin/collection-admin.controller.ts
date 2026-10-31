import { Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { OriginGuard } from '../platform/origin.guard';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { CollectionTriggerResponseDto } from './dto/collection-trigger-response.dto';
import { CollectionAdminService } from '../github/collection-admin.service';
import { Protected } from '../auth/authentication.guard';
import { ADMIN_AUDIENCE, Roles } from '../platform/roles.guard';
import { DomainException } from '../platform/error-code.error';
import {
  COLLECTION_ERROR_CODES,
  CollectionErrorCode,
} from '../github/collection-error-code.error';

const adminRequired = () =>
  new DomainException(
    COLLECTION_ERROR_CODES[CollectionErrorCode.ADMIN_REQUIRED],
  );

@Controller('admin/collection')
export class CollectionAdminController {
  constructor(private readonly admin: CollectionAdminService) {}

  @Post('trigger')
  @HttpCode(202)
  @Protected()
  @Roles(ADMIN_AUDIENCE, adminRequired)
  @UseGuards(OriginGuard)
  async trigger(
    @Req() request: Pick<AuthenticatedRequest, 'sessionGithubId'>,
  ): Promise<CollectionTriggerResponseDto> {
    const result = await this.admin.trigger(request.sessionGithubId);
    return CollectionTriggerResponseDto.from(result.runId);
  }
}
