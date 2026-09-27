import {
  isIndependentAuthorityMutationAction,
  type AdminAccessMutationAction,
} from '../admin-access-mutation-policy';
import type {
  CanonicalAdminAccessDetail,
  MemberKindMutationFields,
} from '../independent-authority-api';

export interface AdminAccessDetailMutationController {
  readonly confirmAction: AdminAccessMutationAction | null;
  readonly processingAction: AdminAccessMutationAction | null;
  readonly rejectReason: string;
  readonly dialogError: string | null;
  readonly conflictNotice: string | null;
  readonly successMessage: string | null;
  readonly onRequestAction: (action: AdminAccessMutationAction) => void;
  readonly onCancel: () => void;
  readonly onConfirm: (fields?: MemberKindMutationFields) => void;
  readonly onReasonChange: (reason: string) => void;
}

export function adminAccessMutationDialogCopy(
  action: Exclude<AdminAccessMutationAction, 'REJECT'>,
  detail: CanonicalAdminAccessDetail,
): {
  readonly title: string;
  readonly description: string | null;
  readonly confirmLabel: string;
  readonly destructive: boolean;
} {
  if (action === 'APPROVE') {
    return {
      title: '요청 승인',
      description: `${detail.githubLogin}님의 교직원 권한 요청을 승인하면 즉시 교직원 권한이 부여됩니다.`,
      confirmLabel: '승인 확정',
      destructive: false,
    };
  }
  if (action === 'SET_MEMBER_STUDENT') {
    return {
      title: '학생으로 변경',
      description: '교직원 접근 권한이 해제됩니다.',
      confirmLabel: '변경',
      destructive: true,
    };
  }
  if (action === 'SET_MEMBER_STAFF') {
    return {
      title: '교직원으로 변경',
      description: '교직원 접근 권한이 부여됩니다.',
      confirmLabel: '변경',
      destructive: false,
    };
  }
  if (isIndependentAuthorityMutationAction(action)) {
    const grant = action.startsWith('GRANT_');
    const authority = '관리자 접근';
    return {
      title: grant ? `${authority} 허용` : `${authority} 회수`,
      description: `${detail.githubLogin}님의 ${authority}을 ${
        grant ? '허용' : '회수'
      }합니다. 다른 접근 권한은 변경되지 않습니다.`,
      confirmLabel: grant ? '허용 확정' : '회수 확정',
      destructive: !grant,
    };
  }
  if (action === 'SET_STATUS_ACTIVE') {
    return {
      title: '계정 재활성화',
      description: `${detail.githubLogin}님의 계정을 다시 활성화합니다.`,
      confirmLabel: '재활성화 확정',
      destructive: false,
    };
  }
  if (action === 'SET_STATUS_DEACTIVATED') {
    return {
      title: '계정 비활성화',
      description: `${detail.githubLogin}님의 계정을 비활성화합니다. 비활성화되면 로그인할 수 없습니다.`,
      confirmLabel: '비활성화 확정',
      destructive: true,
    };
  }
  throw new TypeError(`Unsupported admin access mutation action: ${action}`);
}
