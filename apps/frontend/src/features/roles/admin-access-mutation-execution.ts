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

/**
 * 레거시 CAS PATCH는 결정 직후의 권위 있는 projection을 돌려준다 — 호출자가
 * 재조회 없이 화면을 갱신할 수 있도록 그대로 흘려보낸다. 독립 권한 명령은
 * 이 projection을 가지지 않으므로 `null`이다.
 */
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
