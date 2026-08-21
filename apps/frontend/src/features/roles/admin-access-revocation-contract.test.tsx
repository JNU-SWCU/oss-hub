import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  adminDetail,
  adminHistory,
  adminMutation,
} from './admin-access-detail-test-fixture';
import { AdminAccessDetailContentForState } from './components/admin-access-detail-view';
import type { AdminAccessMutationAction } from './admin-access-mutation-policy';

function renderDialog(action: AdminAccessMutationAction): string {
  return renderToStaticMarkup(
    <AdminAccessDetailContentForState
      state={{
        kind: 'ready',
        detail: adminDetail({
          memberKind: 'STAFF',
          hasStaffAccess: true,
          hasAdminAccess: true,
        }),
        history: adminHistory(),
      }}
      onRetry={() => {}}
      mutation={adminMutation({ confirmAction: action })}
    />,
  );
}

describe('independent authority confirmation contract', () => {
  it.each([
    ['GRANT_STAFF_ACCESS', '교직원 접근 허용', '허용 확정'],
    ['REVOKE_STAFF_ACCESS', '교직원 접근 회수', '회수 확정'],
    ['GRANT_ADMIN_ACCESS', '관리자 접근 허용', '허용 확정'],
    ['REVOKE_ADMIN_ACCESS', '관리자 접근 회수', '회수 확정'],
  ] as const)('renders exact %s action copy', (action, title, confirm) => {
    const html = renderDialog(action);
    expect(html).toContain(title);
    expect(html).toContain(confirm);
    expect(html).toContain('다른 접근 권한은 변경되지 않습니다.');
  });

  it.each(['REVOKE_STAFF_ACCESS', 'REVOKE_ADMIN_ACCESS'] as const)(
    'marks %s as destructive',
    (action) => {
      expect(renderDialog(action)).toContain('data-variant="destructive"');
    },
  );

  it.each(['GRANT_STAFF_ACCESS', 'GRANT_ADMIN_ACCESS'] as const)(
    'keeps %s non-destructive',
    (action) => {
      expect(renderDialog(action)).not.toContain('data-variant="destructive"');
    },
  );
});
