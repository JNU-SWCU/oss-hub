import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../_shell/role-panel-shell', () => ({
  RolePanelShell: ({
    allow,
    children,
  }: {
    readonly allow: readonly string[];
    readonly children: ReactNode;
  }) => <section data-allow={allow.join(',')}>{children}</section>,
}));

vi.mock('@/features/programs/program-application-detail-page', () => ({
  ProgramApplicationDetailPage: ({
    programId,
    applicationId,
  }: {
    readonly programId: string;
    readonly applicationId: string;
  }) => <div data-program-id={programId} data-application-id={applicationId} />,
}));

import ProgramApplicationDetailRoute from './page';

describe('ProgramApplicationDetailRoute access contract', () => {
  it('STAFF·ADMIN 에게만 열고 경로 값을 디코딩해 화면에 넘긴다', async () => {
    const html = renderToStaticMarkup(
      await ProgramApplicationDetailRoute({
        params: Promise.resolve({
          id: 'program%3Abasic',
          applicationId: 'app%3A1',
        }),
      }),
    );

    expect(html).toContain('data-allow="STAFF,ADMIN"');
    // 인코딩된 채로 넘기면 조회가 다른 id 를 찾는다.
    expect(html).toContain('data-program-id="program:basic"');
    expect(html).toContain('data-application-id="app:1"');
    expect(html).not.toContain('STUDENT');
  });

  it('디코딩할 수 없는 값은 원문 그대로 넘긴다', async () => {
    // `%` 하나만 있는 주소를 손으로 치면 decodeURIComponent 가 던진다. 화면이
    // 통째로 죽는 대신 백엔드가 404 로 답하게 둔다.
    const html = renderToStaticMarkup(
      await ProgramApplicationDetailRoute({
        params: Promise.resolve({ id: 'program-1', applicationId: 'app%' }),
      }),
    );

    expect(html).toContain('data-application-id="app%"');
  });
});
