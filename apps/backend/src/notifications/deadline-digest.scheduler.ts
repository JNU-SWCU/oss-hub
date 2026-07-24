import { Inject, Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DeadlineDigestService } from './deadline-digest.service';

@Injectable()
export class DeadlineDigestScheduler {
  constructor(
    @Inject(DeadlineDigestService)
    private readonly service: DeadlineDigestService,
  ) {}

  /** 매일 09:00에 D-1 마감 임박 마일스톤 다이제스트를 발송한다(발송 시점은 코드 상수). */
  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async run(): Promise<void> {
    await this.service.sendDeadlineDigests();
  }
}
