import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  formatClock,
  formatCountdownDate,
  ProgramCountdown,
  remainingUntil,
} from './program-countdown';

describe('formatClock / formatCountdownDate', () => {
  it('formats HH:MM:SS zero-padded', () => {
    expect(formatClock(new Date('2026-08-04T09:05:03+09:00'))).toBe('09:05:03');
  });

  it('formats yyyy.mm.dd (요일)', () => {
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

  it('uses untilLabel when provided — ranking copy', () => {
    const html = renderToStaticMarkup(
      <ProgramCountdown
        nextMilestoneLabel="unused"
        dueAt="2026-09-12T18:00:00+09:00"
        now={new Date('2026-08-04T19:35:43+09:00')}
        untilLabel="다음 수집까지"
      />,
    );
    expect(html).toContain('다음 수집까지');
    expect(html).not.toContain('unused 마감까지');
  });

  it('renders the hydration placeholder in program mode before the live clock mounts', () => {
    const html = renderToStaticMarkup(
      <ProgramCountdown mode="program" milestones={[]} />,
    );

    expect(html).toContain('data-slot="program-countdown"');
    expect(html).not.toContain('현재 시각');
    expect(html).not.toContain('마감 일정이 종료되었습니다.');
  });

  it('renders program mode as the next active milestone and all future rows', () => {
    const milestones = [
      { label: '지난 마감', dueAt: '2026-08-04T19:35:42+09:00' },
      { label: '정각 마감', dueAt: '2026-08-04T19:35:43+09:00' },
      { label: '최종 발표', dueAt: '2026-08-06T10:30:00+09:00' },
      { label: '리허설 제출 마감', dueAt: '2026-08-05T09:00:00+09:00' },
      { label: '리허설 제출 마감', dueAt: '2026-08-05T09:00:00+09:00' },
    ] as const;
    const originalOrder = milestones.map(({ label, dueAt }) => ({
      label,
      dueAt,
    }));

    const html = renderToStaticMarkup(
      <ProgramCountdown
        mode="program"
        milestones={milestones}
        now={new Date('2026-08-04T19:35:43+09:00')}
      />,
    );

    expect(milestones).toEqual(originalOrder);
    expect(html).toContain('리허설 제출 마감');
    expect(html).toContain('2026.08.05 (수) 09:00');
    expect(html).toContain('<ul');
    expect(html.match(/<li/g)).toHaveLength(3);
    expect(html.match(/<time/g)).toHaveLength(4);
    expect(html.match(/data-countdown-cell=/g)).toHaveLength(4);
    expect(html).toContain('>0<');
    expect(html).toContain('>13<');
    expect(html).toContain('>24<');
    expect(html).toContain('>17<');
    expect(html).toMatch(
      /리허설 제출 마감[\s\S]*리허설 제출 마감[\s\S]*최종 발표/,
    );
    expect(html).not.toContain('지난 마감');
    expect(html).not.toContain('정각 마감');
    expect(html).not.toContain('1/10');
  });

  it('isolates an invalid program milestone date inside the deadline block', () => {
    const html = renderToStaticMarkup(
      <ProgramCountdown
        mode="program"
        milestones={[{ label: '깨진 날짜', dueAt: 'not-a-date' }]}
        now={new Date('2026-08-04T19:35:43+09:00')}
      />,
    );

    expect(html).toContain('data-slot="program-countdown"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('마감 일정을 표시할 수 없습니다.');
    expect(html).not.toContain('not-a-date');
  });

  it('renders the ended copy when program mode is empty or has no active milestones', () => {
    const inactiveHtml = renderToStaticMarkup(
      <ProgramCountdown
        mode="program"
        milestones={[
          { label: '지난 마감', dueAt: '2026-08-04T19:35:42+09:00' },
          { label: '정각 마감', dueAt: '2026-08-04T19:35:43+09:00' },
        ]}
        now={new Date('2026-08-04T19:35:43+09:00')}
      />,
    );
    const emptyHtml = renderToStaticMarkup(
      <ProgramCountdown
        mode="program"
        milestones={[]}
        now={new Date('2026-08-04T19:35:43+09:00')}
      />,
    );

    for (const html of [emptyHtml, inactiveHtml]) {
      expect(html).toContain('마감 일정이 종료되었습니다.');
      expect(html).not.toContain('data-countdown-cell=');
      expect(html).not.toContain('<ul');
    }
  });

  it('keeps long Korean labels truncatable and deadline dates uncut', () => {
    const html = renderToStaticMarkup(
      <ProgramCountdown
        mode="program"
        milestones={[
          {
            label:
              '아주 긴 한국어 마일스톤 라벨이 사이드바 폭보다 길어질 때의 제출 마감',
            dueAt: '2026-08-05T09:00:00+09:00',
          },
        ]}
        now={new Date('2026-08-04T19:35:43+09:00')}
      />,
    );

    expect(html).toContain('class="min-w-0 truncate"');
    expect(html).toContain('shrink-0 whitespace-nowrap tabular-nums');
    expect(html).not.toMatch(/<time[^>]*class="[^"]*truncate/);
  });
});
