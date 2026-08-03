import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ActivityPanelBody } from './components/activity-graph-panel';
import { MilestoneRow } from './components/milestone-row';
import { ApiError } from '@/lib/api-client';
import {
  detailFailure,
  ProgramActions,
  ProgramDetailReadyState,
  ProgramDetailFailureState,
  ProgramMilestones,
} from './program-detail-page';
import type { ProgramDetail, ProgramMilestone } from './types';

const milestone: ProgramMilestone = {
  id: 'milestone-1',
  name: '기획서 제출',
  dueAt: '2026-08-10T23:59:59+09:00',
  dDay: 5,
  deadlineLabel: 'D-5',
  description: 'PDF 기획서를 제출해 주세요.',
  submissionType: 'FILE',
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
    expect(html).toContain('/programs/program-1?submission=milestone-1');
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
    expect(html).not.toContain('/staff/programs/program-1/submissions');
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
  category: 'OSS_CONTEST',
  description: '프로그램 설명',
  applicationPeriod: {
    startsAt: '2026-07-01T00:00:00+09:00',
    endsAt: '2026-08-31T23:59:59+09:00',
  },
  viewer: { role: 'STAFF', applicationStatus: null },
  milestones: [],
};

describe('ProgramDetailPage states', () => {
  it('승인된 학생에게 별도 페이지 대신 상세 안의 제출 체크리스트를 불러온다', () => {
    const html = renderToStaticMarkup(
      <ProgramDetailReadyState
        program={{
          ...programWithoutMilestones,
          viewer: { role: 'STUDENT', applicationStatus: 'APPROVED' },
          milestones: [milestone],
        }}
        approvedStudentMilestones={
          <section id="milestones" aria-label="체크리스트 불러오는 중" />
        }
      />,
    );

    expect(html).toContain('id="milestones"');
    expect(html).toContain('체크리스트 불러오는 중');
    expect(html).not.toContain('/programs/program-1/submissions');
  });

  it('renders the activity anchor used by the staff dashboard direct link', () => {
    const html = renderToStaticMarkup(
      <ProgramDetailReadyState program={programWithoutMilestones} />,
    );
    expect(html).toContain('id="activity"');
    expect(html).toContain('aria-label="활동 상세"');
  });

  it('교직원에게 신청자 목록·편집 CTA를 노출하고 미구현 #124 경로는 숨긴다', () => {
    const html = renderToStaticMarkup(
      <ProgramActions program={programWithoutMilestones} />,
    );
    expect(html).toContain('/staff/programs/program-1/edit');
    expect(html).toContain('/staff/programs/program-1/applicants');
    expect(html).toContain('신청자 목록');
    expect(html).not.toContain('/staff/programs/program-1/submissions');
    expect(html).not.toContain('전체 제출 현황');
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
    expect(html).toContain('/staff/programs/program-1/edit#milestones');
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
