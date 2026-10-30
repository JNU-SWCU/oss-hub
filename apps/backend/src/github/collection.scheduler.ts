import {
  Inject,
  Injectable,
} from '../../../../node_modules/.pnpm/@nestjs+common@11.1.28_class-transformer@0.5.1_class-validator@0.14.4_reflect-metadata@0.2.2_rxjs@7.8.2/node_modules/@nestjs/common';
import { Cron } from '../../../../node_modules/.pnpm/@nestjs+schedule@6.1.3_@nestjs+common@11.1.28_class-transformer@0.5.1_class-validator@0_e75f0cc371221d379e70a1a969cce4d1/node_modules/@nestjs/schedule';
import {
  COLLECTION_CRON_EXPRESSION,
  COLLECTION_CRON_JOB_NAME,
  CollectionTriggerService,
} from './collection-trigger.service';

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
