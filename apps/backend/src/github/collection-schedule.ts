import { CronTime } from 'cron';
import { COLLECTION_CRON_EXPRESSION } from './service/collection-scheduler.service';

export function nextScheduledCollectionAt(from: Date): Date | null {
  try {
    const cronTime = new CronTime(COLLECTION_CRON_EXPRESSION, 'Asia/Seoul');
    return cronTime.getNextDateFrom(from).toJSDate();
  } catch {
    return null;
  }
}
