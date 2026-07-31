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

  // 안내가 선택 시점에 새로 끼어들면 그 아래 제출 버튼이 밀린다. 자리를 미리
  // 잡아 두었는지를 마크업 수준에서 못박는다.
  it('역할 선택 전에도 안내 자리를 같은 슬롯으로 미리 확보한다', () => {
    // Given
    const renderForm = (selectedRole: 'STAFF' | null) =>
      renderToStaticMarkup(
        <RoleSelectionForm
          selectedRole={selectedRole}
          isSubmitting={false}
          errorMessage={null}
          onSelect={noOp}
          onSubmit={noOp}
        />,
      );

    // When
    const emptyHtml = renderForm(null);
    const staffHtml = renderForm('STAFF');

    // Then
    const slot = 'data-slot="role-guidance"';
    expect(emptyHtml).toContain(slot);
    expect(staffHtml).toContain(slot);
    expect(emptyHtml).toContain(
      '역할을 고르면 다음 단계 안내가 여기에 표시됩니다.',
    );
    expect(staffHtml).toContain('승인 후 교직원 기능을 사용할 수 있습니다');
  });

  // 카드 높이는 서로 맞춰야 한다 — 한쪽에만 있는 줄이 생기면 어긋난다.
  it('두 역할 카드 모두 승인 여부 한 줄을 가진다', () => {
    // Given
    const html = renderToStaticMarkup(
      <RoleSelectionForm
        selectedRole={null}
        isSubmitting={false}
        errorMessage={null}
        onSelect={noOp}
        onSubmit={noOp}
      />,
    );

    // Then
    expect(html).toContain('승인 없이 바로 시작합니다');
    expect(html).toContain('관리자 승인이 필요합니다');
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

  it('회수된 요청 응답도 안전하게 역할 재선택 경로를 표시한다', () => {
    // Given
    const revoked = roleRequest({
      status: 'REVOKED',
      decidedAt: '2026-07-21T01:00:00.000Z',
    });

    // When
    const html = renderToStaticMarkup(
      <RoleRequestStatusView
        request={revoked}
        isRetrying={false}
        errorMessage={null}
        onRefresh={noOp}
        onRetry={noOp}
      />,
    );

    // Then
    expect(html).toContain('data-status="REVOKED"');
    expect(html).toContain('href="/onboarding/role"');
  });
});
