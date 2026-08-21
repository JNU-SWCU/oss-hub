import { patchAdminAccess, type AdminAccessDetail } from './admin-access-api';
import {
  buildAdminAccessPatchRequest,
  isIndependentAuthorityMutationAction,
  type AdminAccessMutationAction,
} from './admin-access-mutation-policy';
import {
  patchAdminAuthority,
  patchStaffAccess,
} from './independent-authority-api';

export async function executeAdminAccessMutation(
  userId: string,
  action: AdminAccessMutationAction,
  detail: AdminAccessDetail,
  reason: string,
): Promise<void> {
  if (isIndependentAuthorityMutationAction(action)) {
    switch (action) {
      case 'GRANT_STAFF_ACCESS':
      case 'REVOKE_STAFF_ACCESS':
        await patchStaffAccess(userId, action);
        return;
      case 'GRANT_ADMIN_ACCESS':
      case 'REVOKE_ADMIN_ACCESS':
        await patchAdminAuthority(userId, action);
        return;
    }
  }
  await patchAdminAccess(
    userId,
    buildAdminAccessPatchRequest(action, detail, { reason }),
  );
}
