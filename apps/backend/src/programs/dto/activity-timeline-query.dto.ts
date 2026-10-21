import { IsIn } from 'class-validator';
import {
  ACTIVITY_GRANULARITIES,
  type ActivityGranularity,
} from '../domain/program-activity-granularity';

export class ActivityTimelineQueryRequestDto {
  @IsIn(ACTIVITY_GRANULARITIES)
  readonly granularity: ActivityGranularity = 'MONTH';
}
