import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { RoleSelectionForm } from './components/role-selection-screen';
import { RoleRequestStatusView } from './components/role-request-screen';
import type { RoleRequest } from './types';

const noOp = () => undefined;

function roleRequest(overrides: Partial<RoleRequest> = {}): RoleRequest {
  return {
    requestedRole: 'STAFF',
    status: 'PENDING',
    requestedAt: '2026-07-21T00:00:00.000Z',
    decidedAt: null,
    rejectionReason: null,
    ...overrides,
  };
}

describe('role onboarding views', () => {
  it('선택한 교직원 역할과 승인 필요 안내를 함께 표시한다', () => {
    // Given
    const selectedRole = 'STAFF';

    // When
    const html = renderToStaticMarkup(
      <RoleSelectionForm
        selectedRole={selectedRole}
        isSubmitting={false}
        errorMessage={null}
        onSelect={noOp}
        onSubmit={noOp}
      />,
    );

    // Then
    expect(html).toContain('data-role="STAFF"');
    expect(html).toContain('data-selected="true"');
    expect(html).toContain('관리자 승인이 필요합니다');
    expect(html).toContain('선택 완료');
  });

  it('반려된 요청은 반려 사유와 재요청 동작을 표시한다', () => {
    // Given
    const rejected = roleRequest({
      status: 'REJECTED',
      decidedAt: '2026-07-21T01:00:00.000Z',
      rejectionReason: '합성 반려 사유',
    });

    // When
    const html = renderToStaticMarkup(
      <RoleRequestStatusView
        request={rejected}
        isRetrying={false}
        errorMessage={null}
        onRefresh={noOp}
        onRetry={noOp}
      />,
    );

    // Then
    expect(html).toContain('data-status="REJECTED"');
    expect(html).toContain('합성 반려 사유');
    expect(html).toContain('다시 승인 요청하기');
  });

  it('승인된 요청은 교직원 화면 이동 경로를 제공한다', () => {
    // Given
    const approved = roleRequest({
      status: 'APPROVED',
      decidedAt: '2026-07-21T01:00:00.000Z',
    });

    // When
    const html = renderToStaticMarkup(
      <RoleRequestStatusView
        request={approved}
        isRetrying={false}
        errorMessage={null}
        onRefresh={noOp}
        onRetry={noOp}
      />,
    );

    // Then
    expect(html).toContain('data-status="APPROVED"');
    expect(html).toContain('href="/staff/dashboard"');
  });
});
