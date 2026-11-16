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

describe('parseStaffInsightsSummary', () => {
  it('parses a valid payload including leaders and recentWindow', () => {
    const summary = parseStaffInsightsSummary(wirePayload());

    expect(summary.leaders.period.all).toHaveLength(2);
    expect(summary.leaders.recent.swMajor[0].rank).toBe(1);
    expect(summary.recentWindow.from).toEqual(
      new Date('2026-07-02T00:00:00.000Z'),
    );
    expect(summary.departments[0].activityPerStudent).toBe(18.5);
    expect(summary.departments[3].sampleTooSmall).toBe(true);
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
    const leaders = payload.leaders as Record<string, Record<string, unknown>>;
    firstRecord(leaders.period.all).rank = 0;

    expect(() => parseStaffInsightsSummary(payload)).toThrow();
  });

  it('throws when a leader githubLogin is empty', () => {
    const payload = wirePayload();
    const leaders = payload.leaders as Record<string, Record<string, unknown>>;
    firstRecord(leaders.recent.all).githubLogin = '';

    expect(() => parseStaffInsightsSummary(payload)).toThrow();
  });

  it('throws when a leader list has more than 10 rows', () => {
    const payload = wirePayload();
    const leaders = payload.leaders as Record<string, Record<string, unknown>>;
    const row = firstRecord(leaders.recent.all);
    leaders.recent.all = Array.from({ length: 11 }, () => ({ ...row }));

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

  it('ignores starCount on a recent leader row', () => {
    const payload = wirePayload();
    const leaders = payload.leaders as Record<string, Record<string, unknown>>;
    firstRecord(leaders.recent.all).starCount = 99;

    const summary = parseStaffInsightsSummary(payload);

    expect(summary.leaders.recent.all[0]).not.toHaveProperty('starCount');
  });

  it('requires starCount on a period leader row', () => {
    const payload = wirePayload();
    const leaders = payload.leaders as Record<string, Record<string, unknown>>;
    delete firstRecord(leaders.period.all).starCount;

    expect(() => parseStaffInsightsSummary(payload)).toThrow();
  });
});
