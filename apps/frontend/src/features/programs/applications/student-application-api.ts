import { apiClient } from '@/lib/api-client';
import type {
  StudentApplication,
  UpdateStudentApplicationInput,
} from './student-application-dto';

type MyStudentApplicationResponse =
  | { readonly status: 'NONE' }
  | {
      readonly status: StudentApplication['status'];
      readonly application: StudentApplication;
    };

export async function getMyApplication(
  programId: string,
): Promise<StudentApplication | null> {
  const body = await apiClient<MyStudentApplicationResponse>(
    `programs/${encodeURIComponent(programId)}/applications/me`,
  );
  return body.status === 'NONE' ? null : body.application;
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
