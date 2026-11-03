import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  Cron,
  Interval,
  ScheduleModule,
  SchedulerRegistry,
  Timeout,
} from '@nestjs/schedule';
import { MaintenanceConfig } from './maintenance.config';

@Injectable()
class ScheduledWriter {
  @Cron('0 0 1 1 *', { name: 'writer-cron' })
  cron(): void {}

  @Interval('writer-interval', 60_000)
  interval(): void {}

  @Timeout('writer-timeout', 60_000)
  timeout(): void {}
}

describe('maintenance schedule suppression', () => {
  it.each([undefined, '', '0', 'true', ' 1 '])(
    'does not silently enter maintenance for %s',
    (value) => {
      expect(MaintenanceConfig.enabled({ OSS_HUB_MAINTENANCE: value })).toBe(
        false,
      );
    },
  );

  it.each(['1', undefined])(
    'registers no scheduler kinds only when maintenance is exactly 1 (%s)',
    async (value) => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          ScheduleModule.forRoot(
            MaintenanceConfig.scheduleOptions({ OSS_HUB_MAINTENANCE: value }),
          ),
        ],
        providers: [ScheduledWriter],
      }).compile();
      try {
        await moduleRef.init();
        const registry = moduleRef.get(SchedulerRegistry);
        const expected = value === '1' ? 0 : 1;
        expect([
          registry.getCronJobs().size,
          registry.getIntervals().length,
          registry.getTimeouts().length,
        ]).toEqual([expected, expected, expected]);
        if (value === '1') {
          expect(MaintenanceConfig.scheduleState(registry)).toEqual({
            cronJobs: 0,
            intervals: 0,
            timeouts: 0,
          });
        } else {
          expect(() => MaintenanceConfig.scheduleState(registry)).toThrow(
            'scheduled jobs are registered',
          );
        }
      } finally {
        await moduleRef.close();
      }
    },
  );
});
