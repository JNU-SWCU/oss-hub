import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api-client';
import {
  cancelMyApplication,
  getMyApplication,
  updateMyApplication,
} from './student-application-api';

vi.mock('@/lib/api-client', () => ({
  apiClient: vi.fn(),
}));

describe('student application API', () => {
  beforeEach(() => {
    vi.mocked(apiClient).mockReset();
  });

  it('내 신청을 조회한다', async () => {
    // Given
    const response = {
      id: 'application-1',
      programId: 'program-1',
      status: 'SUBMITTED' as const,
      teamId: null,
      answers: {
        applicantName: '합성 학생',
        title: '제목',
        summary: '요약',
      },
      submittedAt: '2026-07-10T00:00:00.000Z',
      updatedAt: '2026-07-10T00:00:00.000Z',
      canManage: true,
    };
    vi.mocked(apiClient).mockResolvedValue(response);

    // When
    const result = await getMyApplication('program-1');

    // Then
    expect(apiClient).toHaveBeenCalledWith(
      'programs/program-1/applications/me',
    );
    expect(result).toEqual(response);
  });

  it('내 신청 내용을 수정한다', async () => {
    // Given
    vi.mocked(apiClient).mockResolvedValue({});

    // When
    await updateMyApplication('program-1', {
      answers: { title: '수정 제목', summary: '수정 요약' },
      applicationTemplateVersion: 1,
    });

    // Then
    expect(apiClient).toHaveBeenCalledWith(
      'programs/program-1/applications/me',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          answers: { title: '수정 제목', summary: '수정 요약' },
          applicationTemplateVersion: 1,
        }),
      }),
    );
  });

  it('내 신청을 취소한다', async () => {
    // Given
    vi.mocked(apiClient).mockResolvedValue({ cancelled: true });

    // When
    await cancelMyApplication('program-1');

    // Then
    expect(apiClient).toHaveBeenCalledWith(
      'programs/program-1/applications/me',
      { method: 'DELETE' },
    );
  });
});
