import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { AdminAccessDetail } from './admin-access-api';
import { parseAdminAccessMutationResponse } from './admin-access-api';
import {
  buildAdminAccessPatchRequest,
  isAdminAccessMutationAvailable,
} from './admin-access-mutation-policy';
import { adminAccessRevocation } from './admin-access-revocation';
import {
  AdminAccessDetailContentForState,
  type AdminAccessDetailMutationController,
} from './components/admin-access-detail-view';

const noOp = () => undefined;

function staffDetail(): AdminAccessDetail {
  return {
    id: 'synthetic-staff',
    githubLogin: 'synthetic-staff',
    name: '합성 교직원',
    role: 'STAFF',
    accountStatus: 'ACTIVE',
    isSelf: false,
    isProfileComplete: true,
    pendingRequest: null,
    lastLoginAt: null,
    profile: {
      name: '합성 교직원',
      studentId: null,
      department: '합성 학과',
      isComplete: true,
    },
  };
}

function revokeMutation(): AdminAccessDetailMutationController {
  return {
    confirmAction: 'REVOKE',
    processingAction: null,
    rejectReason: '',
    dialogError: null,
    conflictNotice: null,
    successMessage: null,
    onRequestAction: noOp,
    onCancel: noOp,
    onConfirm: noOp,
    onReasonChange: noOp,
  };
}

describe('#184 교직원 권한 회수 프런트 계약', () => {
  it('백엔드의 REVOKED 성공 응답을 정상적으로 파싱한다', () => {
    // Given & When
    const response = parseAdminAccessMutationResponse({
      id: 'synthetic-staff',
      role: null,
      accountStatus: 'ACTIVE',
      pendingRequest: null,
      decidedRequest: {
        id: 'synthetic-revoked-request',
        status: 'REVOKED',
      },
    });

    // Then
    expect(response.role).toBeNull();
    expect(response.decidedRequest?.status).toBe('REVOKED');
  });

  it('STAFF 회수는 사용할 수 있고 역할을 null로 비우는 CAS 요청을 만든다', () => {
    // Given
    const detail = staffDetail();

    // When
    const request = buildAdminAccessPatchRequest('REVOKE', detail);

    // Then
    expect(isAdminAccessMutationAvailable('REVOKE', detail)).toBe(true);
    expect(request.expectedRole).toBe('STAFF');
    expect(request.desiredRole).toBeNull();
    expect(request.desiredAccountStatus).toBe('ACTIVE');
  });

  it('회수 작업과 확인 대화상자는 학생 강등이 아니라 역할 제거를 안내한다', () => {
    // Given & When
    const dialogMarkup = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: staffDetail(),
          history: {
            roleRequests: { items: [], page: 1, limit: 20, total: 0 },
            loginHistory: { items: [], page: 1, limit: 20, total: 0 },
          },
        }}
        onRetry={noOp}
        mutation={revokeMutation()}
      />,
    );

    // Then
    expect(adminAccessRevocation('STAFF')?.actionCaption).toBe(
      '교직원 권한 제거',
    );
    expect(dialogMarkup).toContain('역할을 비웁니다');
    expect(dialogMarkup).not.toContain('학생으로 강등');
  });
});
