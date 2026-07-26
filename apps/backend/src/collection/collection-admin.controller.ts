import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { OriginGuard } from '../auth/origin.guard';
import { SessionGuard } from '../auth/session.guard';
import { CollectionAdminGuard } from './collection-admin.guard';
import { CollectionReconciliationService } from './collection-reconciliation.service';
import { CollectionTriggerResponseDto } from './dto/collection-trigger-response.dto';

@Controller('admin/collection')
export class CollectionAdminController {
  private readonly ownerId = `admin:${randomUUID()}`;

  constructor(
    private readonly reconciliation: CollectionReconciliationService,
  ) {}

  @Post('trigger')
  @HttpCode(202)
  @UseGuards(SessionGuard, CollectionAdminGuard, OriginGuard)
  async trigger(): Promise<CollectionTriggerResponseDto> {
    const result = await this.reconciliation.trigger(this.ownerId);
    return new CollectionTriggerResponseDto(result.runId);
  }
}
