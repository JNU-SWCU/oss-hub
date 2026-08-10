import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { AdminAccessDetail, AdminAccessHistory } from './admin-access-api';
import { parseAdminAccessMutationResponse } from './admin-access-api';
import type { AdminAccessMutationAction } from './admin-access-mutation-policy';
import {
  adminAccessRoleChangeDialogDescription,
  isAdminAccessRoleDowngrade,
} from './admin-access-revocation';
import {
  AdminAccessDetailContentForState,
  type AdminAccessDetailMutationController,
} from './components/admin-access-detail-view';

/**
 * #184 "교직원 권한 회수" 프런트 계약의 후속(PR04G, 직접 역할 선택 방식으로
 * 재설계) — GRANT/REVOKE 두 액션 대신 관리자가 세 역할 중 아무거나 직접
 * 골라 CAS PATCH를 보낸다. 회수(강등) 여부는 더 이상 별도 액션이 아니라
 * "고른 역할이 지금보다 낮은 등급인가"로만 판단한다.
 */

describe('parseAdminAccessMutationResponse — REVOKED decidedRequest 파싱(기존 계약 유지)', () => {
  it('decidedRequest.status가 REVOKED인 응답을 그대로 파싱한다', () => {
    const response = parseAdminAccessMutationResponse({
      id: 'target',
      role: 'STUDENT',
      accountStatus: 'ACTIVE',
      pendingRequest: null,
      decidedRequest: { id: 'req-1', status: 'REVOKED' },
    });

    expect(response.decidedRequest).toEqual({ id: 'req-1', status: 'REVOKED' });
  });
});

describe('isAdminAccessRoleDowngrade — 목표 등급이 현재보다 낮은지만 본다', () => {
  it('ADMIN → STAFF는 강등이다', () => {
    expect(isAdminAccessRoleDowngrade('ADMIN', 'STAFF')).toBe(true);
  });

  it('STAFF → STUDENT는 강등이다', () => {
    expect(isAdminAccessRoleDowngrade('STAFF', 'STUDENT')).toBe(true);
  });

  it('STAFF → ADMIN은 강등이 아니다(승격)', () => {
    expect(isAdminAccessRoleDowngrade('STAFF', 'ADMIN')).toBe(false);
  });

  it('같은 역할을 다시 고르는 것은 강등이 아니다', () => {
    expect(isAdminAccessRoleDowngrade('STAFF', 'STAFF')).toBe(false);
  });

  it('미지정(null)에서 STAFF로 첫 배정은 강등이 아니다', () => {
    expect(isAdminAccessRoleDowngrade(null, 'STAFF')).toBe(false);
  });

  it('미지정(null)에서 STUDENT로의 이동도 강등이 아니다(둘 다 최하 등급)', () => {
    expect(isAdminAccessRoleDowngrade(null, 'STUDENT')).toBe(false);
  });
});

describe('adminAccessRoleChangeDialogDescription — 강등/부여에 따라 다른 문구를 만든다', () => {
  it('강등(ADMIN → STAFF)이면 "전환" 문구를 쓴다', () => {
    expect(
      adminAccessRoleChangeDialogDescription('ADMIN', 'STAFF', 'octocat'),
    ).toBe(
      'octocat님의 관리자 역할을 교직원으로 전환합니다. 관리자 권한은 즉시 사라집니다.',
    );
  });

  it('강등(STAFF → STUDENT)이면 "전환" 문구를 쓴다', () => {
    expect(
      adminAccessRoleChangeDialogDescription('STAFF', 'STUDENT', 'octocat'),
    ).toBe(
      'octocat님의 교직원 역할을 학생으로 전환합니다. 교직원 권한은 즉시 사라집니다.',
    );
    // #765: 직접 강등은 REVOKED 이력을 남기지 않으므로 시스템이 실제로 하지
    // 않는 일을 자칭하는 "회수" 어휘나 옛 REVOKE 문구("역할을 비웁니다")를
    // 쓰지 않는다 — 새 설계는 전환/변경 어휘로 통일한다.
    expect(
      adminAccessRoleChangeDialogDescription('STAFF', 'STUDENT', 'octocat'),
    ).not.toContain('역할을 비웁니다');
    expect(
      adminAccessRoleChangeDialogDescription('STAFF', 'STUDENT', 'octocat'),
    ).not.toContain('회수');
  });

  it('승격(STUDENT → STAFF)이면 "부여" 문구를 쓴다', () => {
    expect(
      adminAccessRoleChangeDialogDescription('STUDENT', 'STAFF', 'octocat'),
    ).toBe('octocat님에게 교직원 권한을 부여합니다.');
  });

  it('첫 배정(null → STAFF)도 "부여" 문구를 쓴다', () => {
    expect(
      adminAccessRoleChangeDialogDescription(null, 'STAFF', 'octocat'),
    ).toBe('octocat님에게 교직원 권한을 부여합니다.');
  });

  it('STAFF → ADMIN 승격은 "관리자 권한을 부여합니다"로 끝난다', () => {
    expect(
      adminAccessRoleChangeDialogDescription('STAFF', 'ADMIN', 'octocat'),
    ).toBe('octocat님에게 관리자 권한을 부여합니다.');
  });
});

function detail(overrides: Partial<AdminAccessDetail> = {}): AdminAccessDetail {
  return {
    id: 'target',
    githubLogin: 'octocat',
    name: '합성 사용자',
    role: 'STAFF',
    accountStatus: 'ACTIVE',
    isSelf: false,
    isProfileComplete: true,
    pendingRequest: null,
    lastLoginAt: null,
    profile: {
      name: '합성 사용자',
      studentId: '202601',
      department: '인공지능학부',
      isComplete: true,
    },
    ...overrides,
  };
}

function history(): AdminAccessHistory {
  return {
    roleRequests: { items: [], page: 1, limit: 20, total: 0 },
    loginHistory: { items: [], page: 1, limit: 20, total: 0 },
  };
}

function mutation(
  confirmAction: AdminAccessMutationAction,
): AdminAccessDetailMutationController {
  return {
    confirmAction,
    processingAction: null,
    rejectReason: '',
    dialogError: null,
    conflictNotice: null,
    successMessage: null,
    onRequestAction: () => {},
    onCancel: () => {},
    onConfirm: () => {},
    onReasonChange: () => {},
  };
}

describe('상세 화면의 역할 변경 확인 다이얼로그 — SET_ROLE_* 액션별 문구', () => {
  it('STAFF → SET_ROLE_STUDENT는 강등 다이얼로그(권한 변경, 전환 문구)를 띄운다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: detail({ role: 'STAFF' }),
          history: history(),
        }}
        onRetry={() => {}}
        mutation={mutation('SET_ROLE_STUDENT')}
      />,
    );

    // #765: 강등도 승격과 같은 「권한 변경」/「변경 확정」 문구를 쓴다 — 직접
    // 강등은 REVOKED 이력을 남기지 않아 "회수"를 자칭할 근거가 없다.
    expect(html).toContain('권한 변경');
    expect(html).toContain(
      'octocat님의 교직원 역할을 학생으로 전환합니다. 교직원 권한은 즉시 사라집니다.',
    );
    expect(html).toContain('변경 확정');
    expect(html).not.toContain('권한 회수');
    expect(html).not.toContain('회수 확정');
  });

  it('STUDENT → SET_ROLE_STAFF는 부여 다이얼로그(변경 확정, non-destructive)를 띄운다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: detail({ role: 'STUDENT' }),
          history: history(),
        }}
        onRetry={() => {}}
        mutation={mutation('SET_ROLE_STAFF')}
      />,
    );

    expect(html).toContain('권한 변경');
    expect(html).toContain('octocat님에게 교직원 권한을 부여합니다.');
    expect(html).toContain('변경 확정');
    expect(html).not.toContain('권한 회수');
  });
});
