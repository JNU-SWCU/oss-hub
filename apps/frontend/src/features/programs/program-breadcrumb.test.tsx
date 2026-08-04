import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProgramBreadcrumb } from './program-breadcrumb';

describe('ProgramBreadcrumb', () => {
  it('renders 프로그램 › {programName} with no section', () => {
    const html = renderToStaticMarkup(
      <ProgramBreadcrumb programName="2026-2학기 오픈소스 SW 프로젝트" />,
    );
    expect(html).toContain('프로그램 › 2026-2학기 오픈소스 SW 프로젝트');
  });

  it('appends section as a third crumb', () => {
    const html = renderToStaticMarkup(
      <ProgramBreadcrumb
        programName="2026-2학기 오픈소스 SW 프로젝트"
        section="참여 팀"
      />,
    );
    expect(html).toContain(
      '프로그램 › 2026-2학기 오픈소스 SW 프로젝트 › 참여 팀',
    );
  });

  it('is plain text — not a link or button', () => {
    const html = renderToStaticMarkup(
      <ProgramBreadcrumb programName="테스트 프로그램" />,
    );
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('<button');
  });

  it('carries the muted-foreground text style', () => {
    const html = renderToStaticMarkup(
      <ProgramBreadcrumb programName="테스트 프로그램" />,
    );
    expect(html).toContain('text-muted-foreground');
    expect(html).toContain('data-slot="program-breadcrumb"');
  });
});
