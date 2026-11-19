import { describe, expect, it } from 'vitest';
import { STAFF_INSIGHTS_FIXTURE } from './fixtures';
import { parseStaffInsightsSummary } from './parser';

function wirePayload(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(STAFF_INSIGHTS_FIXTURE)) as Record<
    string,
    unknown
  >;
}

function firstRecord(value: unknown): Record<string, unknown> {
  return (value as Record<string, unknown>[])[0];
}

function leaderGroups(
  payload: Record<string, unknown>,
  window: 'period' | 'recent',
): Record<string, unknown> {
  return (payload.leaders as Record<string, Record<string, unknown>>)[window];
}

describe('parseStaffInsightsSummary', () => {
  it('parses the approved staff-only summary fields', () => {
    const summary = parseStaffInsightsSummary(wirePayload());

    expect(summary.leaders.period.all).toHaveLength(2);
    expect(summary.leaders.period.all[0]).toMatchObject({
      studentId: '010001',
      major: null,
      recentTotal: 39,
      previousRank: null,
      collaborationRatio: 0.25,
    });
    expect(summary.leaders.recent.swMajor[0].rank).toBe(1);
    expect(summary.recentWindow.from).toEqual(
      new Date('2026-07-02T00:00:00.000Z'),
    );
    expect(summary.departments[0]).toMatchObject({
      major: null,
      activityPerStudent: 18.5,
      recentPerStudent: 4.25,
    });
    expect(summary.departments[1].recentPerStudent).toBeNull();
    expect(summary.departments[3].sampleTooSmall).toBe(true);
    expect(summary.attentionStudents).toEqual([
      {
        name: null,
        githubLogin: 'synthetic-b',
        studentId: null,
        department: null,
        total: 44,
        lastActiveAt: null,
      },
    ]);
    expect(summary.firstContributionCount).toBeNull();
  });

  it('preserves observed zeros, prior ranks outside the display cap, and known values', () => {
    const payload = wirePayload();
    payload.scope = { kind: 'calendar', year: 2026 };
    Object.assign(firstRecord(payload.departments), {
      major: '합성 전공',
      recentPerStudent: 0,
    });
    const rows = leaderGroups(payload, 'period').all as Record<
      string,
      unknown
    >[];
    Object.assign(rows[0], {
      major: '합성 전공',
      previousRank: 25,
      recentTotal: 0,
      collaborationRatio: 0,
    });
    Object.assign(rows[1], { recentTotal: null, collaborationRatio: null });
    firstRecord(payload.attentionStudents).lastActiveAt =
      '2026-05-01T15:30:00.000Z';
    payload.firstContributionCount = 0;

    const summary = parseStaffInsightsSummary(payload);

    expect(summary.departments[0]).toMatchObject({
      major: '합성 전공',
      recentPerStudent: 0,
    });
    expect(summary.leaders.period.all[0]).toMatchObject({
      major: '합성 전공',
      previousRank: 25,
      recentTotal: 0,
      collaborationRatio: 0,
    });
    expect(summary.leaders.period.all[1]).toMatchObject({
      recentTotal: null,
      collaborationRatio: null,
    });
    expect(summary.attentionStudents[0].lastActiveAt).toEqual(
      new Date('2026-05-01T15:30:00.000Z'),
    );
    expect(summary.firstContributionCount).toBe(0);
  });

  it('throws when leaders is missing', () => {
    const payload = wirePayload();
    delete payload.leaders;

    expect(() => parseStaffInsightsSummary(payload)).toThrow(
      '인사이트 API 응답 형식이 올바르지 않습니다.',
    );
  });

  it('throws when recentWindow is missing', () => {
    const payload = wirePayload();
    delete payload.recentWindow;

    expect(() => parseStaffInsightsSummary(payload)).toThrow();
  });

  it('throws when a leader rank is 0', () => {
    const payload = wirePayload();
    firstRecord(leaderGroups(payload, 'period').all).rank = 0;

    expect(() => parseStaffInsightsSummary(payload)).toThrow();
  });

  it('throws when a leader githubLogin is empty', () => {
    const payload = wirePayload();
    firstRecord(leaderGroups(payload, 'recent').all).githubLogin = '';

    expect(() => parseStaffInsightsSummary(payload)).toThrow();
  });

  it.each([
    ['period', 12],
    ['recent', 10],
  ] as const)('enforces the %s leader limit of %d rows', (window, limit) => {
    const payload = wirePayload();
    const groups = leaderGroups(payload, window);
    const row = firstRecord(groups.all);
    const rows = Array.from({ length: limit + 1 }, (_, index) => ({
      ...row,
      rank: index + 1,
      githubLogin: `synthetic-leader-${index}`,
    }));
    groups.all = rows.slice(0, limit);

    expect(parseStaffInsightsSummary(payload).leaders[window].all).toHaveLength(
      limit,
    );

    groups.all = rows;
    expect(() => parseStaffInsightsSummary(payload)).toThrow();
  });

  it.each([
    ['studentId', 1001],
    ['major', false],
    ['recentTotal', -1],
    ['recentTotal', 1.5],
    ['previousRank', 0],
    ['previousRank', 2.5],
    ['collaborationRatio', -0.1],
    ['collaborationRatio', 1.01],
  ] as const)('throws for invalid period leader %s (%s)', (field, value) => {
    const payload = wirePayload();
    firstRecord(leaderGroups(payload, 'period').all)[field] = value;

    expect(() => parseStaffInsightsSummary(payload)).toThrow();
  });

  it.each([
    'studentId',
    'major',
    'recentTotal',
    'previousRank',
    'collaborationRatio',
  ])('throws when a period leader lacks the nullable %s', (field) => {
    const payload = wirePayload();
    delete firstRecord(leaderGroups(payload, 'period').all)[field];

    expect(() => parseStaffInsightsSummary(payload)).toThrow();
  });

  it('throws when activityPerStudent is negative', () => {
    const payload = wirePayload();
    firstRecord(payload.departments).activityPerStudent = -1;

    expect(() => parseStaffInsightsSummary(payload)).toThrow();
  });

  it('throws when sampleTooSmall is not a boolean', () => {
    const payload = wirePayload();
    firstRecord(payload.departments).sampleTooSmall = 'yes';

    expect(() => parseStaffInsightsSummary(payload)).toThrow();
  });

  it.each([
    ['major', 5],
    ['recentPerStudent', -1],
    ['recentPerStudent', Infinity],
  ] as const)('throws for invalid department %s (%s)', (field, value) => {
    const payload = wirePayload();
    firstRecord(payload.departments)[field] = value;

    expect(() => parseStaffInsightsSummary(payload)).toThrow();
  });

  it.each(['major', 'recentPerStudent'])(
    'throws when a department lacks the nullable %s',
    (field) => {
      const payload = wirePayload();
      delete firstRecord(payload.departments)[field];

      expect(() => parseStaffInsightsSummary(payload)).toThrow();
    },
  );

  it('keeps recent leader rows limited to the approved fields', () => {
    const payload = wirePayload();
    Object.assign(firstRecord(leaderGroups(payload, 'recent').all), {
      studentId: '010001',
      starCount: 99,
    });

    const summary = parseStaffInsightsSummary(payload);

    expect(summary.leaders.recent.all[0]).not.toHaveProperty('studentId');
    expect(summary.leaders.recent.all[0]).not.toHaveProperty('starCount');
  });

  it('enforces the attention student limit of four rows', () => {
    const payload = wirePayload();
    const row = firstRecord(payload.attentionStudents);
    const rows = Array.from({ length: 5 }, (_, index) => ({
      ...row,
      githubLogin: `synthetic-attention-${index}`,
    }));
    payload.attentionStudents = rows.slice(0, 4);

    expect(parseStaffInsightsSummary(payload).attentionStudents).toHaveLength(
      4,
    );

    payload.attentionStudents = rows;
    expect(() => parseStaffInsightsSummary(payload)).toThrow();
  });

  it.each([
    ['githubLogin', ''],
    ['studentId', 1001],
    ['total', 0],
    ['lastActiveAt', 'not-a-date'],
  ])('throws for invalid attention student %s (%s)', (field, value) => {
    const payload = wirePayload();
    firstRecord(payload.attentionStudents)[field] = value;

    expect(() => parseStaffInsightsSummary(payload)).toThrow();
  });

  it('requires lastActiveAt on each attention student even when unknown', () => {
    const payload = wirePayload();
    delete firstRecord(payload.attentionStudents).lastActiveAt;

    expect(() => parseStaffInsightsSummary(payload)).toThrow();
  });

  it.each(['attentionStudents', 'firstContributionCount'])(
    'throws when %s is absent',
    (field) => {
      const payload = wirePayload();
      delete payload[field];

      expect(() => parseStaffInsightsSummary(payload)).toThrow();
    },
  );

  it.each([-1, 1.5, '0'])('rejects firstContributionCount of %s', (value) => {
    const payload = wirePayload();
    payload.firstContributionCount = value;

    expect(() => parseStaffInsightsSummary(payload)).toThrow();
  });

  it('parses program scorecard rows with null metrics and the summary', () => {
    const summary = parseStaffInsightsSummary(wirePayload());

    expect(summary.programs[0].startAt).toEqual(
      new Date('2026-03-01T15:00:00.000Z'),
    );
    expect(summary.programs[3]).toMatchObject({
      category: 'CORPORATE_INTERNSHIP',
      recruiting: true,
      competitionRatio: null,
      completionRate: null,
      contributionsPerParticipant: null,
    });
    expect(summary.programSummary.repeatParticipantRate).toBe(15);
  });

  it.each([
    ['an unknown category', 'category', 'WORKSHOP'],
    ['a negative competition ratio', 'competitionRatio', -1],
    ['a fractional completion rate', 'completionRate', 83.5],
    ['an invalid start date', 'startAt', 'not-a-date'],
  ])('throws on %s', (_label, field, value) => {
    const payload = wirePayload();
    firstRecord(payload.programs)[field] = value;

    expect(() => parseStaffInsightsSummary(payload)).toThrow();
  });

  it('throws when programSummary is missing', () => {
    const payload = wirePayload();
    delete payload.programSummary;

    expect(() => parseStaffInsightsSummary(payload)).toThrow();
  });
});
