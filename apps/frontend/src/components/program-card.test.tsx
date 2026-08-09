import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProgramCard } from './program-card';

// ProgramCard.dc.html 스펙 검증 — openable 분기, note 렌더, 상태별 팔레트.
describe('ProgramCard', () => {
  it('renders an openable card as a single link with the "자세히" footer', () => {
    const html = renderToStaticMarkup(
      <ProgramCard
        badgeText="진행중"
        category="SW중심대학사업단 · 2026-2학기"
        href="/programs/program%3Aoss"
        period="2026.09.01 ~ 12.19 · 팀 단위"
        status="in_progress"
        title="2026-2학기 오픈소스 SW 프로젝트"
      />,
    );

    expect(html).toContain('<a');
    expect(html.match(/<a\b/g)).toHaveLength(1);
    expect(html).toContain('href="/programs/program%3Aoss"');
    expect(html).toContain('자세히 ›');
    expect(html).toContain('2026-2학기 오픈소스 SW 프로젝트');
    expect(html).toContain('진행중');
    expect(html).toContain('pr-[88px] break-keep');
  });

  it('renders an ended card without a link, without the footer, and without a working href', () => {
    const html = renderToStaticMarkup(
      <ProgramCard
        badgeText="종료"
        category="SW중심대학사업단 · 2026-1학기"
        href="/programs/program%3Aoss"
        period="2026.03.02 ~ 06.19 · 종료"
        status="ended"
        title="2026-1학기 오픈소스 기여 프로그램"
      />,
    );

    expect(html).not.toContain('<a');
    expect(html).not.toContain('자세히');
    expect(html).not.toContain('href="/programs/program%3Aoss"');
    // 스크린리더에도 클릭 불가임이 전달돼야 한다.
    expect(html).toContain('열람할 수 없습니다');
  });

  it('does not render the note row when note is absent', () => {
    const html = renderToStaticMarkup(
      <ProgramCard
        badgeText="모집중"
        href="/programs/x"
        status="recruiting"
        title="2026 동계 오픈소스 해커톤"
      />,
    );

    expect(html).not.toContain('<svg');
    expect(html).not.toContain('열람할 수 없습니다');
  });

  it('renders a plain note without the team icon when noteIcon is omitted', () => {
    const html = renderToStaticMarkup(
      <ProgramCard
        badgeText="모집중"
        href="/programs/x"
        note="지원 3건 · 승인 대기 1건"
        status="recruiting"
        title="2026 동계 오픈소스 해커톤"
      />,
    );

    expect(html).toContain('지원 3건 · 승인 대기 1건');
    expect(html).not.toContain('<svg');
  });

  it('renders the team icon before the note text when noteIcon is "team"', () => {
    const html = renderToStaticMarkup(
      <ProgramCard
        badgeText="진행중"
        note="오픈소스 4조"
        noteIcon="team"
        status="in_progress"
        title="2026-2학기 오픈소스 SW 프로젝트"
      />,
    );

    expect(html).toContain('<svg');
    expect(html).toContain('오픈소스 4조');
    expect(html.indexOf('<svg')).toBeLessThan(html.indexOf('오픈소스 4조'));
  });

  it('keeps the visible badge text out of the link name and adds a labeled status prefix instead', () => {
    const html = renderToStaticMarkup(
      <ProgramCard
        badgeText="승인 대기"
        href="/programs/hackathon"
        status="pending"
        title="2026 동계 오픈소스 해커톤"
      />,
    );

    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('상태: 승인 대기.');
  });

  it.each([
    ['recruiting', 'status-recruiting-bg'],
    ['in_progress', 'status-approved-bg'],
    ['pending', 'status-pending-bg'],
    ['approved', 'status-approved-bg'],
    ['rejected', 'status-rejected-bg'],
    ['ended', 'status-closed-bg'],
    ['upcoming', 'status-closed-bg'],
  ] as const)(
    'maps status "%s" to the "%s" badge palette',
    (status, expectedBgClass) => {
      const html = renderToStaticMarkup(
        <ProgramCard badgeText="x" href="/x" status={status} title="t" />,
      );

      expect(html).toContain(expectedBgClass);
    },
  );

  it('does not wrap an ended card in a link even without an href', () => {
    const html = renderToStaticMarkup(
      <ProgramCard badgeText="종료" status="ended" title="종료된 프로그램" />,
    );

    expect(html).not.toContain('<a');
    expect(html).toContain('cursor-default');
  });
});
