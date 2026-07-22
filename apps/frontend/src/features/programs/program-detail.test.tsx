import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ActivityPanelBody } from './components/activity-graph-panel';
import { MilestoneRow } from './components/milestone-row';
import { ApiError } from '@/lib/api-client';
import {
  detailFailure,
  ProgramActions,
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
  it('비로그인에게 비공개 제출 상태 대신 로그인 안내를 표시한다', () => {
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
    expect(html).toContain('로그인 후 확인');
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

  it('교직원에게 application 제출 요약과 전체 현황 진입을 표시한다', () => {
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
    expect(html).toContain('전체 현황');
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
  it('교직원 신청자 목록은 #106의 고정 URL인 applicants를 사용한다', () => {
    const html = renderToStaticMarkup(
      <ProgramActions program={programWithoutMilestones} />,
    );
    expect(html).toContain('/staff/programs/program-1/applicants');
    expect(html).not.toContain('/applications');
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
