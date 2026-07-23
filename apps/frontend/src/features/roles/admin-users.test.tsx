import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AdminUsersView } from './components/admin-users-view';
import {
  requiresRoleChangeConfirmation,
  roleChangeDestination,
} from './role-change-policy';
import type { AdminUser } from './types';

const noOp = () => undefined;
const staff: AdminUser = {
  id: 'synthetic-staff',
  githubLogin: 'synthetic-staff',
  name: '합성 사용자',
  role: 'STAFF',
  accountStatus: 'ACTIVE',
  isSelf: false,
};

describe('관리자 사용자 콘솔', () => {
  it('이름·닉네임 검색, 역할 필터, 재사용 테이블과 44px 컨트롤을 표시한다', () => {
    const html = renderToStaticMarkup(
      <AdminUsersView
        items={[staff]}
        query=""
        role=""
        isLoading={false}
        errorMessage={null}
        successMessage={null}
        processingId={null}
        confirmation={null}
        onQueryChange={noOp}
        onRoleChange={noOp}
        onSearch={noOp}
        onRequestRoleChange={noOp}
        onCancelConfirmation={noOp}
        onConfirmRoleChange={noOp}
        onRetry={noOp}
        onResetFilters={noOp}
      />,
    );

    expect(html).toContain('이름 또는 GitHub 닉네임');
    expect(html).toContain('역할 필터');
    expect(html).toContain('data-slot="data-table"');
    expect(html).toContain('data-slot="row-actions"');
    expect(html).toContain('data-slot="status-badge"');
    expect(html).toContain('h-11');
  });

  it('검색 결과가 없으면 지정된 안내와 필터 초기화 동작을 표시한다', () => {
    const html = renderToStaticMarkup(
      <AdminUsersView
        items={[]}
        query="없는 사용자"
        role="ADMIN"
        isLoading={false}
        errorMessage={null}
        successMessage={null}
        processingId={null}
        confirmation={null}
        onQueryChange={noOp}
        onRoleChange={noOp}
        onSearch={noOp}
        onRequestRoleChange={noOp}
        onCancelConfirmation={noOp}
        onConfirmRoleChange={noOp}
        onRetry={noOp}
        onResetFilters={noOp}
      />,
    );

    expect(html).toContain('검색 결과가 없습니다');
    expect(html).toContain('필터 초기화');
  });

  it('STAFF/ADMIN→STUDENT와 자기 ADMIN 해제만 확인을 요구한다', () => {
    expect(requiresRoleChangeConfirmation(staff, 'STUDENT')).toBe(true);
    expect(
      requiresRoleChangeConfirmation(
        { ...staff, role: 'ADMIN', isSelf: true },
        'STAFF',
      ),
    ).toBe(true);
    expect(requiresRoleChangeConfirmation(staff, 'ADMIN')).toBe(false);
  });

  it('자기 ADMIN 역할을 해제하면 새 역할 홈으로 이동한다', () => {
    const selfAdmin = { ...staff, role: 'ADMIN', isSelf: true } as const;

    expect(roleChangeDestination(selfAdmin, 'STAFF')).toBe('/staff/dashboard');
    expect(roleChangeDestination(selfAdmin, 'STUDENT')).toBe('/dashboard');
    expect(roleChangeDestination(selfAdmin, 'ADMIN')).toBeNull();
    expect(roleChangeDestination(staff, 'STUDENT')).toBeNull();
  });

  it('확인 다이얼로그와 오류 Alert, 성공 toast 상태를 노출한다', () => {
    const html = renderToStaticMarkup(
      <AdminUsersView
        items={[staff]}
        query=""
        role=""
        isLoading={false}
        errorMessage="변경에 실패했습니다."
        successMessage="역할을 변경했습니다."
        processingId={null}
        confirmation={{ user: staff, role: 'STUDENT' }}
        onQueryChange={noOp}
        onRoleChange={noOp}
        onSearch={noOp}
        onRequestRoleChange={noOp}
        onCancelConfirmation={noOp}
        onConfirmRoleChange={noOp}
        onRetry={noOp}
        onResetFilters={noOp}
      />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('변경에 실패했습니다.');
    expect(html).toContain('role="status"');
    expect(html).toContain('역할을 변경했습니다.');
  });
});
