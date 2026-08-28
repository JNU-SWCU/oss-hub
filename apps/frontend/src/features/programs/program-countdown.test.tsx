import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  formatClock,
  formatCountdownDate,
  ProgramCountdown,
  remainingUntil,
} from './program-countdown';
import type { CountdownMilestone } from './program-countdown';

describe('formatClock / formatCountdownDate', () => {
  it('formats HH:MM:SS zero-padded', () => {
    expect(formatClock(new Date('2026-08-04T09:05:03+09:00'))).toBe('09:05:03');
  });

  it('formats yyyy.mm.dd (요일)', () => {
    // 2026-08-04 is a Tuesday.
    expect(formatCountdownDate(new Date('2026-08-04T19:35:43+09:00'))).toBe(
      '2026.08.04 (화)',
    );
  });
});

describe('remainingUntil', () => {
  it('matches the spec example (docs/design.md, 09.12 18:00 due)', () => {
    const now = new Date('2026-08-04T19:35:43+09:00');
    const due = new Date('2026-09-12T18:00:00+09:00');
    const remaining = remainingUntil(due, now);
    expect(remaining.days).toBe(38);
    expect(remaining.hours).toBe(22);
    expect(remaining.minutes).toBe(24);
  });

  it('floors to zero once the deadline has passed (never negative)', () => {
    const now = new Date('2026-09-13T00:00:00+09:00');
    const due = new Date('2026-09-12T18:00:00+09:00');
    expect(remainingUntil(due, now)).toEqual({
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
    });
  });

  it('is exactly zero at the instant of the deadline', () => {
    const due = new Date('2026-09-12T18:00:00+09:00');
    expect(remainingUntil(due, due)).toEqual({
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
    });
  });
});

describe('ProgramCountdown', () => {
  it('renders a hydration-safe empty placeholder before mount (no `now` override)', () => {
    const html = renderToStaticMarkup(
      <ProgramCountdown
        nextMilestoneLabel="주제 선정 · 저장소 연결"
        dueAt="2026-09-12T18:00:00+09:00"
      />,
    );
    expect(html).toContain('data-slot="program-countdown"');
    expect(html).not.toContain('현재 시각');
  });

  it('renders the full block deterministically when `now` is injected', () => {
    const html = renderToStaticMarkup(
      <ProgramCountdown
        nextMilestoneLabel="주제 선정 · 저장소 연결"
        dueAt="2026-09-12T18:00:00+09:00"
        now={new Date('2026-08-04T19:35:43+09:00')}
      />,
    );
    expect(html).toContain('현재 시각');
    expect(html).toContain('19:35:43');
    expect(html).toContain('2026.08.04 (화)');
    expect(html).toContain('주제 선정 · 저장소 연결 마감까지');
    expect(html).toContain('>38<');
    expect(html).toContain('>22<');
    expect(html).toContain('>24<');
  });

  it('re-exports program schedule countdown props', () => {
    const milestones: readonly CountdownMilestone[] = [
      { label: '리허설 제출 마감', dueAt: '2026-08-05T09:00:00+09:00' },
    ];
    const html = renderToStaticMarkup(
      <ProgramCountdown
        mode="program"
        milestones={milestones}
        now={new Date('2026-08-04T19:35:43+09:00')}
      />,
    );

    expect(html).toContain('리허설 제출 마감');
    expect(html).toContain('2026.08.05 (수) 09:00');
    expect(html.match(/data-countdown-cell=/g)).toHaveLength(4);
  });
});
