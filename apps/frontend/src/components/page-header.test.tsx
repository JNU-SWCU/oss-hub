import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PageHeader } from './page-header';

// 기존 사용처(23곳)는 title/description만 넘긴다 — 새 props는 선택적이라
// 넘기지 않아도 기존 렌더와 동일해야 한다.
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
});
