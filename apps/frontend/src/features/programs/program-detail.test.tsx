import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityPanelBody } from './components/activity-graph-panel';
import { MilestoneRow } from './components/milestone-row';
import { ApiError } from '@/lib/api-client';
import { MilestoneDocumentSectionBody } from './milestone-document-list';
import type { MilestoneDocument } from './milestone-document-api';
import {
  detailFailure,
  ProgramActions,
  ProgramDetailReadyState,
  ProgramDetailFailureState,
  ProgramMilestones,
} from './program-detail-page';
import { ProgramFactBar } from './program-detail-view';
import type { ProgramOverview } from './program-overview-api';
import type { ProgramDetail, ProgramMilestone } from './types';

const milestone: ProgramMilestone = {
  id: 'milestone-1',
  name: '기획서 제출',
  dueAt: '2026-08-10T23:59:59+09:00',
  dDay: 5,
  deadlineLabel: 'D-5',
  description: 'PDF 기획서를 제출해 주세요.',
  submissionType: 'FILE',
  submissionItemCount: 0,
  viewerSubmissionStatus: 'REJECTED',
  applicationSubmissionSummary: null,
};

describe('MilestoneRow', () => {
  it('역할 없는 사람에게 비공개 제출 상태 대신 가입 안내를 표시한다', () => {
    const html = renderToStaticMarkup(
      <MilestoneRow
        programId="program-1"
        milestone={{ ...milestone, viewerSubmissionStatus: null }}
        viewerRole={null}
        applicationStatus={null}
      />,
    );
    expect(html).toContain('기획서 제출');
    expect(html).toContain('D-5');
    expect(html).toContain('가입 후 확인');
    // 이 갈래에는 GitHub만 연결하고 프로필을 못 채운 사람도 들어오므로, 이미 로그인한
    // 그에게 거짓이 되는 "로그인" 안내가 되살아나지 않게 못 박는다.
    expect(html).not.toContain('로그인');
    expect(html).not.toContain('최종 반려');
  });

  it('학생에게 반려 상태를 색뿐 아니라 텍스트로 표시한다', () => {
    const html = renderToStaticMarkup(
      <MilestoneRow
        programId="program-1"
        milestone={milestone}
        viewerRole="STUDENT"
        applicationStatus="APPROVED"
      />,
    );
    expect(html).toContain('최종 반려');
  });

  it('신규 제출 항목 모델은 작동하지 않는 레거시 제출 버튼을 노출하지 않는다', () => {
    const html = renderToStaticMarkup(
      <MilestoneRow
        programId="program-1"
        milestone={{
          ...milestone,
          submissionType: null,
          submissionItemCount: 2,
          viewerSubmissionStatus: null,
        }}
        viewerRole="STUDENT"
        applicationStatus="APPROVED"
      />,
    );

    expect(html).toContain('아래 제출 항목에서 내용이나 파일을 제출하세요');
    expect(html).not.toContain('제출하기');
    expect(html).not.toContain('/documents?milestoneId=');
  });

  it('제출 항목이 없는 신규 마일스톤은 승인이 아니라 안내용으로 표시한다', () => {
    const html = renderToStaticMarkup(
      <MilestoneRow
        programId="program-1"
        milestone={{
          ...milestone,
          submissionType: null,
          submissionItemCount: 0,
          viewerSubmissionStatus: null,
        }}
        viewerRole="STUDENT"
        applicationStatus="APPROVED"
      />,
    );

    expect(html).toContain('제출 없음 · 안내용');
    expect(html).not.toContain('승인');
    expect(html).not.toContain('제출하기');
  });

  it('신청 승인 전에는 실행할 수 없는 제출 안내를 노출하지 않는다', () => {
    const html = renderToStaticMarkup(
      <MilestoneRow
        programId="program-1"
        milestone={{
          ...milestone,
          submissionType: null,
          submissionItemCount: 2,
          viewerSubmissionStatus: null,
        }}
        viewerRole="STUDENT"
        applicationStatus="SUBMITTED"
      />,
    );

    expect(html).toContain('신청 승인 후 제출할 수 있습니다');
    expect(html).not.toContain('아래 제출 항목에서 내용이나 파일을 제출하세요');
  });

  it('마감 후 보완 요청도 #116 체크리스트에서 다시 제출할 수 있다', () => {
    const html = renderToStaticMarkup(
      <MilestoneRow
        programId="program-1"
        milestone={{
          ...milestone,
          dDay: -2,
          deadlineLabel: '마감 지남',
          viewerSubmissionStatus: 'CHANGES_REQUESTED',
        }}
        viewerRole="STUDENT"
        applicationStatus="APPROVED"
      />,
    );
    expect(html).toContain('다시 제출');
    expect(html).toContain(
      '/programs/program-1/documents?milestoneId=milestone-1',
    );
    expect(html).not.toContain('/milestones/milestone-1/submit');
  });
  it('교직원에게 제출 요약은 표시하되 미구현 #124 경로는 노출하지 않는다', () => {
    const html = renderToStaticMarkup(
      <MilestoneRow
        programId="program-1"
        milestone={{
          ...milestone,
          viewerSubmissionStatus: null,
          applicationSubmissionSummary: {
            notSubmitted: 2,
            submitted: 1,
            approved: 1,
            changesRequested: 1,
            rejected: 0,
            total: 5,
          },
        }}
        viewerRole="STAFF"
        applicationStatus={null}
      />,
    );
    expect(html).toContain('3/5');
    expect(html).not.toContain('전체 현황');
    expect(html).not.toContain('/programs/program-1/submissions');
  });
});

describe('ActivityPanelBody', () => {
  it('저장소 없음과 부분 실패를 독립 상태로 표시한다', () => {
    const empty = renderToStaticMarkup(
      <ActivityPanelBody
        state={{ kind: 'ready', activities: [] }}
        onRetry={vi.fn()}
      />,
    );
    const failed = renderToStaticMarkup(
      <ActivityPanelBody state={{ kind: 'failed' }} onRetry={vi.fn()} />,
    );
    expect(empty).toContain('아직 연결된 저장소가 없습니다');
    expect(failed).toContain('활동을 불러오지 못했습니다');
    expect(failed).toContain('프로그램 정보는 정상적으로 표시');
  });

  it('canonical 커밋·PR·릴리스와 데이터 기준 시각을 모두 표시한다', () => {
    const html = renderToStaticMarkup(
      <ActivityPanelBody
        state={{
          kind: 'ready',
          activities: [
            {
              applicationId: 'application-1',
              label: '학생',
              commitCount: 2,
              pullRequestCount: 3,
              releaseCount: 4,
              lastActivityAt: '2026-07-23T00:00:00.000Z',
              dataAsOf: '2026-07-24T00:00:00.000Z',
            },
          ],
        }}
        onRetry={vi.fn()}
      />,
    );

    expect(html).toContain('커밋</dt><dd>2');
    expect(html).toContain('PR</dt><dd>3');
    expect(html).toContain('릴리스</dt><dd>4');
    expect(html).toContain('데이터 기준');
    expect(html).not.toContain('star');
  });

  it('활성 generation이 없는 저장소에 안전한 빈 활동 문구를 표시한다', () => {
    const html = renderToStaticMarkup(
      <ActivityPanelBody
        state={{
          kind: 'ready',
          activities: [
            {
              applicationId: 'application-1',
              label: '학생',
              commitCount: 0,
              pullRequestCount: 0,
              releaseCount: 0,
              lastActivityAt: null,
              dataAsOf: null,
            },
          ],
        }}
        onRetry={vi.fn()}
      />,
    );

    expect(html).toContain('아직 수집된 활동이 없습니다');
    expect(html).toContain('아직 게시된 활동 데이터가 없습니다');
  });
});

const programWithoutMilestones: ProgramDetail = {
  id: 'program-1',
  name: 'OSS 경진대회',
  organizer: '운영기관',
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

  // 승인된 학생 전용 체크리스트로 마일스톤 섹션을 통째로 갈아 끼우던 이전 분기는
  // milestone documents API 기반 인라인 서류 제출로 대체됐다 — approvedStudentMilestones가
  // 넘어와도 이제는 무시하고 항상 ProgramMilestones(팩트 바 + 서류 제출 행)를 그린다.
  it('승인된 학생에게도 approvedStudentMilestones 대신 항상 마일스톤 목록을 그린다', () => {
    const html = renderToStaticMarkup(
      <ProgramDetailReadyState
        program={{
          ...programWithoutMilestones,
          viewer: { role: 'STUDENT', applicationStatus: 'APPROVED' },
          milestones: [milestone],
        }}
        approvedStudentMilestones={
          <section id="should-not-render" aria-label="체크리스트 불러오는 중" />
        }
      />,
    );

    expect(html).toContain('id="milestones"');
    expect(html).toContain('기획서 제출');
    expect(html).not.toContain('id="should-not-render"');
    expect(html).not.toContain('체크리스트 불러오는 중');
  });

  it('renders the activity anchor used by the staff dashboard direct link', () => {
    const html = renderToStaticMarkup(
      <ProgramDetailReadyState program={programWithoutMilestones} />,
    );
    expect(html).toContain('id="activity"');
    expect(html).toContain('aria-label="활동 상세"');
  });

  // 모집 배지는 카드 안이 아니라 제목 옆(PageHeader)에 붙고, 주관기관·유형·신청
  // 기간은 그 아래 설명 줄 한 곳에서만 표시된다(#865) — 「프로그램 안내」 카드와
  // 팩트 바에서는 더 이상 중복해서 그리지 않는다.
  it('제목 줄에 모집 배지가 붙고, 주관기관·유형·신청 기간은 헤더 설명 줄에 한 번만 표시된다', () => {
    const html = renderToStaticMarkup(
      <ProgramDetailReadyState program={programWithoutMilestones} />,
    );

    const titleSlot = html.match(
      /<h1 data-slot="page-header-title"[^>]*>(.*?)<\/h1>/,
    )?.[1];
    expect(titleSlot).toBeDefined();
    expect(titleSlot).toContain('OSS 경진대회');
    expect(titleSlot).toContain('모집중');

    const description = '운영기관 · 비교과 · 2026.07.01 ~ 2026.08.31';
    expect(html.split(description)).toHaveLength(2);
    expect(html).not.toContain('<strong>주관기관</strong>');
    expect(html).not.toContain('<strong>신청기간</strong>');
  });

  // 신청자 목록은 프로그램 스코프 사이드바에 이미 있는 목적지라, 헤더에서는
  // 중복 노출하지 않는다(#865) — STAFF·ADMIN 모두 프로그램 편집 버튼 하나만 남는다.
  it.each(['STAFF', 'ADMIN'] as const)(
    '%s에게 프로그램 편집 CTA만 노출하고 신청자 목록·미구현 #124 경로는 숨긴다',
    (role) => {
      const html = renderToStaticMarkup(
        <ProgramActions
          program={{
            ...programWithoutMilestones,
            viewer: { role, applicationStatus: null },
          }}
        />,
      );
      expect(html).toContain('/programs/program-1/edit');
      expect(html).toContain('프로그램 편집');
      expect(html).not.toContain('신청자 목록');
      expect(html).not.toContain('/programs/program-1/applicants');
      expect(html).not.toContain('/programs/program-1/submissions');
      expect(html).not.toContain('전체 제출 현황');
    },
  );

  it('신청 전 학생에게 신청하기 CTA를 노출한다', () => {
    const html = renderToStaticMarkup(
      <ProgramActions
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

  // 이 갈래에는 비로그인 방문자와 "GitHub만 연결하고 프로필을 안 채운 사람"이 함께
  // 들어온다. 뒤쪽은 이미 로그인한 상태라 예전 문구·목적지(랜딩)가 둘 다 틀렸었다.
  it('역할 없는 사람을 랜딩이 아니라 가입 진입점으로 보낸다', () => {
    const html = renderToStaticMarkup(
      <ProgramActions
        program={{
          ...programWithoutMilestones,
          viewer: { role: null, applicationStatus: null },
        }}
      />,
    );
    expect(html).toContain('가입하고 신청하기');
    expect(html).toContain('href="/signup"');
    expect(html).not.toContain('로그인');
    expect(html).not.toContain('href="/"');
  });

  it('마일스톤이 없으면 빈 상태와 교직원 설정 진입을 표시한다', () => {
    const html = renderToStaticMarkup(
      <ProgramMilestones program={programWithoutMilestones} />,
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

const overviewBase: ProgramOverview = {
  programId: 'program-1',
  name: 'OSS 경진대회',
  trackType: 'EXTRACURRICULAR',
  lifecycle: 'ACTIVE',
  milestoneCount: 1,
  boardPostCount: 0,
  participantCount: 12,
  teamCount: 4,
  connectedRepositoryCount: 3,
  viewerRole: 'STUDENT',
  viewerDocumentsCompleted: null,
  viewerDocumentsTotal: null,
  fullySubmittedParticipantCount: null,
  remainingMilestones: [],
  milestoneDocuments: [],
};

describe('ProgramFactBar', () => {
  // 주관기관·신청 기간은 헤더 설명 줄로 옮겼다(#865) — overview가 없으면(비로그인
  // 등 조회 실패) 보여줄 숫자 지표가 없으므로 팩트 바 자체를 그리지 않는다.
  it('overview 조회 실패 시(null) 아무것도 그리지 않는다', () => {
    const html = renderToStaticMarkup(
      <ProgramFactBar program={programWithoutMilestones} overview={null} />,
    );
    expect(html).toBe('');
  });

  it('학생에게는 참여 현황과 함께 내 제출 N/M을 보여준다', () => {
    const html = renderToStaticMarkup(
      <ProgramFactBar
        program={programWithoutMilestones}
        overview={{
          ...overviewBase,
          viewerRole: 'STUDENT',
          viewerDocumentsCompleted: 2,
          viewerDocumentsTotal: 5,
        }}
      />,
    );
    expect(html).toContain('참여 학생');
    expect(html).toContain('12명');
    expect(html).toContain('참여 팀');
    expect(html).toContain('연결 저장소');
    expect(html).toContain('내 제출');
    expect(html).toContain('2 / 5 서류');
    expect(html).not.toContain('이번 마일스톤 완주율');
    expect(html).not.toContain('주관');
    expect(html).not.toContain('신청 기간');
  });

  // QA47 — "제출률"만으로는 마일스톤 카드·매트릭스와 다른 숫자가 나오는
  // 이유를 알 수 없었다. 라벨과 캡션으로 측정 범위(현재 마일스톤)를 명시한다.
  it('교직원에게는 내 제출 대신 이번 마일스톤 완주율과 측정 기준 캡션을 보여준다', () => {
    const html = renderToStaticMarkup(
      <ProgramFactBar
        program={programWithoutMilestones}
        overview={{
          ...overviewBase,
          viewerRole: 'STAFF',
          participantCount: 10,
          fullySubmittedParticipantCount: 3,
        }}
      />,
    );
    expect(html).toContain('이번 마일스톤 완주율');
    expect(html).toContain('30% (3/10)');
    expect(html).toContain('현재 마일스톤 필수 항목을 모두 제출한 참여자 기준');
    expect(html).not.toContain('내 제출');
  });
});

function buildDocument(
  overrides: Partial<MilestoneDocument> = {},
): MilestoneDocument {
  return {
    id: 'document-1',
    milestoneId: 'milestone-1',
    name: '기획서',
    required: true,
    sortOrder: 0,
    hasTemplateFile: false,
    templateFileName: null,

    ...overrides,
  };
}

describe('MilestoneDocumentSectionBody', () => {
  it('로딩 중에는 아무것도 그리지 않는다', () => {
    const html = renderToStaticMarkup(
      <MilestoneDocumentSectionBody
        state={{ kind: 'loading' }}
        viewerRole="STUDENT"
        closed={false}
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
      <MilestoneDocumentSectionBody
        state={{ kind: 'failed' }}
        viewerRole="STUDENT"
        closed={false}
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
      <MilestoneDocumentSectionBody
        state={{ kind: 'ready', documents: [] }}
        viewerRole="STUDENT"
        closed={false}
        conflictNotice={null}
        onRetry={vi.fn()}
        onDocumentChange={vi.fn()}
        onSubmitConflict={vi.fn()}
      />,
    );
    expect(html).toBe('');
  });

  it('교직원에게는 팀 제출 카운트와 양식 올리기/교체 버튼을 보여준다', () => {
    const html = renderToStaticMarkup(
      <MilestoneDocumentSectionBody
        state={{
          kind: 'ready',
          documents: [
            buildDocument({
              hasTemplateFile: true,
              templateFileName: null,

              teamSubmissionCount: { submitted: 2, total: 4 },
            }),
          ],
        }}
        viewerRole="STAFF"
        closed={false}
        conflictNotice={null}
        onRetry={vi.fn()}
        onDocumentChange={vi.fn()}
        onSubmitConflict={vi.fn()}
      />,
    );
    expect(html).toContain('2 / 4팀 제출');
    expect(html).toContain('양식 교체');
    expect(html).not.toContain('양식 올리기');
  });

  /**
   * 배지 문구가 「제출함」에서 판정 기준 라벨로 바뀌었다(2026-08 서류 판정). 아직 아무도
   * 보지 않은 제출은 「검토 대기」다 — 낸 것과 승인된 것을 같은 말로 부르지 않는다.
   * 제출 시각은 배지에서 떼어 옆에 남는다.
   */
  it('학생에게는 검토 대기 배지와 제출 시각, 재제출 버튼을 보여준다', () => {
    const html = renderToStaticMarkup(
      <MilestoneDocumentSectionBody
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
                review: null,
                history: { hasHistory: true, isComplete: true },
              },
            }),
          ],
        }}
        viewerRole="STUDENT"
        closed={false}
        conflictNotice={null}
        onRetry={vi.fn()}
        onDocumentChange={vi.fn()}
        onSubmitConflict={vi.fn()}
      />,
    );
    expect(html).toContain('검토 대기');
    expect(html).toContain('08.01 14:22 제출');
    expect(html).toContain('수정');
    expect(html).toContain('제출 1/1 완료');
  });

  it('미제출 학생에게는 미제출 배지와 올리기 버튼을 보여준다', () => {
    const html = renderToStaticMarkup(
      <MilestoneDocumentSectionBody
        state={{ kind: 'ready', documents: [buildDocument()] }}
        viewerRole="STUDENT"
        closed={false}
        conflictNotice={null}
        onRetry={vi.fn()}
        onDocumentChange={vi.fn()}
        onSubmitConflict={vi.fn()}
      />,
    );
    expect(html).toContain('미제출');
    expect(html).toContain('올리기');
    expect(html).toContain('제출 0/1 완료');
  });
});
