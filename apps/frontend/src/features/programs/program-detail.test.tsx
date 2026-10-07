import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { milestoneDocumentUploadPolicy } from '../../../test-support/milestone-document-upload-policy';
import { ActivityPanelBody } from './components/activity-graph-panel';
import { MilestoneRow } from './components/milestone-row';
import { ApiError } from '@/lib/api-client';
import { MilestoneDocumentSectionBody } from './milestone-document-list';
import type { MilestoneDocument } from './milestone-document-api';
import { milestoneSubmissionAccess } from './milestone-submission-access';
import {
  detailFailure,
  ProgramActions,
  ProgramDetailReadyState,
  ProgramDetailFailureState,
  ProgramMilestones,
} from './program-detail-page';
import { ProgramFactBar } from './program-detail-view';
import type { ProgramOverview } from './program-overview-api';
import { getProgramListBadge } from './program-list';
import type {
  ApplicationStatus,
  ProgramDetail,
  ProgramListItem,
  ProgramMilestone,
  ViewerRole,
} from './types';

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
        position={1}
        nameId="milestone-1-name"
        milestone={{ ...milestone, viewerSubmissionStatus: null }}
        viewerRole={null}
        submissionAccess={access(null)}
      />,
    );
    expect(html).toContain('기획서 제출');
    expect(html).toContain('D-5');
    expect(html).toContain('가입 후 확인');

    expect(html).not.toContain('로그인');
    expect(html).not.toContain('>반려<');
  });

  it('학생에게 반려 상태를 색뿐 아니라 텍스트로 표시한다', () => {
    const html = renderToStaticMarkup(
      <MilestoneRow
        programId="program-1"
        position={1}
        nameId="milestone-1-name"
        milestone={milestone}
        viewerRole="STUDENT"
        submissionAccess={access('STUDENT', 'APPROVED')}
      />,
    );
    expect(html).toContain('data-variant="rejected"');
    expect(html).toContain('>반려<');
  });

  it('신규 제출 항목 모델은 작동하지 않는 레거시 제출 버튼을 노출하지 않는다', () => {
    const html = renderToStaticMarkup(
      <MilestoneRow
        programId="program-1"
        position={1}
        nameId="milestone-1-name"
        milestone={{
          ...milestone,
          submissionType: null,
          submissionItemCount: 2,
          viewerSubmissionStatus: null,
        }}
        viewerRole="STUDENT"
        submissionAccess={access('STUDENT', 'APPROVED')}
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
        position={1}
        nameId="milestone-1-name"
        milestone={{
          ...milestone,
          submissionType: null,
          submissionItemCount: 0,
          viewerSubmissionStatus: null,
        }}
        viewerRole="STUDENT"
        submissionAccess={access('STUDENT', 'APPROVED')}
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
        position={1}
        nameId="milestone-1-name"
        milestone={{
          ...milestone,
          submissionType: null,
          submissionItemCount: 2,
          viewerSubmissionStatus: null,
        }}
        viewerRole="STUDENT"
        submissionAccess={access('STUDENT', 'SUBMITTED')}
      />,
    );

    expect(html).toContain(
      '신청 승인을 기다리는 중입니다. 승인되면 제출할 수 있습니다.',
    );
    expect(html).not.toContain('아래 제출 항목에서 내용이나 파일을 제출하세요');
  });

  it('반려된 신청에는 #1098 이전 문구를 그대로 보여준다', () => {
    const html = renderToStaticMarkup(
      <MilestoneRow
        programId="program-1"
        position={1}
        nameId="milestone-1-name"
        milestone={{
          ...milestone,
          dueAt: '2099-08-10T23:59:59+09:00',
          viewerSubmissionStatus: 'NOT_SUBMITTED',
        }}
        viewerRole="STUDENT"
        submissionAccess={access('STUDENT', 'REJECTED')}
      />,
    );

    expect(html).toContain('신청 승인 후 제출 상태를 확인할 수 있습니다.');
    expect(html).not.toContain('미제출');
    expect(html).not.toContain('제출하기');
    expect(html).not.toContain('반려되어');
  });

  it('마감 후 보완 요청도 #116 체크리스트에서 다시 제출할 수 있다', () => {
    const html = renderToStaticMarkup(
      <MilestoneRow
        programId="program-1"
        position={1}
        nameId="milestone-1-name"
        milestone={{
          ...milestone,
          dDay: -2,
          deadlineLabel: '마감 지남',
          viewerSubmissionStatus: 'CHANGES_REQUESTED',
        }}
        viewerRole="STUDENT"
        submissionAccess={access('STUDENT', 'APPROVED')}
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
        position={1}
        nameId="milestone-1-name"
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
        submissionAccess={access('STAFF')}
      />,
    );
    expect(html).toContain('3/5');
    expect(html).not.toContain('전체 현황');
    expect(html).not.toContain('/programs/program-1/submissions');
  });

  it('교직원 마일스톤에는 마감과 운영자 공지를 구분해 표시한다', () => {
    const html = renderToStaticMarkup(
      <MilestoneRow
        programId="program-1"
        position={1}
        nameId="milestone-1-name"
        milestone={milestone}
        viewerRole="STAFF"
        submissionAccess={access('STAFF')}
      />,
    );

    expect(html).toContain('마감 2026년 8월 10일');
    expect(html).toContain('aria-label="운영자 공지"');
    expect(html).toContain('PDF 기획서를 제출해 주세요.');
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
    expect(empty).toContain('표시할 팀이 없습니다');
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
              collectionStatus: 'READY',
              members: [],
              hasIncompleteContributions: false,
              lastActivityAt: '2026-07-23T00:00:00.000Z',
              dataAsOf: '2026-07-24T00:00:00.000Z',
            },
          ],
        }}
        onRetry={vi.fn()}
      />,
    );

    expect(html).toContain('aria-label="학생 Commit"');
    expect(html).toContain('aria-label="학생 PR"');
    expect(html).toContain('aria-label="학생 Release"');
    expect(html).toContain('aria-valuenow="2"');
    expect(html).toContain('aria-valuenow="3"');
    expect(html).toContain('aria-valuenow="4"');
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
              collectionStatus: 'EMPTY',
              members: [],
              hasIncompleteContributions: false,
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
  lifecycle: 'PUBLISHED',
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

    const description =
      '운영기관 · 비교과 · <span class="whitespace-nowrap">신청 기간 2026.07.01 ~ 2026.08.31</span>';
    expect(html.split(description)).toHaveLength(2);
    expect(html).not.toContain('<strong>주관기관</strong>');
    expect(html).not.toContain('<strong>신청기간</strong>');
  });

  it.each(['STAFF', 'ADMIN'] as const)(
    '%s에게 제목 옆 프로그램 편집 입구만 노출하고 신청자 목록·미구현 #124 경로는 숨긴다',
    (role) => {
      const html = renderToStaticMarkup(
        <ProgramDetailReadyState
          program={{
            ...programWithoutMilestones,
            viewer: { role, applicationStatus: null },
          }}
        />,
      );
      expect(html).toContain('data-slot="page-header-actions"');
      expect(html).toContain('href="/programs/program-1/edit"');

      expect(html).toContain('편집');
      expect(html).toContain('lucide-pencil');
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
  ])(
    '$role 에게는 프로그램 편집 입구를 숨긴다',
    ({ role, applicationStatus }) => {
      const html = renderToStaticMarkup(
        <ProgramDetailReadyState
          program={{
            ...programWithoutMilestones,
            viewer: { role, applicationStatus },
          }}
        />,
      );

      expect(html).not.toContain('/edit"');
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

  it('역할 없는 사람을 랜딩이 아니라 가입 진입점으로 보낸다', () => {
    const html = renderToStaticMarkup(
      <ProgramActions
        program={{
          ...programWithoutMilestones,
          viewer: { role: null, applicationStatus: null },
        }}
      />,
    );

    expect(html).toContain('신청하기');
    expect(html).toContain('href="/signup"');
    expect(html).not.toContain('로그인');
    expect(html).not.toContain('href="/"');
  });

  describe('종료된 프로그램 상세', () => {
    const studentViewer = {
      role: 'STUDENT',
      applicationStatus: null,
    } as const satisfies ProgramDetail['viewer'];

    const archived: ProgramDetail = {
      ...programWithoutMilestones,
      lifecycle: 'ARCHIVED',
      viewer: studentViewer,
    };
    const dateEnded: ProgramDetail = {
      ...programWithoutMilestones,
      lifecycle: 'PUBLISHED',
      operatingPeriod: {
        startsAt: '2026-06-01T00:00:00+09:00',
        endsAt: '2026-08-10T23:59:59+09:00',
      },
      viewer: studentViewer,
    };
    const live: ProgramDetail = {
      ...programWithoutMilestones,
      lifecycle: 'PUBLISHED',
      operatingPeriod: {
        startsAt: '2026-06-01T00:00:00+09:00',
        endsAt: '2026-12-31T23:59:59+09:00',
      },
      viewer: studentViewer,
    };

    const endedCases = [
      { kind: '내린 프로그램', program: archived },
      { kind: '종료일이 지난 프로그램', program: dateEnded },
    ];

    function titleSlotOf(program: ProgramDetail): string {
      const html = renderToStaticMarkup(
        <ProgramDetailReadyState program={program} />,
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
        organizer: program.organizer,
        trackType: program.trackType,
        lifecycle: program.lifecycle,
        applicationStartAt: program.applicationPeriod.startsAt,
        applicationEndAt: program.applicationPeriod.endsAt,
        endAt: program.operatingPeriod?.endsAt ?? null,
        description: program.description,
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

    it.each(
      endedCases.flatMap(({ kind, program }) =>
        [
          {
            viewer: '학생',
            role: 'STUDENT' as const,
            label: '신청하기',
            href: '/programs/program-1/apply',
          },
          {
            viewer: '비로그인',
            role: null,
            label: '신청하기',
            href: '/signup',
          },
        ].map((entry) => ({ ...entry, kind, program })),
      ),
    )(
      '$kind 의 $viewer 신청 입구를 이유와 함께 비활성으로 그린다',
      ({ program, role, label, href }) => {
        const html = renderToStaticMarkup(
          <ProgramActions
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
        expect(html).not.toContain(`href="${href}"`);
      },
    );

    it('게시 중이고 아직 안 끝난 프로그램은 지금과 똑같이 신청 입구를 연다', () => {
      const actions = renderToStaticMarkup(<ProgramActions program={live} />);

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
          <ProgramActions program={withoutOperatingPeriod} />,
        ),
      ).toContain('href="/programs/program-1/apply"');
    });
  });

  it('마일스톤이 없으면 빈 상태와 교직원 설정 진입을 표시한다', () => {
    const html = renderToStaticMarkup(
      <ProgramMilestones program={programWithoutMilestones} />,
    );
    expect(html).toContain('아직 등록된 마일스톤이 없습니다');
    expect(html).toContain('/programs/program-1/edit#milestones');
  });

  it('교직원은 제출 항목이 있는 모든 마일스톤을 처음부터 펼쳐 둔다', () => {
    const html = renderToStaticMarkup(
      <ProgramMilestones
        program={{
          ...programWithoutMilestones,
          milestones: [
            { ...milestone, id: 'milestone-1', submissionItemCount: 1 },
            { ...milestone, id: 'milestone-2', submissionItemCount: 1 },
          ],
        }}
      />,
    );

    expect((html.match(/aria-expanded="true"/g) ?? []).length).toBe(2);
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
      <MilestoneDocumentSectionBody
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
      <MilestoneDocumentSectionBody
        state={{
          kind: 'ready',
          documents: [],
          fileUpload: milestoneDocumentUploadPolicy(),
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

  it('교직원에게는 팀 제출 카운트를 보이고 양식 관리 컨트롤은 노출하지 않는다', () => {
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
          fileUpload: milestoneDocumentUploadPolicy(),
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
    expect(html).toContain('2 / 4팀 제출');
    expect(html).toContain('기획서');
    expect(html).not.toContain('양식 올리기');
    expect(html).not.toContain('양식 교체');
    expect(html).not.toContain('type="file"');
  });

  it('학생에게는 기존 양식 다운로드를 유지한다', () => {
    const html = renderToStaticMarkup(
      <MilestoneDocumentSectionBody
        state={{
          kind: 'ready',
          documents: [buildDocument({ hasTemplateFile: true })],
          fileUpload: milestoneDocumentUploadPolicy(),
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
                currentFileName: null,
                review: null,
                history: { hasHistory: true, isComplete: true },
              },
            }),
          ],
          fileUpload: milestoneDocumentUploadPolicy(),
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
    expect(html).toContain('검토 대기');
    expect(html).toContain('08.01 14:22 제출');
    expect(html).toContain('수정');
    expect(html).toContain('제출 1/1 완료');
  });

  it('미제출 학생에게는 미제출 배지와 올리기 버튼을 보여준다', () => {
    const html = renderToStaticMarkup(
      <MilestoneDocumentSectionBody
        state={{
          kind: 'ready',
          documents: [buildDocument()],
          fileUpload: milestoneDocumentUploadPolicy(),
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
    expect(html).toContain('제출 0/1 완료');
  });
});
