import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import type { ActivityGranularity } from '../../programs/program-activity.service';
import { ACTIVITY_GRANULARITIES } from '../../programs/program-activity.config';

export class ActivityTimelineRequestDto {
  @ApiPropertyOptional()
  @IsIn(ACTIVITY_GRANULARITIES)
  readonly granularity: ActivityGranularity = 'MONTH';
}
