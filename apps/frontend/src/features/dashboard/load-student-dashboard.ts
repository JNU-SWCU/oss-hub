import { fetchStudentDashboard } from './api';
import type { StudentDashboard } from './types';

export type StudentDashboardLoadResult =
  | { readonly status: 'success'; readonly data: StudentDashboard }
  | { readonly status: 'error' };

export async function loadStudentDashboard(
  fetchDashboard: () => Promise<StudentDashboard> = fetchStudentDashboard,
): Promise<StudentDashboardLoadResult> {
  try {
    const data = await fetchDashboard();
    return { status: 'success', data };
  } catch {
    // StudentDashboardScreen은 .then만 연결하므로 loader는 항상 resolve한다.
    return { status: 'error' };
  }
}
