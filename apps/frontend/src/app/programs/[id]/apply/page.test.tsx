import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  routeProps: [] as Record<string, unknown>[],
}));

vi.mock('../../../_shell/role-gate', () => ({
  RoleGate: ({
    allow,
    children,
  }: {
    readonly allow: readonly string[];
    readonly children: ReactNode;
  }) => (
    <section data-shell="role-gate" data-allow={allow.join(',')}>
      {children}
    </section>
  ),
}));

vi.mock('./program-apply-route', () => ({
  ProgramApplyRoute: (props: Record<string, unknown>) => {
    mocks.routeProps.push(props);
    return <div data-apply-program-id={String(props.programId)}>신청 화면</div>;
  },
}));

import ProgramApplyRoutePage from './page';

/** Next는 선언하지 않은 질의 문자열을 그대로 무시한다 — 그 사실을 증명하기 위한 캐스팅. */
const pageWithUnknownQuery = ProgramApplyRoutePage as unknown as (props: {
  readonly params: Promise<{ readonly id: string }>;
  readonly searchParams?: Promise<Record<string, string>>;
}) => Promise<ReactElement>;

describe('ProgramApplyRoutePage 라우트 계약', () => {
  beforeEach(() => {
    mocks.routeProps.length = 0;
  });

  it('학생 게이트 안에서 디코드한 시드 programId만 넘긴다', async () => {
    const page = await ProgramApplyRoutePage({
      params: Promise.resolve({ id: 'program%3Aseed-1' }),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain('data-allow="student"');
    expect(html).toContain('data-apply-program-id="program:seed-1"');
    expect(mocks.routeProps).toHaveLength(1);
    expect(mocks.routeProps[0]).toEqual({ programId: 'program:seed-1' });
  });

  it('teamId 질의가 들어와도 신청 화면 입력으로 만들지 않는다', async () => {
    const page = await pageWithUnknownQuery({
      params: Promise.resolve({ id: 'program%3Aseed-1' }),
      searchParams: Promise.resolve({ teamId: 'team:other' }),
    });
    const html = renderToStaticMarkup(page);

    expect(html).not.toContain('team:other');
    expect(mocks.routeProps[0]).toEqual({ programId: 'program:seed-1' });
    expect(Object.keys(mocks.routeProps[0])).toEqual(['programId']);
  });
});
