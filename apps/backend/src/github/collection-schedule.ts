import { CronTime } from 'cron';
import { COLLECTION_CRON_EXPRESSION } from './service/collection-scheduler.service';

/**
 * Next Asia/Seoul tick of the wired collection cron.
 * Invalid expressions fail closed to null so ranking still returns 200.
 */
export function nextScheduledCollectionAt(from: Date): Date | null {
  try {
    const cronTime = new CronTime(COLLECTION_CRON_EXPRESSION, 'Asia/Seoul');
    return cronTime.getNextDateFrom(from).toJSDate();
  } catch {
    return null;
  }
}
