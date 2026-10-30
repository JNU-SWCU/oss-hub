import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProgramDetail } from '@/features/programs/catalog/dto';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const navigation = vi.hoisted(() => ({
  router: { back: vi.fn(), push: vi.fn(), replace: vi.fn() },
  searchParams: new URLSearchParams(),
}));
const remote = vi.hoisted(() => ({ detail: vi.fn(), overview: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => navigation.router,
  useSearchParams: () => navigation.searchParams,
}));
vi.mock('@/features/auth/use-session', () => ({
  useSession: () => ({ status: 'authenticated' }),
}));
vi.mock('@/features/programs/catalog/api', () => ({
  getProgramDetail: remote.detail,
  getPublicProgramDetail: remote.detail,
  getProgramActivity: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/features/programs/catalog/program-overview-api', () => ({
  getProgramOverview: remote.overview,
}));

vi.mock(
  '@/features/programs/documents/milestone-document-api',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@/features/programs/documents/milestone-document-api')
    >()),
    listMilestoneDocuments: vi.fn().mockResolvedValue({
      documents: [],
      fileUpload: {
        maxBytes: 1024,
        maxLabel: '1 KiB',
        accept: '.pdf',
        formatLabel: 'PDF',
      },
    }),
  }),
);

import { ProgramDetailScreen } from './program-detail-screen';

const program: ProgramDetail = {
  id: 'program:basic',
  name: '합성 프로그램',
  organizer: '합성 기관',
  trackType: 'EXTRACURRICULAR',
  applicationTemplateKey: 'basic',
  lifecycle: 'PUBLISHED',
  description: '합성 설명',
  repositoryProvisioningEnabled: false,
  applicationPeriod: {
    startsAt: '2026-07-01T00:00:00Z',
    endsAt: '2026-07-31T00:00:00Z',
  },
  viewer: { role: 'STUDENT', applicationStatus: 'APPROVED' },
  milestones: [
    {
      id: 'milestone-1',
      name: '합성 결과물',
      dueAt: '2028-01-01T00:00:00Z',
      dDay: 10,
      deadlineLabel: 'D-10',
      description: null,
      submissionType: 'FILE',
      submissionItemCount: 0,
      viewerSubmissionStatus: 'NOT_SUBMITTED',
      applicationSubmissionSummary: null,
    },
  ],
};

describe('ProgramDetailScreen의 실제 상세 화면', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    navigation.searchParams = new URLSearchParams();
    navigation.router.replace.mockReset();
    remote.detail.mockResolvedValue(program);
    remote.overview.mockResolvedValue(null);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function renderScreen() {
    await act(async () => {
      root.render(<ProgramDetailScreen programId={program.id} />);
    });
  }

  it('기존 submission 쿼리는 상세 화면을 다른 경로로 이동시키지 않는다', async () => {
    navigation.searchParams = new URLSearchParams(
      'submission=milestone-1&tab=overview',
    );
    await renderScreen();
    expect(navigation.router.replace).not.toHaveBeenCalled();
    expect(container.querySelector('#milestones')?.textContent).toContain(
      '합성 결과물',
    );
  });

  it('실제 마일스톤과 제출 링크를 그리고 별도 체크리스트를 붙이지 않는다', async () => {
    await renderScreen();
    expect(container.querySelector('#milestones')?.textContent).toContain(
      '합성 결과물',
    );
    expect(
      container.querySelector(
        'a[href="/programs/program%3Abasic/documents?milestoneId=milestone-1"]',
      ),
    ).not.toBeNull();
    expect(container.querySelector('[data-testid="checklist"]')).toBeNull();
    expect(navigation.router.replace).not.toHaveBeenCalled();
  });
});
