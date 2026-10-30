import { IsIn } from 'class-validator';
import {
  ACTIVITY_GRANULARITIES,
  type ActivityGranularity,
} from '../program-activity-granularity.policy';

export class ActivityTimelineQueryRequestDto {
  @IsIn(ACTIVITY_GRANULARITIES)
  readonly granularity: ActivityGranularity = 'MONTH';
}
