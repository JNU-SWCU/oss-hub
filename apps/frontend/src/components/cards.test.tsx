import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CardGrid } from './card-grid';
import { ProgramCard } from '@/features/programs/program-card';
import { StatusBadge } from './status-badge';
import { EmptyState } from './empty-state';

describe('card components', () => {
  it('renders CardGrid with repeated ProgramCard + StatusBadge children', () => {
    const html = renderToStaticMarkup(
      <CardGrid>
        <ProgramCard
          title="캡스톤 디자인 경진대회"
          category="캡스톤/산학"
          period="2026.03 - 2026.06"
          status="recruiting"
          badgeText="모집중"
        />
        <ProgramCard
          title="SW 해커톤"
          category="경진대회/해커톤"
          period="2026.05"
          status="ended"
          badgeText="마감"
        />
      </CardGrid>,
    );

    expect(html).toContain('card-grid');
    expect(html).toContain('캡스톤 디자인 경진대회');
    expect(html).toContain('모집중');
    expect(html).toContain('마감');
  });

  it('renders all StatusBadge variants without throwing', () => {
    const html = renderToStaticMarkup(
      <>
        <StatusBadge variant="recruiting">모집중</StatusBadge>
        <StatusBadge variant="closed">마감</StatusBadge>
        <StatusBadge variant="pending">대기</StatusBadge>
        <StatusBadge variant="approved">승인</StatusBadge>
        <StatusBadge variant="rejected">반려</StatusBadge>
      </>,
    );

    expect(html).toContain('대기');
    expect(html).toContain('승인');
    expect(html).toContain('반려');
  });

  it('renders a linked ProgramCard as one accessible card link', () => {
    const html = renderToStaticMarkup(
      <ProgramCard
        href="/programs/program%3Aoss"
        title="OSS 기여 챌린지"
        category="오픈소스"
        period="2026.08 - 2026.09"
        status="recruiting"
        badgeText="모집중"
        note="JNU SWCU"
        noteIcon="team"
      />,
    );

    expect(html).toContain('<a');
    expect(html).toContain('href="/programs/program%3Aoss"');
    expect(html.match(/<a\b/g)).toHaveLength(1);
    expect(html).toContain('JNU SWCU');
    expect(html).toContain('자세히 ›');
  });

  it('renders a large StatusBadge for prominent card status', () => {
    const html = renderToStaticMarkup(
      <StatusBadge size="lg" variant="recruiting">
        모집중
      </StatusBadge>,
    );

    expect(html).toContain('px-4');
    expect(html).toContain('py-2');
    expect(html).toContain('text-base');

    expect(html).toContain('h-auto');
    expect(html).not.toContain('h-tag');
  });

  it('renders EmptyState with icon, description, and action slot', () => {
    const html = renderToStaticMarkup(
      <EmptyState
        icon={<span data-testid="icon">□</span>}
        title="진행 중인 프로그램이 없습니다"
        description="새 프로그램이 열리면 여기에 표시됩니다."
        action={<button type="button">전체 보기</button>}
      />,
    );

    expect(html).toContain('진행 중인 프로그램이 없습니다');
    expect(html).toContain('새 프로그램이 열리면 여기에 표시됩니다.');
    expect(html).toContain('전체 보기');
  });
});
