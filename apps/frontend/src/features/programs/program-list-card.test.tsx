import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProgramListCard } from './program-list-card';
import type { ProgramListItem } from './types';

const program: ProgramListItem = {
  id: 'program-1',
  name: 'OSS 경진대회',
  organizer: 'SW중심대학사업단',
  category: 'OSS_CONTEST',
  applicationStartAt: '2026-07-01T00:00:00.000Z',
  applicationEndAt: '2026-08-31T00:00:00.000Z',
  description: '프로그램 설명',
  applicationStatus: null,
};

describe('ProgramListCard', () => {
  it('모집 상태와 자세히 보기만 노출하고 목록 신청 버튼은 두지 않는다', () => {
    const html = renderToStaticMarkup(
      <ProgramListCard
        now={new Date('2026-08-01T00:00:00.000Z')}
        program={program}
      />,
    );

    expect(html).toContain('모집중');
    expect(html).toContain('자세히 보기');
    expect(html).toContain('href="/programs/program-1"');
    expect(html.match(/href=/g)).toHaveLength(1);
    expect(html).not.toContain('신청하기');
    expect(html).not.toContain('신청 완료');
  });

  it('이미 신청한 학생에게 신청 완료 상태를 함께 표시한다', () => {
    const html = renderToStaticMarkup(
      <ProgramListCard
        now={new Date('2026-08-01T00:00:00.000Z')}
        program={{ ...program, applicationStatus: 'SUBMITTED' }}
      />,
    );

    expect(html).toContain('모집중');
    expect(html).toContain('신청 완료');
    expect(html).toContain('자세히 보기');
  });

  it('마감된 프로그램은 마감 상태와 자세히 보기를 표시한다', () => {
    const html = renderToStaticMarkup(
      <ProgramListCard
        now={new Date('2026-09-01T00:00:00.001Z')}
        program={program}
      />,
    );

    expect(html).toContain('마감');
    expect(html).toContain('자세히 보기');
  });
});
