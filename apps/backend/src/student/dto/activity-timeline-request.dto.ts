import { IsIn } from 'class-validator';
import {
  ACTIVITY_GRANULARITIES,
  type ActivityGranularity,
} from '../../programs/program-activity.service';

export class ActivityTimelineRequestDto {
  @IsIn(ACTIVITY_GRANULARITIES)
  readonly granularity: ActivityGranularity = 'MONTH';
}
