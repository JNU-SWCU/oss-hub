import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api-client';
import {
  createApplication,
  decideApplication,
  getProgramStatusCounts,
  listPrograms,
} from './api';
import type { ProgramListPage, ProgramStatusCounts } from './types';

vi.mock('@/lib/api-client', () => ({
  apiClient: vi.fn(),
}));

describe('listPrograms', () => {
  beforeEach(() => {
    vi.mocked(apiClient).mockReset();
  });

  it('sends search, status, and pagination through the public list query', async () => {
    // Given
    const response = {
      items: [],
      page: 2,
      pageSize: 20,
      totalItems: 21,
      totalPages: 2,
    } satisfies ProgramListPage;
    vi.mocked(apiClient).mockResolvedValue(response);

    // When
    const result = await listPrograms({
      page: 2,
      pageSize: 20,
      search: '동명 프로그램',
      status: 'ended',
    });

    // Then
    expect(apiClient).toHaveBeenCalledWith(
      'programs?page=2&pageSize=20&search=%EB%8F%99%EB%AA%85+%ED%94%84%EB%A1%9C%EA%B7%B8%EB%9E%A8&status=ended',
    );
    expect(result).toEqual(response);
  });

  it('학생 목록은 viewer 경로로 현재 신청 상태를 요청한다', async () => {
    const response = {
      items: [],
      page: 1,
      pageSize: 20,
      totalItems: 0,
      totalPages: 0,
    } satisfies ProgramListPage;
    vi.mocked(apiClient).mockResolvedValue(response);

    await listPrograms(
      { page: 1, pageSize: 20, search: '', status: 'all' },
      true,
    );

    expect(apiClient).toHaveBeenCalledWith(
      'programs/viewer?page=1&pageSize=20&search=&status=all',
    );
  });
});

describe('getProgramStatusCounts', () => {
  beforeEach(() => {
    vi.mocked(apiClient).mockReset();
  });

  it('fetches public status-counts for sidebar badges', async () => {
    const response = {
      all: 15,
      recruiting: 3,
      in_progress: 3,
      upcoming: 0,
      ended: 9,
    } satisfies ProgramStatusCounts;
    vi.mocked(apiClient).mockResolvedValue(response);

    await expect(getProgramStatusCounts()).resolves.toEqual(response);
    expect(apiClient).toHaveBeenCalledWith('programs/status-counts');
  });
});

describe('createApplication', () => {
  beforeEach(() => {
    vi.mocked(apiClient).mockReset();
  });

  it('POST programs/:id/applications 로 신청 본문을 보낸다', async () => {
    const response = {
      id: 'app-1',
      programId: 'program-1',
      status: 'SUBMITTED' as const,
      teamId: null,
      submittedAt: '2026-07-15T00:00:00.000Z',
      isRepositoryPublicationPlanned: true,
    };
    vi.mocked(apiClient).mockResolvedValue(response);

    const result = await createApplication('program-1', {
      answers: { title: '제목', summary: '요약' },
      teamId: null,
      applicationTemplateVersion: 1,
      isRepositoryPublicationPlanned: true,
    });

    expect(apiClient).toHaveBeenCalledWith(
      'programs/program-1/applications',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          answers: { title: '제목', summary: '요약' },
          teamId: null,
          applicationTemplateVersion: 1,
          isRepositoryPublicationPlanned: true,
        }),
      }),
    );
    expect(result).toEqual(response);
  });

  it('명시적 false 는 그대로 전송한다', async () => {
    const response = {
      id: 'app-2',
      programId: 'program-1',
      status: 'SUBMITTED' as const,
      teamId: null,
      submittedAt: '2026-07-15T00:00:00.000Z',
      isRepositoryPublicationPlanned: false,
    };
    vi.mocked(apiClient).mockResolvedValue(response);

    const result = await createApplication('program-1', {
      answers: { title: '제목', summary: '요약' },
      teamId: null,
      applicationTemplateVersion: 1,
      isRepositoryPublicationPlanned: false,
    });

    expect(apiClient).toHaveBeenCalledWith(
      'programs/program-1/applications',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          answers: { title: '제목', summary: '요약' },
          teamId: null,
          applicationTemplateVersion: 1,
          isRepositoryPublicationPlanned: false,
        }),
      }),
    );
    expect(result).toEqual(response);
  });

  it('학생 목록은 viewer 경로로 현재 신청 상태를 요청한다', async () => {
    const response = {
      items: [],
      page: 1,
      pageSize: 20,
      totalItems: 0,
      totalPages: 0,
    } satisfies ProgramListPage;
    vi.mocked(apiClient).mockResolvedValue(response);

    await listPrograms(
      { page: 1, pageSize: 20, search: '', status: 'all' },
      true,
    );

    expect(apiClient).toHaveBeenCalledWith(
      'programs/viewer?page=1&pageSize=20&search=&status=all',
    );
  });
});

describe('decideApplication', () => {
  beforeEach(() => {
    vi.mocked(apiClient).mockReset();
  });

  it('PATCH applications/:id 로 승인 판정을 보낸다', async () => {
    const response = {
      applicationId: 'app-1',
      status: 'APPROVED' as const,
      repositoryProvisioning: {
        enabled: true,
        jobStatus: 'PENDING' as const,
        updatedAt: '2026-07-25T00:00:00.000Z',
        safeErrorClass: null,
      },
    };
    vi.mocked(apiClient).mockResolvedValue(response);

    await expect(
      decideApplication('app:1', { action: 'APPROVE' }),
    ).resolves.toEqual(response);
    expect(apiClient).toHaveBeenCalledWith(
      'applications/app%3A1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ action: 'APPROVE' }),
      }),
    );
  });

  it('반려 사유를 typed PATCH 본문으로 보낸다', async () => {
    vi.mocked(apiClient).mockResolvedValue({
      applicationId: 'app-1',
      status: 'REJECTED',
      rejectionReason: '사유',
    });

    await decideApplication('app-1', { action: 'REJECT', reason: '사유' });

    expect(apiClient).toHaveBeenCalledWith(
      'applications/app-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ action: 'REJECT', reason: '사유' }),
      }),
    );
  });
});
