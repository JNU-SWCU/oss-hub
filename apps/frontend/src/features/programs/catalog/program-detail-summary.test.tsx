import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PROGRAM_END_AT_UNDECIDED } from '../authoring/program-end-at';
import { ProgramSummary } from './program-detail-summary';
import type { ProgramOverview } from './program-overview-dto';
import type { ProgramDetail } from './dto';

const program: ProgramDetail = {
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

const studentOverview: ProgramOverview = {
  programId: 'program-1',
  name: 'OSS 경진대회',
  trackType: 'EXTRACURRICULAR',
  milestoneCount: 1,
  boardPostCount: 0,
  participantCount: 12,
  teamCount: 4,
  connectedRepositoryCount: 3,
  viewerRole: 'STUDENT',
  viewerDocumentsCompleted: 2,
  viewerDocumentsTotal: 5,
  fullySubmittedParticipantCount: null,
  scheduleMilestones: [],
  requirements: [],
};

const staffOverview: ProgramOverview = {
  ...studentOverview,
  viewerRole: 'STAFF',
  participantCount: 10,
  viewerDocumentsCompleted: null,
  viewerDocumentsTotal: null,
  fullySubmittedParticipantCount: 3,
};

function summaryMarkup(
  current: ProgramDetail,
  overview: ProgramOverview | null,
): string {
  return renderToStaticMarkup(
    <ProgramSummary program={current} overview={overview} />,
  );
}

function factsOf(html: string): Record<string, string> {
  return Object.fromEntries(
    [...html.matchAll(/<dt[^>]*>(.*?)<\/dt><dd[^>]*>(.*?)<\/dd>/g)].map(
      ([, label, value]) => [label, value.replace(/<[^>]+>/g, '')],
    ),
  );
}

describe('ProgramSummary', () => {
  it('안내와 사실 목록을 요약 카드 하나에 담는다', () => {
    const html = summaryMarkup(program, staffOverview);

    expect(html.match(/data-slot="program-summary"/g)).toHaveLength(1);
    expect(html.startsWith('<section data-slot="program-summary"')).toBe(true);
    expect(html).toContain('aria-label="프로그램 요약"');
    expect(html).toContain('프로그램 안내');
    expect(html).toContain('프로그램 설명');
    expect(Object.keys(factsOf(html))).toEqual([
      '신청 기간',
      '참여 학생',
      '참여 팀',
      '연결 저장소',
      '이번 마일스톤 완주율',
    ]);
  });

  it('학생에게는 참여 현황과 내 제출 수를 보여준다', () => {
    const facts = factsOf(summaryMarkup(program, studentOverview));

    expect(facts).toMatchObject({
      '참여 학생': '12명',
      '참여 팀': '4',
      '연결 저장소': '3개',
      '내 제출': '2 / 5 서류',
    });
    expect(facts).not.toHaveProperty('이번 마일스톤 완주율');
  });

  it('교직원에게는 내 제출 대신 이번 마일스톤 완주율을 풀이 문장 없이 보여준다', () => {
    const html = summaryMarkup(program, staffOverview);
    const facts = factsOf(html);

    expect(facts['이번 마일스톤 완주율']).toBe('30% (3/10)');
    expect(facts).not.toHaveProperty('내 제출');
    expect(html).not.toContain('참여자 기준');
  });

  it.each([
    { endsAt: '2026-10-31T09:00:00.000Z', expected: '2026.09.01 ~ 10.31' },
    { endsAt: '2027-02-28T09:00:00.000Z', expected: '2026.09.01 ~ 2027.02.28' },
    { endsAt: PROGRAM_END_AT_UNDECIDED, expected: '2026.09.01 ~ 미정' },
  ])(
    '신청 기간과 운영 기간을 서울 날짜로 나눠 적는다: $expected',
    ({ endsAt, expected }) => {
      const html = summaryMarkup(
        {
          ...program,
          operatingPeriod: { startsAt: '2026-08-31T15:00:00.000Z', endsAt },
        },
        null,
      );

      expect(factsOf(html)).toEqual({
        '신청 기간': '2026.07.01 ~ 08.31',
        '운영 기간': expected,
      });
      expect(html).not.toContain('9999');
    },
  );

  it('집계를 불러오지 못해도 기간은 보여준다', () => {
    expect(factsOf(summaryMarkup(program, null))).toEqual({
      '신청 기간': '2026.07.01 ~ 08.31',
    });
  });

  it('설명이 없으면 안내 없이 사실 목록만 그린다', () => {
    const html = summaryMarkup({ ...program, description: '' }, staffOverview);

    expect(html).not.toContain('프로그램 안내');
    expect(factsOf(html)['참여 학생']).toBe('10명');
  });

  it('참여자가 없으면 0/0 완주율을 만들지 않는다', () => {
    const html = summaryMarkup(program, {
      ...staffOverview,
      participantCount: 0,
      fullySubmittedParticipantCount: 0,
    });

    expect(factsOf(html)).not.toHaveProperty('이번 마일스톤 완주율');
    expect(html).not.toContain('0/0');
  });

  it('낼 서류가 없는 학생에게 0 / 0 제출 수를 만들지 않는다', () => {
    const html = summaryMarkup(program, {
      ...studentOverview,
      viewerDocumentsCompleted: null,
      viewerDocumentsTotal: null,
    });

    expect(factsOf(html)).not.toHaveProperty('내 제출');
    expect(html).not.toContain('0 / 0');
  });

  it('높이를 재기 전에는 전체 보기 버튼을 그리지 않는다', () => {
    expect(summaryMarkup(program, staffOverview)).not.toContain('전체 보기');
  });
});
