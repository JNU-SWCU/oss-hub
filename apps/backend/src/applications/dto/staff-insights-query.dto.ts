import { IsOptional, Matches } from 'class-validator';
import {
  INSIGHTS_YEAR_MAX,
  INSIGHTS_YEAR_MIN,
} from '../staff-insights-year';

const INSIGHTS_YEAR_PARAM_PATTERN = /^(all|20\d{2}|2100)$/i;

/**
 * `GET /dashboard/staff/insights` query.
 * Absent `year` means all-time. The raw string never leaves this DTO.
 */
export class StaffInsightsQueryRequestDto {
  @IsOptional()
  @Matches(INSIGHTS_YEAR_PARAM_PATTERN, {
    message: `year must be omitted, "all", or a calendar year between ${INSIGHTS_YEAR_MIN} and ${INSIGHTS_YEAR_MAX}`,
  })
  readonly year?: string;
}
