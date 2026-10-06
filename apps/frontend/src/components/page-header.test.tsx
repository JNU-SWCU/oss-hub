import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PageHeader } from './page-header';

describe('PageHeader', () => {
  it('renders title and description unchanged when no override is given', () => {
    const html = renderToStaticMarkup(
      <PageHeader
        title="프로그램"
        description="참여할 프로그램을 찾아보세요."
      />,
    );

    expect(html).toContain('프로그램');
    expect(html).toContain('참여할 프로그램을 찾아보세요.');
    expect(html).toContain('text-section');
    expect(html).toContain('sm:text-page');
  });

  it('supports a dynamic ReactNode title, matching the per-filter H1 the programs screen needs', () => {
    const html = renderToStaticMarkup(
      <PageHeader title="모집중인 프로그램" description="교직원 부제" />,
    );

    expect(html).toContain('모집중인 프로그램');
    expect(html).toContain('교직원 부제');
  });

  it('merges titleClassName onto the h1 without dropping the base classes', () => {
    const html = renderToStaticMarkup(
      <PageHeader title="프로그램" titleClassName="text-[30px]" />,
    );

    expect(html).toContain('text-[30px]');
    expect(html).toContain('font-bold');
  });

  it('merges descriptionClassName onto the description paragraph', () => {
    const html = renderToStaticMarkup(
      <PageHeader
        description="부제"
        descriptionClassName="text-[13px]"
        title="프로그램"
      />,
    );

    expect(html).toContain('text-[13px]');
    expect(html).toContain('부제');
  });

  it('still omits the description paragraph entirely when description is absent', () => {
    const html = renderToStaticMarkup(<PageHeader title="프로그램" />);

    expect(html).not.toContain('page-header-description');
  });

  it('renders titleAction outside the heading element', () => {
    const html = renderToStaticMarkup(
      <PageHeader
        title="한빛 팀"
        titleAction={<button aria-label="한빛 팀 수정" />}
      />,
    );

    const heading = html.slice(
      html.indexOf('data-slot="page-header-title"'),
      html.indexOf('</h1>'),
    );
    expect(heading).toContain('한빛 팀');
    expect(heading).not.toContain('수정');
    expect(html).toContain('page-header-title-action');
  });

  it('omits the title action wrapper when no titleAction is given', () => {
    const html = renderToStaticMarkup(<PageHeader title="프로그램" />);

    expect(html).not.toContain('page-header-title-action');
  });
});
