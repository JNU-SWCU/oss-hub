import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { StaffRequestsView } from './components/staff-requests-view';
import type { StaffRoleRequest } from './types';

const noOp = () => undefined;

function pendingRequest(): StaffRoleRequest {
  return {
    id: 'synthetic-request',
    githubLogin: 'synthetic-staff',
    requestedRole: 'STAFF',
    status: 'PENDING',
    requestedAt: '2026-07-21T00:00:00.000Z',
    decidedAt: null,
    decidedBy: null,
    rejectionReason: null,
  };
}

function approvedRequest(): StaffRoleRequest {
  return {
    ...pendingRequest(),
    status: 'APPROVED',
    decidedAt: '2026-07-21T01:00:00.000Z',
    decidedBy: 'synthetic-admin',
  };
}

describe('StaffRequestsView', () => {
  it('PENDING 행에 프로필 링크와 승인·반려 동작을 표시한다', () => {
    // Given
    const request = pendingRequest();

    // When
    const html = renderToStaticMarkup(
      <StaffRequestsView
        items={[request]}
        status="PENDING"
        query=""
        page={1}
        limit={20}
        total={1}
        isLoading={false}
        errorMessage={null}
        processingIds={new Set()}
        rejectingRequest={null}
        revokingRequest={null}
        rejectionReason=""
        onStatusChange={noOp}
        onQueryChange={noOp}
        onSearch={noOp}
        onPageChange={noOp}
        onApprove={noOp}
        onOpenReject={noOp}
        onCloseReject={noOp}
        onRejectionReasonChange={noOp}
        onConfirmReject={noOp}
        onOpenRevoke={noOp}
        onCloseRevoke={noOp}
        onConfirmRevoke={noOp}
        onRetry={noOp}
      />,
    );

    // Then
    expect(html).toContain('href="https://github.com/synthetic-staff"');
    expect(html).toContain('승인');
    expect(html).toContain('반려');
  });

  it('반려 다이얼로그에 필수 사유 입력과 확정 동작을 표시한다', () => {
    // Given
    const request = pendingRequest();

    // When
    const html = renderToStaticMarkup(
      <StaffRequestsView
        items={[request]}
        status="PENDING"
        query=""
        page={1}
        limit={20}
        total={1}
        isLoading={false}
        errorMessage={null}
        processingIds={new Set()}
        rejectingRequest={request}
        revokingRequest={null}
        rejectionReason="합성 반려 사유"
        onStatusChange={noOp}
        onQueryChange={noOp}
        onSearch={noOp}
        onPageChange={noOp}
        onApprove={noOp}
        onOpenReject={noOp}
        onCloseReject={noOp}
        onRejectionReasonChange={noOp}
        onConfirmReject={noOp}
        onOpenRevoke={noOp}
        onCloseRevoke={noOp}
        onConfirmRevoke={noOp}
        onRetry={noOp}
      />,
    );

    // Then
    expect(html).toContain('role="dialog"');
    expect(html).toContain('교직원 요청 반려');
    expect(html).toContain('거절 사유');
    expect(html).toContain('반려 확정');
  });

  it('APPROVED 행에 회수 동작과 확인 다이얼로그를 표시한다', () => {
    // Given
    const request = approvedRequest();

    // When
    const html = renderToStaticMarkup(
      <StaffRequestsView
        items={[request]}
        status="APPROVED"
        query=""
        page={1}
        limit={20}
        total={1}
        isLoading={false}
        errorMessage={null}
        processingIds={new Set()}
        rejectingRequest={null}
        revokingRequest={request}
        rejectionReason=""
        onStatusChange={noOp}
        onQueryChange={noOp}
        onSearch={noOp}
        onPageChange={noOp}
        onApprove={noOp}
        onOpenReject={noOp}
        onCloseReject={noOp}
        onRejectionReasonChange={noOp}
        onConfirmReject={noOp}
        onOpenRevoke={noOp}
        onCloseRevoke={noOp}
        onConfirmRevoke={noOp}
        onRetry={noOp}
      />,
    );

    // Then
    expect(html).toContain('교직원 역할 회수');
    expect(html).toContain('교직원 권한이 즉시 제거됩니다');
    expect(html).toContain('회수 확정');
  });

  it('PENDING 목록이 비면 상태별 빈 안내를 표시한다', () => {
    // Given
    const items: StaffRoleRequest[] = [];

    // When
    const html = renderToStaticMarkup(
      <StaffRequestsView
        items={items}
        status="PENDING"
        query="synthetic"
        page={1}
        limit={20}
        total={0}
        isLoading={false}
        errorMessage={null}
        processingIds={new Set()}
        rejectingRequest={null}
        revokingRequest={null}
        rejectionReason=""
        onStatusChange={noOp}
        onQueryChange={noOp}
        onSearch={noOp}
        onPageChange={noOp}
        onApprove={noOp}
        onOpenReject={noOp}
        onCloseReject={noOp}
        onRejectionReasonChange={noOp}
        onConfirmReject={noOp}
        onOpenRevoke={noOp}
        onCloseRevoke={noOp}
        onConfirmRevoke={noOp}
        onRetry={noOp}
      />,
    );

    // Then
    expect(html).toContain('승인 대기 중인 요청이 없습니다');
    expect(html).toContain('필터 초기화');
  });
});
