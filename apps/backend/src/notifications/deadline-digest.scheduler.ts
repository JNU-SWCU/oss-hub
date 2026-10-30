import {
  Inject,
  Injectable,
} from '../../../../node_modules/.pnpm/@nestjs+common@11.1.28_class-transformer@0.5.1_class-validator@0.14.4_reflect-metadata@0.2.2_rxjs@7.8.2/node_modules/@nestjs/common';
import {
  Cron,
  CronExpression,
} from '../../../../node_modules/.pnpm/@nestjs+schedule@6.1.3_@nestjs+common@11.1.28_class-transformer@0.5.1_class-validator@0_e75f0cc371221d379e70a1a969cce4d1/node_modules/@nestjs/schedule';
import { DeadlineDigestService } from './deadline-digest.service';

@Injectable()
export class DeadlineDigestScheduler {
  constructor(
    @Inject(DeadlineDigestService)
    private readonly service: DeadlineDigestService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_9AM, { timeZone: 'Asia/Seoul' })
  async run(): Promise<void> {
    await this.service.sendDeadlineDigests();
  }
}
