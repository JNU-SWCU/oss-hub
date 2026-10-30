import { Inject, Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
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
