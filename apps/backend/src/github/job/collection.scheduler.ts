import { Inject, Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import {
  COLLECTION_CRON_EXPRESSION,
  COLLECTION_CRON_JOB_NAME,
  CollectionTriggerService,
} from '../service/collection-trigger.service';

@Injectable()
export class CollectionScheduler {
  constructor(
    @Inject(CollectionTriggerService)
    private readonly trigger: Pick<CollectionTriggerService, 'runScheduled'>,
  ) {}

  @Cron(COLLECTION_CRON_EXPRESSION, {
    name: COLLECTION_CRON_JOB_NAME,
    timeZone: 'Asia/Seoul',
    waitForCompletion: true,
  })
  handleCron(): Promise<void> {
    return this.trigger.runScheduled();
  }
}
