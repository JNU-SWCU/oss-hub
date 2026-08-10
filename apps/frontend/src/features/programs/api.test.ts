import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api-client';
import {
  createApplication,
  decideApplication,
  getApplicationDetail,
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

  it('카드 note·뷰어 신청 상태·교직원 집계 필드를 그대로 통과시킨다', async () => {
    // Given — 학생: 본인 지원 상태 note, 교직원: 지원 건수 집계 note
    const response = {
      items: [
        {
          id: 'program-1',
          name: '2026 동계 오픈소스 해커톤',
          organizer: '오픈소스활동지원',
          category: 'OSS_CONTEST',
          applicationStartAt: '2026-12-01T00:00:00.000Z',
          applicationEndAt: '2026-12-05T00:00:00.000Z',
          endAt: null,
          description: '설명',
          note: { text: '지원서 제출됨 · 교직원 승인을 기다립니다' },
          viewerApplicationStatus: 'SUBMITTED',
        },
        {
          id: 'program-2',
          name: '2026-2학기 오픈소스 SW 프로젝트',
          organizer: 'SW중심대학사업단',
          category: 'BASIC',
          applicationStartAt: '2026-09-01T00:00:00.000Z',
          applicationEndAt: '2026-09-08T00:00:00.000Z',
          endAt: '2026-12-19T00:00:00.000Z',
          description: '설명',
          note: { text: '지원 3건 · 승인 대기 1건', icon: 'team' },
          applicationCount: 3,
          pendingApplicationCount: 1,
        },
      ],
      page: 1,
      pageSize: 20,
      totalItems: 2,
      totalPages: 1,
    } satisfies ProgramListPage;
    vi.mocked(apiClient).mockResolvedValue(response);

    // When
    const result = await listPrograms({
      page: 1,
      pageSize: 20,
      search: '',
      status: 'all',
    });

    // Then
    expect(result).toEqual(response);
    expect(result.items[0]?.viewerApplicationStatus).toBe('SUBMITTED');
    expect(result.items[0]?.note?.text).toBe(
      '지원서 제출됨 · 교직원 승인을 기다립니다',
    );
    expect(result.items[1]?.note).toEqual({
      text: '지원 3건 · 승인 대기 1건',
      icon: 'team',
    });
    expect(result.items[1]?.applicationCount).toBe(3);
    expect(result.items[1]?.pendingApplicationCount).toBe(1);
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
      applicationTemplateVersion: 1,
      isRepositoryPublicationPlanned: true,
      repositoryConnectionMode: 'new',
      repositoryUrl: '',
    });

    expect(apiClient).toHaveBeenCalledWith(
      'programs/program-1/applications',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          answers: { title: '제목', summary: '요약' },
          applicationTemplateVersion: 1,
          isRepositoryPublicationPlanned: true,
          repositoryConnectionMode: 'NEW',
          repositoryUrl: null,
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
      applicationTemplateVersion: 1,
      isRepositoryPublicationPlanned: false,
      repositoryConnectionMode: 'new',
      repositoryUrl: 'https://github.com/ignored/when-new',
    });

    expect(apiClient).toHaveBeenCalledWith(
      'programs/program-1/applications',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          answers: { title: '제목', summary: '요약' },
          applicationTemplateVersion: 1,
          isRepositoryPublicationPlanned: false,
          repositoryConnectionMode: 'NEW',
          repositoryUrl: null,
        }),
      }),
    );
    expect(result).toEqual(response);
  });

  it('own 선택 시 OWN 과 trim 한 repositoryUrl 을 보낸다', async () => {
    const response = {
      id: 'app-3',
      programId: 'program-1',
      status: 'SUBMITTED' as const,
      teamId: null,
      submittedAt: '2026-07-15T00:00:00.000Z',
      isRepositoryPublicationPlanned: true,
    };
    vi.mocked(apiClient).mockResolvedValue(response);

    const result = await createApplication('program-1', {
      answers: { title: '제목', summary: '요약' },
      applicationTemplateVersion: 1,
      isRepositoryPublicationPlanned: true,
      repositoryConnectionMode: 'own',
      repositoryUrl: '  https://github.com/team/repo  ',
    });

    expect(apiClient).toHaveBeenCalledWith(
      'programs/program-1/applications',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          answers: { title: '제목', summary: '요약' },
          applicationTemplateVersion: 1,
          isRepositoryPublicationPlanned: true,
          repositoryConnectionMode: 'OWN',
          repositoryUrl: 'https://github.com/team/repo',
        }),
      }),
    );
    expect(result).toEqual(response);
  });

  it('저장소 발급이 꺼진 프로그램은 mode와 URL을 null로 보낸다', async () => {
    vi.mocked(apiClient).mockResolvedValue({ id: 'app-disabled' });

    await createApplication('program-1', {
      answers: { title: '제목', summary: '요약' },
      applicationTemplateVersion: 1,
      isRepositoryPublicationPlanned: false,
      repositoryConnectionMode: null,
      repositoryUrl: '',
    });

    expect(apiClient).toHaveBeenCalledWith(
      'programs/program-1/applications',
      expect.objectContaining({
        body: JSON.stringify({
          answers: { title: '제목', summary: '요약' },
          applicationTemplateVersion: 1,
          isRepositoryPublicationPlanned: false,
          repositoryConnectionMode: null,
          repositoryUrl: null,
        }),
      }),
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
  it('되돌리기 판정을 typed PATCH 본문으로 보낸다', async () => {
    vi.mocked(apiClient).mockResolvedValue({
      applicationId: 'app-1',
      status: 'SUBMITTED',
    });

    await decideApplication('app-1', { action: 'REVERT' });

    expect(apiClient).toHaveBeenCalledWith(
      'applications/app-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ action: 'REVERT' }),
      }),
    );
  });
});

describe('getApplicationDetail', () => {
  beforeEach(() => {
    vi.mocked(apiClient).mockReset();
  });

  it('신청 상세를 판정과 같은 자원 경로로 읽는다', async () => {
    // 상세 화면 테스트는 `./api` 를 통째로 mock 하므로, 경로가 바뀌어도 그쪽은
    // 전부 초록이다. 경로를 못박는 자리는 여기뿐이다.
    vi.mocked(apiClient).mockResolvedValue({ id: 'app-1' });

    await getApplicationDetail('app-1');

    expect(apiClient).toHaveBeenCalledWith('applications/app-1');
  });

  it('신청 id 를 URL 로 인코딩해 보낸다', async () => {
    vi.mocked(apiClient).mockResolvedValue({ id: 'app/1' });

    await getApplicationDetail('app/1');

    // 인코딩하지 않으면 `applications/app/1` 이 되어 다른 경로를 두드린다.
    expect(apiClient).toHaveBeenCalledWith('applications/app%2F1');
  });
});
