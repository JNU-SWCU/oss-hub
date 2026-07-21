import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../_shell/role-panel-shell', () => ({
  RolePanelShell: ({
    allow,
    children,
  }: {
    readonly allow: readonly string[];
    readonly children: ReactNode;
  }) => <section data-allow={allow.join(',')}>{children}</section>,
}));

vi.mock('@/features/programs/program-creation-page', () => ({
  ProgramCreationPage: () => <div>program creation</div>,
}));

import StaffProgramNewPage from './page';

describe('StaffProgramNewPage access contract', () => {
  it('STAFF와 ADMIN만 프로그램 생성 화면에 허용한다', () => {
    // Given / When
    const html = renderToStaticMarkup(<StaffProgramNewPage />);

    // Then
    expect(html).toContain('data-allow="STAFF,ADMIN"');
    expect(html).not.toContain('STUDENT');
  });
});
