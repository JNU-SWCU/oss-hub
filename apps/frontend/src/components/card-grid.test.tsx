import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CardGrid } from './card-grid';

describe('CardGrid', () => {
  it('H1 uses RAM tracks without fixed children while merging custom classes', () => {
    const children = [
      <article key="first">첫 번째 프로그램</article>,
      <article key="second">두 번째 프로그램</article>,
    ];

    const html = renderToStaticMarkup(
      <CardGrid aria-label="프로그램" className="gap-8">
        {children}
      </CardGrid>,
    );
    const className = /data-slot="card-grid"[^>]*class="([^"]*)"/.exec(
      html,
    )?.[1];
    const classes = className?.split(' ') ?? [];

    expect(html).toContain('data-slot="card-grid"');
    expect(classes).toContain('gap-8');
    expect(classes).not.toContain('gap-4');
    expect(classes).toContain('[&amp;&gt;*]:min-h-tile');
    expect(classes).toContain(
      '[grid-template-columns:repeat(auto-fill,minmax(min(17rem,100%),1fr))]',
    );
    expect(html).not.toContain('w-[22rem]');
    expect(html).not.toContain('max-content');
    expect(html).not.toContain('container-type');
    expect(classes).toContain('[&amp;&gt;*]:min-w-0');
    expect(html.indexOf('첫 번째 프로그램')).toBeLessThan(
      html.indexOf('두 번째 프로그램'),
    );
  });
});
