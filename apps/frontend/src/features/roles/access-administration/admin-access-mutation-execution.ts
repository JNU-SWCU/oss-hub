import {
  patchAdminAccess,
  type AdminAccessMutationResponse,
} from './admin-access-api';
import {
  buildAdminAccessPatchRequest,
  buildMemberKindMutationRequest,
  isIndependentAuthorityMutationAction,
  isMemberKindMutationAction,
  type AdminAccessMutationAction,
} from './admin-access-mutation-policy';
import {
  patchAdminAuthority,
  resetMemberKind,
  type CanonicalAdminAccessDetail,
} from './independent-authority-api';

export async function executeAdminAccessMutation(
  userId: string,
  action: AdminAccessMutationAction,
  detail: CanonicalAdminAccessDetail,
  reason: string,
): Promise<AdminAccessMutationResponse | null> {
  if (isMemberKindMutationAction(action)) {
    await resetMemberKind(userId, buildMemberKindMutationRequest(detail));
    return null;
  }
  if (isIndependentAuthorityMutationAction(action)) {
    switch (action) {
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
