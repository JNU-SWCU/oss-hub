import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DetailPanelLayout } from './detail-panel-layout';

function layoutClass(html: string): string | undefined {
  return html.match(/data-slot="detail-panel-layout"[^>]*class="([^"]*)"/)?.[1];
}

describe('DetailPanelLayout', () => {
  it('renders both the primary and secondary slots', () => {
    const html = renderToStaticMarkup(
      <DetailPanelLayout
        primary={<article>프로그램 상세 본문</article>}
        secondary={<aside>활동그래프 패널</aside>}
      />,
    );

    expect(html).toContain('프로그램 상세 본문');
    expect(html).toContain('활동그래프 패널');
  });

  it('stacked을 생략하면 기존 md: 2열 분할 클래스를 그대로 렌더링한다', () => {
    const html = renderToStaticMarkup(
      <DetailPanelLayout
        primary={<article>본문</article>}
        secondary={<aside>보조</aside>}
      />,
    );

    expect(layoutClass(html)).toMatch(
      /\bmd:grid-cols-\[minmax\(0,2fr\)_minmax\(0,1fr\)\]/,
    );
  });

  it('stacked=false를 명시해도 기존 md: 2열 분할 클래스를 그대로 렌더링한다', () => {
    const html = renderToStaticMarkup(
      <DetailPanelLayout
        stacked={false}
        primary={<article>본문</article>}
        secondary={<aside>보조</aside>}
      />,
    );

    expect(layoutClass(html)).toMatch(
      /\bmd:grid-cols-\[minmax\(0,2fr\)_minmax\(0,1fr\)\]/,
    );
  });

  it('stacked=true면 뷰포트와 무관하게 md: 2열 분할 클래스를 빼고 1열로 렌더링한다', () => {
    const html = renderToStaticMarkup(
      <DetailPanelLayout
        stacked
        primary={<article>본문</article>}
        secondary={<aside>보조</aside>}
      />,
    );

    expect(layoutClass(html)).not.toMatch(/md:grid-cols-/);
  });
});
