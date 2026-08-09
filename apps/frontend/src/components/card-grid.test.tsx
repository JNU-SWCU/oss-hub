import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CardGrid } from './card-grid';

describe('CardGrid', () => {
  it('preserves its bounded layout contract while merging custom classes', () => {
    // Given
    const children = [
      <article key="first">첫 번째 프로그램</article>,
      <article key="second">두 번째 프로그램</article>,
    ];

    // When
    const html = renderToStaticMarkup(
      <CardGrid aria-label="프로그램" className="gap-8">
        {children}
      </CardGrid>,
    );
    const className = /data-slot="card-grid"[^>]*class="([^"]*)"/.exec(
      html,
    )?.[1];
    const classes = className?.split(' ') ?? [];

    // Then
    expect(html).toContain('data-slot="card-grid"');
    expect(classes).toContain('gap-8');
    expect(classes).not.toContain('gap-4');
    expect(classes).toContain('[&amp;&gt;*]:min-h-tile');
    expect(classes).toContain(
      '[grid-template-columns:repeat(auto-fill,minmax(min(18rem,100%),max-content))]',
    );
    expect(classes).toContain('[&amp;&gt;*]:w-[22rem]');
    expect(classes).toContain('[&amp;&gt;*]:max-w-full');
    expect(html.indexOf('첫 번째 프로그램')).toBeLessThan(
      html.indexOf('두 번째 프로그램'),
    );
  });
});
