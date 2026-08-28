import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProgramFactBar, ProgramSummary } from './program-detail-summary';
import type { ProgramOverview } from './program-overview-api';
import type { ProgramDetail } from './types';

const program: ProgramDetail = {
  id: 'program-1',
  name: 'OSS 경진대회',
  organizer: '운영기관',
  category: 'OSS_CONTEST',
  description: '프로그램 설명',
  repositoryProvisioningEnabled: true,
  applicationPeriod: {
    startsAt: '2026-07-01T00:00:00+09:00',
    endsAt: '2026-08-31T23:59:59+09:00',
  },
  viewer: { role: 'STAFF', applicationStatus: null },
  milestones: [],
};

const overview: ProgramOverview = {
  programId: 'program-1',
  name: 'OSS 경진대회',
  category: 'OSS_CONTEST',
  lifecycle: 'ACTIVE',
  milestoneCount: 1,
  boardPostCount: 0,
  participantCount: 12,
  teamCount: 4,
  connectedRepositoryCount: 3,
  viewerRole: 'STUDENT',
  viewerDocumentsCompleted: 2,
  viewerDocumentsTotal: 5,
  fullySubmittedParticipantCount: null,
  remainingMilestones: [],
  milestoneDocuments: [],
};

describe('ProgramSummary', () => {
  it('설명이 있으면 기본으로 닫힌 안내 카드와 숨겨진 설명 영역을 렌더링한다', () => {
    const html = renderToStaticMarkup(<ProgramSummary program={program} />);
    const controlsMatch = html.match(/aria-controls="([^"]+)"/);
    if (controlsMatch === null || controlsMatch[1] === undefined) {
      throw new TypeError('안내 카드 트리거에 aria-controls가 없습니다.');
    }

    expect(html).toContain('프로그램 안내');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain(`id="${controlsMatch[1]}"`);
    expect(html).toContain('data-state="closed"');
    expect(html).toContain('data-[state=closed]:hidden');
    expect(html).toContain('프로그램 설명');
  });

  it('프로그램 설명이 없으면 안내 카드를 표시하지 않는다', () => {
    const html = renderToStaticMarkup(
      <ProgramSummary program={{ ...program, description: '' }} />,
    );

    expect(html).toBe('');
  });
});

describe('ProgramFactBar', () => {
  it('학생에게 대표 참여 현황과 내 제출 수를 표시한다', () => {
    const html = renderToStaticMarkup(
      <ProgramFactBar program={program} overview={overview} />,
    );

    expect(html).toContain('참여 학생');
    expect(html).toContain('12명');
    expect(html).toContain('참여 팀');
    expect(html).toContain('4팀');
    expect(html).toContain('연결 저장소');
    expect(html).toContain('3개');
    expect(html).toContain('내 제출');
    expect(html).toContain('2 / 5 서류');
  });
});
