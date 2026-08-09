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
  /**
   * 교직원이 반려하며 남긴 사유. 반려가 아니면 `null`이며 **키는 상태와 무관하게 항상
   * 온다** — 없는 키와 `null`은 화면에서 다르게 읽히므로 백엔드가 키를 지우지 않는다
   * (`student-applications.controller.ts`의 `StudentApplicationResponse`).
   *
   * 이 값이 학생에게 사유가 닿는 유일한 통로다 — 알림·감사 로그·메일에는 담기지 않는다.
   */
  readonly rejectionReason: string | null;
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
