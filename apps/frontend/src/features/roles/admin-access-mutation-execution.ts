import {
  patchAdminAccess,
  type AdminAccessDetail,
  type AdminAccessMutationResponse,
} from './admin-access-api';
import {
  buildAdminAccessPatchRequest,
  isIndependentAuthorityMutationAction,
  type AdminAccessMutationAction,
} from './admin-access-mutation-policy';
import {
  patchAdminAuthority,
  patchStaffAccess,
} from './independent-authority-api';

/**
 * 레거시 CAS PATCH는 결정 직후의 권위 있는 projection을 돌려준다 — 호출자가
 * 재조회 없이 화면을 갱신할 수 있도록 그대로 흘려보낸다. 독립 권한 명령은
 * 이 projection을 가지지 않으므로 `null`이다.
 */
export async function executeAdminAccessMutation(
  userId: string,
  action: AdminAccessMutationAction,
  detail: AdminAccessDetail,
  reason: string,
): Promise<AdminAccessMutationResponse | null> {
  if (isIndependentAuthorityMutationAction(action)) {
    switch (action) {
      case 'GRANT_STAFF_ACCESS':
      case 'REVOKE_STAFF_ACCESS':
        await patchStaffAccess(userId, action);
        return null;
      case 'GRANT_ADMIN_ACCESS':
      case 'REVOKE_ADMIN_ACCESS':
        await patchAdminAuthority(userId, action);
        return null;
    }
  }
  return patchAdminAccess(
    userId,
    buildAdminAccessPatchRequest(action, detail, { reason }),
  );
}
