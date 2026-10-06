import { CronTime } from 'cron';
import { nextScheduledCollectionAt } from './collection-schedule';

describe('nextScheduledCollectionAt', () => {
  it('evaluates the wired cron after `from` in Asia/Seoul', () => {
    expect(
      nextScheduledCollectionAt(new Date('2026-07-25T12:34:56.000Z')),
    ).toEqual(new Date('2026-07-25T13:00:00.000Z'));
  });

  it('returns the next hour when `from` is already on the hour', () => {
    expect(
      nextScheduledCollectionAt(new Date('2026-07-25T12:00:00.000Z')),
    ).toEqual(new Date('2026-07-25T13:00:00.000Z'));
  });

  it('returns null when cron evaluation throws', () => {
    const spy = jest
      .spyOn(CronTime.prototype, 'getNextDateFrom')
      .mockImplementation(() => {
        throw new Error('boom');
      });

    expect(
      nextScheduledCollectionAt(new Date('2026-07-25T12:00:00.000Z')),
    ).toBeNull();
    spy.mockRestore();
  });
});
