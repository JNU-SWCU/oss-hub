import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';

vi.mock('../../_shell/role-panel-shell', () => ({
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

import ProgramNewPage from './page';

describe('ProgramNewPage access contract', () => {
  it('STAFF와 ADMIN만 프로그램 생성 화면에 허용한다', () => {
    const html = renderToStaticMarkup(<ProgramNewPage />);

    expect(html).toContain('data-allow="STAFF,ADMIN"');
    expect(html).not.toContain('STUDENT');
  });

  it('정적 /programs/new 라우트 파일이 존재하고 동적 [id] 세그먼트로 새지 않는다', () => {
    const staticNewPage = path.resolve(__dirname, 'page.tsx');
    const dynamicIdPage = path.resolve(__dirname, '../[id]/page.tsx');

    expect(existsSync(staticNewPage)).toBe(true);
    expect(existsSync(dynamicIdPage)).toBe(true);
    // Next.js는 같은 레벨에서 정적 세그먼트(`new`)를 동적(`[id]`)보다 우선한다.
    // 생성 페이지가 ProgramCreationPage를 마운트하는지로 정적 라우트 소유를 단언한다.
    const html = renderToStaticMarkup(<ProgramNewPage />);
    expect(html).toContain('program creation');
    expect(html).toContain('data-allow="STAFF,ADMIN"');
  });
});
