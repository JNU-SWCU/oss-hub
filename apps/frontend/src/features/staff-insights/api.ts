import { apiClient } from '@/lib/api-client';
import { insightsRequestPath } from './insights-year';
import { parseStaffInsightsSummary } from './parser';
import type { InsightsYearScope, StaffInsightsSummary } from './types';

export async function getStaffInsights(
  scope: InsightsYearScope,
  signal: AbortSignal | undefined,
): Promise<StaffInsightsSummary> {
  const options = signal === undefined ? undefined : { signal };
  const response = await apiClient<unknown>(
    insightsRequestPath(scope),
    options,
  );
  return parseStaffInsightsSummary(response);
}
