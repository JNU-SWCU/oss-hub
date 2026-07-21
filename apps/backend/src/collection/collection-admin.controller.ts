import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';

import { OriginGuard } from '../auth/origin.guard';
import { SessionGuard } from '../auth/session.guard';
import { CollectionAdminGuard } from './collection-admin.guard';
import { CollectionSchedulerService } from './collection-scheduler.service';
import { CollectionTriggerResponseDto } from './dto/collection-trigger-response.dto';

@Controller('admin/collection')
export class CollectionAdminController {
  constructor(private readonly scheduler: CollectionSchedulerService) {}

  @Post('trigger')
  @HttpCode(202)
  @UseGuards(SessionGuard, CollectionAdminGuard, OriginGuard)
  trigger(): CollectionTriggerResponseDto {
    const execution = this.scheduler.trigger();
    return new CollectionTriggerResponseDto(execution.runId);
  }
}
