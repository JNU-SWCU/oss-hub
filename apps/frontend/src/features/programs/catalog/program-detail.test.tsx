import { notifyManager, QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient } from '../../../../test-support/render-with-query';
import { renderToStaticMarkup as renderMarkup } from 'react-dom/server';
function renderToStaticMarkup(element: React.ReactNode) {
  return renderMarkup(
    <QueryClientProvider client={queryClient}>{element}</QueryClientProvider>,
  );
}
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const queryClient = createTestQueryClient();
beforeEach(() => {
  queryClient.clear();
  notifyManager.setScheduler(queueMicrotask);
});
afterEach(() => {
  queryClient.clear();
  notifyManager.setScheduler((callback) => setTimeout(callback, 0));
});
import { requirementUploadPolicy } from '../../../../test-support/requirement-upload-policy';
import { ApiError } from '@/lib/api-client';
import { RequirementSectionBody } from '../documents/requirement-list';
import type { Requirement } from '../documents/requirement-dto';
import { milestoneSubmissionAccess } from '../documents/milestone-submission-access';
import {
  detailFailure,
  ProgramActions,
  ProgramDetailReadyState,
  ProgramDetailFailureState,
  ProgramMilestones,
} from './program-detail-page';
import { PROGRAM_END_AT_UNDECIDED } from '../authoring/program-end-at';
import { getProgramListBadge } from './program-list';
import type { ApplicationStatus, ViewerRole } from '../program-contract';
import type { ProgramDetail, ProgramListItem, ProgramMilestone } from './dto';

function stubSignInApply(applyHref: string) {
  return (
    <a href="/stub-sign-in" data-apply-href={applyHref}>
      신청하기
    </a>
  );
}

function access(
  role: ViewerRole,
  applicationStatus: ApplicationStatus | null = null,
) {
  return milestoneSubmissionAccess({ role, applicationStatus });
}

const milestone: ProgramMilestone = {
  id: 'milestone-1',
  name: '기획서 제출',
  dueAt: '2026-08-10T23:59:59+09:00',
  dDay: 5,
  description: 'PDF 기획서를 제출해 주세요.',
  submissionItemCount: 1,
  viewerSubmissionStatus: 'REJECTED',
  applicationSubmissionSummary: null,
};

const programWithoutMilestones: ProgramDetail = {
  id: 'program-1',
  name: 'OSS 경진대회',
  organizers: ['운영기관'],
  trackType: 'EXTRACURRICULAR',
  applicationTemplateKey: 'oss-contest',
  description: '프로그램 설명',
  repositoryProvisioningEnabled: true,
  applicationPeriod: {
    startsAt: '2026-07-01T00:00:00+09:00',
    endsAt: '2026-08-31T23:59:59+09:00',
  },
  viewer: { role: 'STAFF', applicationStatus: null },
  milestones: [],
};

describe('ProgramDetailPage states', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-15T12:00:00+09:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('승인된 학생에게 마일스톤 목록을 그린다', () => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <ProgramDetailReadyState
          renderSignInApply={stubSignInApply}
          program={{
            ...programWithoutMilestones,
            viewer: { role: 'STUDENT', applicationStatus: 'APPROVED' },
            milestones: [milestone],
          }}
        />
      </QueryClientProvider>,
    );

    expect(html).toContain('id="milestones"');
    expect(html).toContain('기획서 제출');
    expect(html).not.toContain('체크리스트 불러오는 중');
  });

  it('renders the activity anchor used by the staff dashboard direct link', () => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <ProgramDetailReadyState
          renderSignInApply={stubSignInApply}
          program={programWithoutMilestones}
        />
      </QueryClientProvider>,
    );
    expect(html).toContain('id="activity"');
    expect(html).toContain('aria-label="활동 상세"');
  });

  it('제목 줄에 모집 배지가 붙고, 주관기관·유형은 헤더 설명 줄에, 신청 기간은 요약 카드에 한 번만 표시된다', () => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <ProgramDetailReadyState
          renderSignInApply={stubSignInApply}
          program={programWithoutMilestones}
        />
      </QueryClientProvider>,
    );

    const titleSlot = html.match(
      /<h1 data-slot="page-header-title"[^>]*>(.*?)<\/h1>/,
    )?.[1];
    expect(titleSlot).toBeDefined();
    expect(titleSlot).toContain('OSS 경진대회');
    expect(titleSlot).toContain('모집중');

    const description = html.match(
      /<p data-slot="page-header-description"[^>]*>(.*?)<\/p>/,
    )?.[1];
    expect(description).toBe('운영기관 · 비교과');
    expect(html.split('신청 기간')).toHaveLength(2);
    expect(html).toContain('2026.07.01 ~ 08.31');
    expect(html.match(/data-slot="program-summary"/g)).toHaveLength(1);
  });

  it.each([
    { endsAt: '2026-10-31T09:00:00.000Z', expected: '2026.09.01 ~ 10.31' },
    { endsAt: PROGRAM_END_AT_UNDECIDED, expected: '2026.09.01 ~ 미정' },
  ])(
    '요약 카드에 신청 기간과 구분한 운영 기간을 서울 날짜로 표시한다: $expected',
    ({ endsAt, expected }) => {
      const html = renderToStaticMarkup(
        <QueryClientProvider client={queryClient}>
          <ProgramDetailReadyState
            renderSignInApply={stubSignInApply}
            program={{
              ...programWithoutMilestones,
              operatingPeriod: {
                startsAt: '2026-09-01T00:00:00.000Z',
                endsAt,
              },
            }}
          />
        </QueryClientProvider>,
      );

      expect(html).toContain('2026.07.01 ~ 08.31');
      expect(html.split('운영 기간')).toHaveLength(2);
      expect(html).toContain(expected);
      expect(html).not.toContain('9999');
    },
  );

  it.each(['STAFF'] as const)(
    '%s에게 제목 줄의 버튼 묶음 하나에 편집·일반 메일·마감 알림 입구만 노출한다',
    (role) => {
      const html = renderToStaticMarkup(
        <QueryClientProvider client={queryClient}>
          <ProgramDetailReadyState
            renderSignInApply={stubSignInApply}
            program={{
              ...programWithoutMilestones,
              viewer: { role, applicationStatus: null },
            }}
          />
        </QueryClientProvider>,
      );
      const groups = [
        ...html.matchAll(
          /<div data-slot="page-header-actions"[^>]*>(.*?)<\/div>/g,
        ),
      ];
      expect(groups).toHaveLength(1);
      const group = groups[0]?.[1] ?? '';
      expect(group).toContain('href="/programs/program-1/edit"');

      expect(group).toContain('편집');
      expect(group).toContain('lucide-pencil');
      expect(group).toContain('메일 보내기');
      expect(group).toContain('lucide-mail');
      expect(group).toContain('마감 알림 보내기');
      expect(group).toContain('lucide-bell-ring');
      expect(group).not.toContain('/notifications');
      expect(html).not.toContain('신청자 목록');
      expect(html).not.toContain('/programs/program-1/applicants');
      expect(html).not.toContain('/programs/program-1/submissions');
      expect(html).not.toContain('전체 제출 현황');
    },
  );

  it.each([
    {
      role: 'STUDENT' as const,
      applicationStatus: null,
    },
    { role: null, applicationStatus: null },
    { role: 'ADMIN' as const, applicationStatus: null },
  ])(
    '$role 에게는 프로그램 편집 입구를 숨긴다',
    ({ role, applicationStatus }) => {
      const html = renderToStaticMarkup(
        <QueryClientProvider client={queryClient}>
          <ProgramDetailReadyState
            renderSignInApply={stubSignInApply}
            program={{
              ...programWithoutMilestones,
              viewer: { role, applicationStatus },
            }}
          />
        </QueryClientProvider>,
      );

      expect(html).not.toContain('/edit"');
      expect(html).not.toContain('/notifications"');
    },
  );

  it.each([
    { role: 'STUDENT' as const, applicationStatus: 'APPROVED' as const },
    { role: 'STUDENT' as const, applicationStatus: 'SUBMITTED' as const },
    { role: 'ADMIN' as const, applicationStatus: null },
  ])(
    '누를 버튼이 없는 $role($applicationStatus)에게는 빈 버튼 묶음을 남기지 않는다',
    (viewer) => {
      const html = renderToStaticMarkup(
        <QueryClientProvider client={queryClient}>
          <ProgramDetailReadyState
            renderSignInApply={stubSignInApply}
            program={{ ...programWithoutMilestones, viewer }}
          />
        </QueryClientProvider>,
      );

      expect(html).not.toContain('page-header-actions');
    },
  );

  it.each([
    { role: 'STUDENT' as const, href: '/programs/program-1/apply' },
    { role: null, href: '/stub-sign-in' },
  ])(
    '신청 전 $role 의 신청 입구는 같은 버튼 묶음 자리에 하나만 둔다',
    ({ role, href }) => {
      const html = renderToStaticMarkup(
        <QueryClientProvider client={queryClient}>
          <ProgramDetailReadyState
            renderSignInApply={stubSignInApply}
            program={{
              ...programWithoutMilestones,
              viewer: { role, applicationStatus: null },
            }}
          />
        </QueryClientProvider>,
      );

      const groups = [
        ...html.matchAll(
          /<div data-slot="page-header-actions"[^>]*>(.*?)<\/div>/g,
        ),
      ];
      expect(groups).toHaveLength(1);
      expect(groups[0]?.[1]).toContain(`href="${href}"`);
      expect(groups[0]?.[1]).toContain('신청하기');
    },
  );

  it('신청 전 학생에게 신청하기 CTA를 노출한다', () => {
    const html = renderToStaticMarkup(
      <ProgramActions
        renderSignInApply={stubSignInApply}
        program={{
          ...programWithoutMilestones,
          viewer: { role: 'STUDENT', applicationStatus: null },
        }}
      />,
    );
    expect(html).toContain('신청하기');
    expect(html).toContain('/programs/program-1/apply');
    expect(html).not.toContain('신청자 목록');
  });

  it('역할 없는 사람의 신청 입구는 주입된 로그인 입구에 신청 경로를 넘겨 그린다', () => {
    const html = renderToStaticMarkup(
      <ProgramActions
        renderSignInApply={(applyHref) => (
          <a href="/injected" data-apply-href={applyHref}>
            신청하기
          </a>
        )}
        program={{
          ...programWithoutMilestones,
          viewer: { role: null, applicationStatus: null },
        }}
      />,
    );

    expect(html).toContain('신청하기');
    expect(html).toContain('href="/injected"');
    expect(html).toContain('data-apply-href="/programs/program-1/apply"');
    expect(html).not.toContain('/signup');
    expect(html).not.toContain('로그인');
    expect(html).not.toContain('href="/"');
  });

  describe('종료된 프로그램 상세', () => {
    const studentViewer = {
      role: 'STUDENT',
      applicationStatus: null,
    } as const satisfies ProgramDetail['viewer'];

    const dateEnded: ProgramDetail = {
      ...programWithoutMilestones,
      operatingPeriod: {
        startsAt: '2026-06-01T00:00:00+09:00',
        endsAt: '2026-08-10T23:59:59+09:00',
      },
      viewer: studentViewer,
    };
    const live: ProgramDetail = {
      ...programWithoutMilestones,
      operatingPeriod: {
        startsAt: '2026-06-01T00:00:00+09:00',
        endsAt: '2026-12-31T23:59:59+09:00',
      },
      viewer: studentViewer,
    };

    const endedCases = [{ kind: '종료일이 지난 프로그램', program: dateEnded }];

    function titleSlotOf(program: ProgramDetail): string {
      const html = renderToStaticMarkup(
        <QueryClientProvider client={queryClient}>
          <ProgramDetailReadyState
            renderSignInApply={stubSignInApply}
            program={program}
          />
        </QueryClientProvider>,
      );
      return (
        html.match(/<h1 data-slot="page-header-title"[^>]*>(.*?)<\/h1>/)?.[1] ??
        ''
      );
    }

    function asListItem(program: ProgramDetail): ProgramListItem {
      return {
        id: program.id,
        name: program.name,
        organizers: program.organizers,
        trackType: program.trackType,
        applicationStartAt: program.applicationPeriod.startsAt,
        applicationEndAt: program.applicationPeriod.endsAt,
        endAt: program.operatingPeriod?.endsAt ?? null,
      };
    }

    it.each(endedCases)(
      '$kind 은 신청 기간이 열려 있어도 「모집중」이 아니라 「종료」로 표시한다',
      ({ program }) => {
        const titleSlot = titleSlotOf(program);

        expect(titleSlot).toContain('종료');
        expect(titleSlot).not.toContain('모집중');
      },
    );

    it.each(endedCases)(
      '$kind 은 목록에서 볼 때와 상세에서 볼 때 상태 표시가 같다',
      ({ program }) => {
        const listLabel = getProgramListBadge(
          asListItem(program),
          new Date(),
        ).label;

        expect(listLabel).toBe('종료');
        expect(titleSlotOf(program)).toContain(listLabel);
      },
    );

    const anonymous: ProgramDetail = {
      ...live,
      viewer: { role: null, applicationStatus: null },
    };

    it.each(
      endedCases.flatMap(({ kind, program }) =>
        [
          { viewer: '학생', role: 'STUDENT' as const, label: '신청하기' },
          { viewer: '비로그인', role: null, label: '신청하기' },
        ].map((entry) => ({ ...entry, kind, program })),
      ),
    )(
      '$kind 의 $viewer 신청 입구를 이유와 함께 비활성으로 그린다',
      ({ program, role, label }) => {
        const html = renderToStaticMarkup(
          <ProgramActions
            renderSignInApply={stubSignInApply}
            program={{
              ...program,
              viewer: { role, applicationStatus: null },
            }}
          />,
        );

        expect(html).toContain(label);
        expect(html).toContain('disabled=""');
        expect(html).toContain('종료된 프로그램이라 신청을 받지 않습니다.');

        expect(html).toContain('aria-describedby=');
        expect(html).not.toContain('href="/stub-sign-in"');
        expect(html).not.toContain('href="/programs/program-1/apply"');
      },
    );

    it('게시 중이고 아직 안 끝난 프로그램의 비로그인 신청 입구는 주입된 로그인 입구로 연다', () => {
      const actions = renderToStaticMarkup(
        <ProgramActions
          renderSignInApply={stubSignInApply}
          program={anonymous}
        />,
      );

      expect(actions).toContain('href="/stub-sign-in"');
      expect(actions).toContain('data-apply-href="/programs/program-1/apply"');
      expect(actions).not.toContain('disabled=""');
    });

    it('게시 중이고 아직 안 끝난 프로그램은 지금과 똑같이 신청 입구를 연다', () => {
      const actions = renderToStaticMarkup(
        <ProgramActions renderSignInApply={stubSignInApply} program={live} />,
      );

      expect(titleSlotOf(live)).toContain('모집중');
      expect(actions).toContain('href="/programs/program-1/apply"');
      expect(actions).not.toContain(
        '종료된 프로그램이라 신청을 받지 않습니다.',
      );
      expect(actions).not.toContain('disabled=""');
    });

    it('운영 기간이 없는 응답은 종료로 접지 않는다', () => {
      const withoutOperatingPeriod: ProgramDetail = {
        ...programWithoutMilestones,
        viewer: studentViewer,
      };

      expect(titleSlotOf(withoutOperatingPeriod)).toContain('모집중');
      expect(
        renderToStaticMarkup(
          <ProgramActions
            renderSignInApply={stubSignInApply}
            program={withoutOperatingPeriod}
          />,
        ),
      ).toContain('href="/programs/program-1/apply"');
    });
  });

  it('마일스톤이 없으면 빈 상태와 교직원 설정 진입을 표시한다', () => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <ProgramMilestones program={programWithoutMilestones} />
      </QueryClientProvider>,
    );
    expect(html).toContain('아직 등록된 마일스톤이 없습니다');
    expect(html).toContain('/programs/program-1/edit#milestones');
  });

  it('404와 일반 실패를 구분하고 일반 실패에는 재시도를 제공한다', () => {
    const notFound = detailFailure(
      new ApiError({
        type: 'about:blank',
        title: 'Not Found',
        status: 404,
        detail: '없음',
        instance: '/programs/program-1',
        code: 'PROGRAM_NOT_FOUND',
      }),
    );
    expect(notFound).toEqual({ kind: 'not-found' });
    expect(detailFailure(new Error('network'))).toEqual({ kind: 'failed' });

    const notFoundHtml = renderToStaticMarkup(
      <ProgramDetailFailureState kind="not-found" onRetry={vi.fn()} />,
    );
    const failedHtml = renderToStaticMarkup(
      <ProgramDetailFailureState kind="failed" onRetry={vi.fn()} />,
    );
    expect(notFoundHtml).toContain('프로그램을 찾을 수 없습니다');
    expect(failedHtml).toContain('프로그램을 불러오지 못했습니다');
    expect(failedHtml).toContain('다시 시도');
  });
});

function buildDocument(overrides: Partial<Requirement> = {}): Requirement {
  return {
    id: 'document-1',
    milestoneId: 'milestone-1',
    name: '기획서',
    required: true,
    sortOrder: 0,
    submissionType: 'FILE_OR_TEXT' as const,
    hasTemplateFile: false,
    templateFileName: null,

    ...overrides,
  };
}

describe('RequirementSectionBody', () => {
  it('로딩 중에는 아무것도 그리지 않는다', () => {
    const html = renderToStaticMarkup(
      <RequirementSectionBody
        programId="program-1"
        onSubmitted={vi.fn()}
        state={{ kind: 'loading' }}
        viewerRole="STUDENT"
        closed={false}
        submissionAccess={access('STUDENT', 'APPROVED')}
        conflictNotice={null}
        onRetry={vi.fn()}
        onDocumentChange={vi.fn()}
        onSubmitConflict={vi.fn()}
      />,
    );
    expect(html).toBe('');
  });

  it('조회 실패 시 재시도 버튼을 보여준다', () => {
    const html = renderToStaticMarkup(
      <RequirementSectionBody
        programId="program-1"
        onSubmitted={vi.fn()}
        state={{ kind: 'failed' }}
        viewerRole="STUDENT"
        closed={false}
        submissionAccess={access('STUDENT', 'APPROVED')}
        conflictNotice={null}
        onRetry={vi.fn()}
        onDocumentChange={vi.fn()}
        onSubmitConflict={vi.fn()}
      />,
    );
    expect(html).toContain('제출 항목을 불러오지 못했습니다');
    expect(html).toContain('다시 시도');
  });

  it('서류가 없으면 아무것도 그리지 않는다', () => {
    const html = renderToStaticMarkup(
      <RequirementSectionBody
        programId="program-1"
        onSubmitted={vi.fn()}
        state={{
          kind: 'ready',
          documents: [],
          fileUpload: requirementUploadPolicy(),
        }}
        viewerRole="STUDENT"
        closed={false}
        submissionAccess={access('STUDENT', 'APPROVED')}
        conflictNotice={null}
        onRetry={vi.fn()}
        onDocumentChange={vi.fn()}
        onSubmitConflict={vi.fn()}
      />,
    );
    expect(html).toBe('');
  });

  it('교직원에게는 항목별 제출 수를 보이고 양식 관리 컨트롤은 노출하지 않는다', () => {
    const html = renderToStaticMarkup(
      <RequirementSectionBody
        programId="program-1"
        onSubmitted={vi.fn()}
        state={{
          kind: 'ready',
          documents: [
            buildDocument({
              submissionType: 'FILE_OR_TEXT' as const,
              hasTemplateFile: true,
              templateFileName: null,

              teamSubmissionCount: { submitted: 2, total: 4 },
            }),
            buildDocument({
              id: 'document-2',
              name: '결과보고서',
              teamSubmissionCount: { submitted: 4, total: 4 },
            }),
          ],
          fileUpload: requirementUploadPolicy(),
        }}
        viewerRole="STAFF"
        closed={false}
        submissionAccess={access('STAFF')}
        conflictNotice={null}
        onRetry={vi.fn()}
        onDocumentChange={vi.fn()}
        onSubmitConflict={vi.fn()}
      />,
    );
    const text = html.replace(/<[^>]+>/g, '');
    expect(text).toContain('기획서*제출 2/4');
    expect(text).toContain('결과보고서*제출 4/4');
    expect(text).not.toContain('팀');
    expect(html).not.toContain('양식 올리기');
    expect(html).not.toContain('양식 교체');
    expect(html).not.toContain('type="file"');
  });

  it('교직원 머리줄에는 넘겨받은 제출 현황을 한 번 적는다', () => {
    const html = renderToStaticMarkup(
      <RequirementSectionBody
        programId="program-1"
        onSubmitted={vi.fn()}
        state={{
          kind: 'ready',
          documents: [
            buildDocument({ teamSubmissionCount: { submitted: 2, total: 4 } }),
          ],
          fileUpload: requirementUploadPolicy(),
        }}
        viewerRole="STAFF"
        closed={false}
        submissionAccess={access('STAFF')}
        summary="미제출 2 · 승인 1 · 보완 1 · 반려 0"
        conflictNotice={null}
        onRetry={vi.fn()}
        onDocumentChange={vi.fn()}
        onSubmitConflict={vi.fn()}
      />,
    );

    const text = html.replace(/<[^>]+>/g, '');
    expect(text.split('미제출 2 · 승인 1 · 보완 1 · 반려 0')).toHaveLength(2);
    expect(text).toContain('제출 항목미제출 2 · 승인 1 · 보완 1 · 반려 0');
  });

  it('항목이 하나뿐이면 마일스톤 줄의 제출 수를 항목에서 되풀이하지 않는다', () => {
    const html = renderToStaticMarkup(
      <RequirementSectionBody
        programId="program-1"
        onSubmitted={vi.fn()}
        state={{
          kind: 'ready',
          documents: [
            buildDocument({ teamSubmissionCount: { submitted: 2, total: 4 } }),
          ],
          fileUpload: requirementUploadPolicy(),
        }}
        viewerRole="STAFF"
        closed={false}
        submissionAccess={access('STAFF')}
        conflictNotice={null}
        onRetry={vi.fn()}
        onDocumentChange={vi.fn()}
        onSubmitConflict={vi.fn()}
      />,
    );

    expect(html).toContain('기획서');
    expect(html.replace(/<[^>]+>/g, '')).not.toContain('2/4');
  });

  it('낼 팀이 없으면 항목마다 0/0을 적지 않고 참여 팀이 없다고 한 번만 적는다', () => {
    const html = renderToStaticMarkup(
      <RequirementSectionBody
        programId="program-1"
        onSubmitted={vi.fn()}
        state={{
          kind: 'ready',
          documents: [
            buildDocument({ teamSubmissionCount: { submitted: 0, total: 0 } }),
            buildDocument({
              id: 'document-2',
              name: '결과보고서',
              teamSubmissionCount: { submitted: 0, total: 0 },
            }),
          ],
          fileUpload: requirementUploadPolicy(),
        }}
        viewerRole="STAFF"
        closed={false}
        submissionAccess={access('STAFF')}
        summary="미제출 0 · 승인 0 · 보완 0 · 반려 0"
        conflictNotice={null}
        onRetry={vi.fn()}
        onDocumentChange={vi.fn()}
        onSubmitConflict={vi.fn()}
      />,
    );

    const text = html.replace(/<[^>]+>/g, '');
    expect(text).not.toContain('0/0');
    expect(text).not.toContain('미제출 0');
    expect(text.split('승인된 참여 팀이 없습니다.')).toHaveLength(2);
  });

  it('학생에게는 기존 양식 다운로드를 유지한다', () => {
    const html = renderToStaticMarkup(
      <RequirementSectionBody
        programId="program-1"
        onSubmitted={vi.fn()}
        state={{
          kind: 'ready',
          documents: [buildDocument({ hasTemplateFile: true })],
          fileUpload: requirementUploadPolicy(),
        }}
        viewerRole="STUDENT"
        closed={false}
        submissionAccess={access('STUDENT', 'APPROVED')}
        conflictNotice={null}
        onRetry={vi.fn()}
        onDocumentChange={vi.fn()}
        onSubmitConflict={vi.fn()}
      />,
    );

    expect(html).toContain('양식');
    expect(html).toContain('target="_blank"');
  });

  it('학생에게는 검토 대기 상태와 제출 시각, 교체 버튼을 보여준다', () => {
    const html = renderToStaticMarkup(
      <RequirementSectionBody
        programId="program-1"
        onSubmitted={vi.fn()}
        state={{
          kind: 'ready',
          documents: [
            buildDocument({
              viewerSubmission: {
                submitted: true,
                submittedAt: '2026-08-01T05:22:00.000Z',
                revision: 1,
                status: 'SUBMITTED',
                hasCurrentFile: false,
                currentFileName: null,
                review: null,
                history: { hasHistory: true, isComplete: true },
              },
            }),
          ],
          fileUpload: requirementUploadPolicy(),
        }}
        viewerRole="STUDENT"
        closed={false}
        submissionAccess={access('STUDENT', 'APPROVED')}
        conflictNotice={null}
        onRetry={vi.fn()}
        onDocumentChange={vi.fn()}
        onSubmitConflict={vi.fn()}
      />,
    );
    const text = html.replace(/<[^>]+>/g, '');
    expect(text).toContain('검토 대기');
    expect(text).toContain('08.01 14:22 제출');
    expect(text).toContain('교체');
    expect(text).toContain('제출 1/1');
  });

  it('미제출 학생에게는 미제출 상태와 올리기 버튼을 보여준다', () => {
    const html = renderToStaticMarkup(
      <RequirementSectionBody
        programId="program-1"
        onSubmitted={vi.fn()}
        state={{
          kind: 'ready',
          documents: [buildDocument()],
          fileUpload: requirementUploadPolicy(),
        }}
        viewerRole="STUDENT"
        closed={false}
        submissionAccess={access('STUDENT', 'APPROVED')}
        conflictNotice={null}
        onRetry={vi.fn()}
        onDocumentChange={vi.fn()}
        onSubmitConflict={vi.fn()}
      />,
    );
    expect(html).toContain('미제출');
    expect(html).toContain('올리기');
    expect(html.replace(/<[^>]+>/g, '')).toContain('제출 0/1');
  });
});
