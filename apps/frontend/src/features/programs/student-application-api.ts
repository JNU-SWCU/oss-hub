import { apiClient } from '@/lib/api-client';

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

export interface StudentApplication {
  readonly id: string;
  readonly programId: string;
  readonly status: 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  readonly teamId: string | null;
  readonly answers: {
    readonly applicantName: string;
    readonly title: string;
    readonly summary: string;
  };
  readonly submittedAt: string;
  readonly updatedAt: string;
  readonly isRepositoryPublicationPlanned: boolean;
  readonly canManage: boolean;
  /** @deprecated Use canManage. */
  readonly canEdit: boolean;
  /** @deprecated Use canManage. */
  readonly canCancel: boolean;
}

export interface UpdateStudentApplicationInput {
  readonly answers: {
    readonly title: string;
    readonly summary: string;
  };
  readonly applicationTemplateVersion: number;
}

export function getMyApplication(
  programId: string,
): Promise<StudentApplication> {
  return apiClient<StudentApplication>(
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
      headers: JSON_HEADERS,
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
