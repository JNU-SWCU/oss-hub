import { apiClient } from '@/lib/api-client';
import type { SystemStatus, SystemStatusResponse } from './types';

export async function fetchSystemStatus(): Promise<SystemStatus> {
  const response = await apiClient<SystemStatusResponse>('system-status');
  return response.collection;
}
