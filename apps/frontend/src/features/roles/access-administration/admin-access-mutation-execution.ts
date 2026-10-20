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
  patchMemberKind,
  type CanonicalAdminAccessDetail,
  type MemberKindMutationFields,
} from './independent-authority-api';

export async function executeAdminAccessMutation(
  userId: string,
  action: AdminAccessMutationAction,
  detail: CanonicalAdminAccessDetail,
  reason: string,
  memberKindFields?: MemberKindMutationFields,
): Promise<AdminAccessMutationResponse | null> {
  if (isMemberKindMutationAction(action)) {
    await patchMemberKind(
      userId,
      buildMemberKindMutationRequest(action, detail, memberKindFields),
    );
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
