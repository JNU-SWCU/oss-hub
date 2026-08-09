// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ProblemDetail } from '@/lib/api-client';
import { ProgramApplicationDetailPage } from './program-application-detail-page';
import type { ApplicationListItem } from './types';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

const { decideApplicationMock, getApplicationDetailMock } = vi.hoisted(() => ({
  decideApplicationMock: vi.fn(),
  getApplicationDetailMock: vi.fn(),
}));

vi.mock('./api', () => ({
  decideApplication: decideApplicationMock,
  getApplicationDetail: getApplicationDetailMock,
}));

const submitted: ApplicationListItem = {
  id: 'app-1',
  status: 'SUBMITTED',
  rejectionReason: null,
  repositoryProvisioning: {
    enabled: true,
    jobStatus: 'NOT_REQUESTED',
    updatedAt: '2026-08-05T05:32:00.000Z',
    safeErrorClass: null,
  },
  isRepositoryPublicationPlanned: true,
  repository: null,
  submittedAt: '2026-08-05T05:32:00.000Z',
  participation: 'TEAM',
  applicant: { id: 'student-1', name: '합성 학생', nickname: 'login-1' },
  team: { id: 'team-1', name: '합성 팀', memberCount: 3 },
  answers: {
    applicantName: '합성 학생',
    title: '합성 신청 제목',
    summary: '첫 줄 지원 동기\n\n둘째 문단 계획',
  },
};

const rejected: ApplicationListItem = {
  ...submitted,
  status: 'REJECTED',
  rejectionReason: '예산 항목이 비어 있습니다',
  repositoryProvisioning: {
    enabled: false,
    jobStatus: 'DISABLED',
    updatedAt: '2026-08-06T01:00:00.000Z',
    safeErrorClass: null,
  },
};

function problem(status: number, code: string): ProblemDetail {
  return {
    type: 'about:blank',
    title: 'error',
    status,
    detail: 'detail',
    instance: 'urn:test:applications:app-1',
    code,
  };
}

function getButton(name: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new TypeError(`Button not found: ${name}`);
  }
  return button;
}

function queryButton(name: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === name,
  ) as HTMLButtonElement | undefined;
}

describe('ProgramApplicationDetailPage', () => {
  let container: HTMLDivElement;
  let root: Root;

  async function mount(): Promise<void> {
    await act(async () => {
      root.render(
        <ProgramApplicationDetailPage
          programId="program-1"
          applicationId="app-1"
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    decideApplicationMock.mockReset();
    getApplicationDetailMock.mockReset();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('지원 내용을 그린다 — 이 화면이 없을 때 교직원이 못 보던 바로 그 값이다', async () => {
    getApplicationDetailMock.mockResolvedValue(submitted);

    await mount();

    expect(getApplicationDetailMock).toHaveBeenCalledWith('app-1');
    expect(container.textContent).toContain('합성 신청 제목');
    expect(container.textContent).toContain('첫 줄 지원 동기');
    expect(container.textContent).toContain('둘째 문단 계획');
  });

  it('여러 문단 지원 동기의 줄바꿈을 눌러 붙이지 않는다', async () => {
    getApplicationDetailMock.mockResolvedValue(submitted);

    await mount();

    const summary = Array.from(container.querySelectorAll('dd')).find((node) =>
      node.textContent?.includes('첫 줄 지원 동기'),
    );
    expect(summary?.className).toContain('whitespace-pre-wrap');
  });

  it('제출 시각을 서울 시각으로 적는다', async () => {
    getApplicationDetailMock.mockResolvedValue(submitted);

    await mount();

    // 2026-08-05T05:32Z = KST 오후 2:32. UTC 로 그리면 오전 5:32 가 되어 마감 판단이 어긋난다.
    expect(container.textContent).toContain('오후 02:32');
    expect(container.textContent).not.toContain('오전 05:32');
  });

  it('판정 대기 신청에는 승인·반려가 있고 되돌리기는 없다', async () => {
    getApplicationDetailMock.mockResolvedValue(submitted);

    await mount();

    expect(getButton('승인')).toBeTruthy();
    expect(getButton('반려')).toBeTruthy();
    expect(queryButton('되돌리기')).toBeUndefined();
  });

  it('판정된 신청에는 되돌리기만 있다', async () => {
    getApplicationDetailMock.mockResolvedValue(rejected);

    await mount();

    expect(getButton('되돌리기')).toBeTruthy();
    expect(queryButton('승인')).toBeUndefined();
    expect(queryButton('반려')).toBeUndefined();
  });

  it('반려된 신청은 사유를 보여준다', async () => {
    getApplicationDetailMock.mockResolvedValue(rejected);

    await mount();

    expect(container.textContent).toContain('반려 사유');
    expect(container.textContent).toContain('예산 항목이 비어 있습니다');
  });

  it('사유 없이 반려 확정을 누르면 저장하지 않고 안내한다', async () => {
    getApplicationDetailMock.mockResolvedValue(submitted);
    await mount();

    await act(async () => {
      getButton('반려').click();
    });
    await act(async () => {
      getButton('반려 확정').click();
    });

    expect(decideApplicationMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain('반려 사유를 입력해 주세요.');
  });

  it('반려 사유를 적으면 그 사유로 판정을 저장하고 다시 읽는다', async () => {
    getApplicationDetailMock.mockResolvedValueOnce(submitted);
    decideApplicationMock.mockResolvedValue({
      applicationId: 'app-1',
      status: 'REJECTED',
      rejectionReason: '예산 항목이 비어 있습니다',
    });
    getApplicationDetailMock.mockResolvedValueOnce(rejected);
    await mount();

    await act(async () => {
      getButton('반려').click();
    });
    const textarea = container.querySelector('textarea');
    if (!(textarea instanceof HTMLTextAreaElement)) {
      throw new TypeError('반려 사유 입력칸이 없다');
    }
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      setter?.call(textarea, '  예산 항목이 비어 있습니다  ');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      getButton('반려 확정').click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    // 앞뒤 공백은 떼고 보낸다 — 백엔드도 trim 후 필수 검사를 한다.
    expect(decideApplicationMock).toHaveBeenCalledWith('app-1', {
      action: 'REJECT',
      reason: '예산 항목이 비어 있습니다',
    });
    expect(getApplicationDetailMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('판정이 저장되었습니다');
  });

  it('다른 운영자가 먼저 판정한 409 는 최신 상태로 다시 그린다', async () => {
    getApplicationDetailMock.mockResolvedValueOnce(submitted);
    decideApplicationMock.mockRejectedValue(
      new ApiError(problem(409, 'APP_002')),
    );
    getApplicationDetailMock.mockResolvedValueOnce(rejected);
    await mount();

    await act(async () => {
      getButton('승인').click();
    });
    await act(async () => {
      getButton('승인 확정').click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain('신청 상태가 변경되었습니다');
    expect(container.textContent).toContain('예산 항목이 비어 있습니다');
    expect(queryButton('승인')).toBeUndefined();
  });

  it('학생이 먼저 취소해 사라진 신청은 "찾을 수 없음"으로 닫는다', async () => {
    getApplicationDetailMock.mockResolvedValueOnce(submitted);
    decideApplicationMock.mockRejectedValue(
      new ApiError(problem(404, 'APP_001')),
    );
    getApplicationDetailMock.mockRejectedValueOnce(
      new ApiError(problem(404, 'APP_001')),
    );
    await mount();

    await act(async () => {
      getButton('승인').click();
    });
    await act(async () => {
      getButton('승인 확정').click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    // 없는 신청을 계속 그리면 교직원이 같은 404 를 반복해 만난다.
    expect(container.textContent).toContain('신청을 찾을 수 없습니다');
  });

  it('없는 신청은 목록으로 돌아갈 길을 준다', async () => {
    getApplicationDetailMock.mockRejectedValue(
      new ApiError(problem(404, 'APP_001')),
    );

    await mount();

    expect(container.textContent).toContain('신청을 찾을 수 없습니다');
    const link = container.querySelector('a[href]');
    expect(link?.getAttribute('href')).toBe('/programs/program-1/applicants');
  });

  it('권한이 없으면 백엔드 문구를 그대로 보여준다', async () => {
    getApplicationDetailMock.mockRejectedValue(
      new ApiError({
        ...problem(403, 'APP_018'),
        detail: '승인된 교직원 또는 관리자만 조회할 수 있습니다.',
      }),
    );

    await mount();

    expect(container.textContent).toContain(
      '승인된 교직원 또는 관리자만 조회할 수 있습니다.',
    );
  });
});
