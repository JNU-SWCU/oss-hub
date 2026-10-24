import { apiClient } from '@/lib/api-client';
import type {
  StudentApplication,
  UpdateStudentApplicationInput,
} from './student-application-dto';

export function getMyApplication(
  programId: string,
): Promise<StudentApplication | null> {
  return apiClient<StudentApplication | null>(
    `programs/${encodeURIComponent(programId)}/applications/me`,
  );
}

export function updateMyApplication(
  programId: string,
  input: UpdateStudentApplicationInput,
): Promise<StudentApplication> {
  return apiClient<StudentApplication>(
    `programs/${encodeURIComponent(programId)}/applications/me`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
  );
}

export function cancelMyApplication(
  programId: string,
): Promise<{ readonly cancelled: true }> {
  return apiClient<{ readonly cancelled: true }>(
    `programs/${encodeURIComponent(programId)}/applications/me`,
    { method: 'DELETE' },
  );
}
