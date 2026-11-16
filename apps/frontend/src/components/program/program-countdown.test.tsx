import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  formatCountdownDate,
  ProgramCountdown,
  remainingUntil,
} from './program-countdown';
import { formatClockTime } from './program-countdown-time';

describe('formatCountdownDate', () => {
  it('formats yyyy.mm.dd (요일)', () => {
    expect(formatCountdownDate(new Date('2026-08-04T19:35:43+09:00'))).toBe(
      '2026.08.04 (화)',
    );
  });
});

describe('formatClockTime', () => {
  it('formats HH:MM:SS in Asia/Seoul and never renders midnight as 24:', () => {
    expect(formatClockTime(new Date('2026-08-04T19:35:43+09:00'))).toBe(
      '19:35:43',
    );
    expect(formatClockTime(new Date('2026-08-04T00:00:00+09:00'))).toBe(
      '00:00:00',
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
  const now = new Date('2026-08-04T19:35:43+09:00');

  it('renders a hydration-safe empty placeholder before mount (no `now` override)', () => {
    const html = renderToStaticMarkup(
      <ProgramCountdown
        nextMilestoneLabel="주제 선정 · 저장소 연결"
        dueAt="2026-09-12T18:00:00+09:00"
      />,
    );
    expect(html).toContain('data-slot="program-countdown"');
    expect(html).not.toContain('현재 시간');
  });

  it('renders the clock block above the countdown when `now` is injected', () => {
    const html = renderToStaticMarkup(
      <ProgramCountdown
        nextMilestoneLabel="주제 선정 · 저장소 연결"
        dueAt="2026-09-12T18:00:00+09:00"
        now={now}
      />,
    );
    expect(html).toContain('현재 시간');
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
        now={now}
        untilLabel="다음 수집까지"
      />,
    );
    expect(html).toContain('다음 수집까지');
    expect(html).not.toContain('unused 마감까지');
  });

  it('reads `{label}까지` when the label already ends with 마감, in both modes', () => {
    const programHtml = renderToStaticMarkup(
      <ProgramCountdown
        mode="program"
        milestones={[
          { label: '최종 제출 마감', dueAt: '2026-09-12T18:00:00+09:00' },
        ]}
        now={now}
      />,
    );
    const singleHtml = renderToStaticMarkup(
      <ProgramCountdown
        nextMilestoneLabel="최종 발표 마감"
        dueAt="2026-09-12T18:00:00+09:00"
        now={now}
      />,
    );

    expect(programHtml).toContain('최종 제출 마감까지');
    expect(singleHtml).toContain('최종 발표 마감까지');
    expect(programHtml).not.toContain('마감 마감까지');
    expect(singleHtml).not.toContain('마감 마감까지');
  });

  it('renders the hydration placeholder in program mode before the live clock mounts', () => {
    const html = renderToStaticMarkup(
      <ProgramCountdown mode="program" milestones={[]} />,
    );

    expect(html).toContain('data-slot="program-countdown"');
    expect(html).not.toContain('현재 시간');
    expect(html).not.toContain('마감 일정이 종료되었습니다.');
    expect(html).not.toContain('<ol');
  });

  it('lists every milestone in due order, striking past rows and highlighting the nearest', () => {
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
      <ProgramCountdown mode="program" milestones={milestones} now={now} />,
    );

    expect(milestones).toEqual(originalOrder);
    expect(html).toContain('현재 시간');
    expect(html).toContain('19:35:43');
    expect(html).toContain('2026.08.04 (화)');
    expect(html).toContain('리허설 제출 마감까지');
    expect(html).not.toContain('마감 마감까지');
    expect(html).toContain('8월 5일 09:00 마감');
    expect(html.match(/data-countdown-cell=/g)).toHaveLength(4);
    expect(html).toContain('>0<');
    expect(html).toContain('>13<');
    expect(html).toContain('>24<');
    expect(html).toContain('>17<');
    expect(html).toContain('<ol aria-label="마감 일정"');
    expect(html.match(/<li/g)).toHaveLength(5);
    expect(html.match(/<time/g)).toHaveLength(7);
    expect(html).toMatch(
      /지난 마감[\s\S]*정각 마감[\s\S]*리허설 제출 마감[\s\S]*리허설 제출 마감[\s\S]*최종 발표/,
    );
    expect(html.match(/data-schedule-state="past"/g)).toHaveLength(2);
    expect(html.match(/data-schedule-state="nearest"/g)).toHaveLength(1);
    expect(html.match(/data-schedule-state="future"/g)).toHaveLength(2);
    expect(html).toMatch(
      /<li data-schedule-state="past" class="[^"]*line-through[^"]*text-muted-foreground/,
    );
    expect(html).toMatch(
      /<li data-schedule-state="nearest" class="[^"]*font-semibold text-primary/,
    );
    expect(html.match(/text-destructive line-through/g)).toHaveLength(2);
    expect(html).toContain('08/04 19:35');
    expect(html).toContain('08/05 09:00');
    expect(html).toContain('08/06 10:30');
    expect(html).not.toContain('1/10');
  });

  it('isolates an invalid program milestone date inside the deadline block', () => {
    const html = renderToStaticMarkup(
      <ProgramCountdown
        mode="program"
        milestones={[{ label: '깨진 날짜', dueAt: 'not-a-date' }]}
        now={now}
      />,
    );

    expect(html).toContain('data-slot="program-countdown"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('마감 일정을 표시할 수 없습니다.');
    expect(html).not.toContain('not-a-date');
  });

  it('renders the ended copy under the clock when every milestone is past or none exist', () => {
    const inactiveHtml = renderToStaticMarkup(
      <ProgramCountdown
        mode="program"
        milestones={[
          { label: '지난 마감', dueAt: '2026-08-04T19:35:42+09:00' },
          { label: '정각 마감', dueAt: '2026-08-04T19:35:43+09:00' },
        ]}
        now={now}
      />,
    );
    const emptyHtml = renderToStaticMarkup(
      <ProgramCountdown mode="program" milestones={[]} now={now} />,
    );

    for (const html of [emptyHtml, inactiveHtml]) {
      expect(html).toContain('현재 시간');
      expect(html).toContain('19:35:43');
      expect(html).toContain('마감 일정이 종료되었습니다.');
      expect(html).not.toContain('마감까지');
      expect(html).not.toContain('data-countdown-cell=');
    }
    expect(inactiveHtml).toContain('<ol aria-label="마감 일정"');
    expect(inactiveHtml.match(/data-schedule-state="past"/g)).toHaveLength(2);
    expect(inactiveHtml).not.toContain('data-schedule-state="nearest"');
    expect(emptyHtml).not.toContain('<ol');
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
        now={now}
      />,
    );

    expect(html).toContain('min-w-0 truncate');
    expect(html).toContain('whitespace-nowrap');
    expect(html.match(/아주 긴 한국어 마일스톤 라벨/g)).toHaveLength(2);
    expect(html.match(/<li/g)).toHaveLength(1);
    expect(html.match(/<time/g)).toHaveLength(3);
    expect(html).not.toMatch(/<time[^>]*class="[^"]*truncate/);
  });
});
