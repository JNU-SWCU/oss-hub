import {
  parseAdminAccessConflictProjection,
  type AdminAccessConflictProjection,
  type AdminAccessMutationResponse,
} from './admin-access-api';
import { executeAdminAccessMutation } from './admin-access-mutation-execution';
import {
  adminAccessMutationErrorMessage,
  isMemberKindMutationAction,
  type AdminAccessMutationAction,
} from './admin-access-mutation-policy';
import type { CanonicalAdminAccessDetail } from './independent-authority-api';

export type AdminAccessMutationOutcome =
  | {
      readonly kind: 'success';
      readonly result: AdminAccessMutationResponse | null;
    }
  | {
      readonly kind: 'conflict';
      readonly projection: AdminAccessConflictProjection | null;
    }
  | { readonly kind: 'error'; readonly message: string };

export async function runAdminAccessMutation({
  userId,
  action,
  detail,
  reason,
}: {
  readonly userId: string;
  readonly action: AdminAccessMutationAction;
  readonly detail: CanonicalAdminAccessDetail;
  readonly reason: string;
}): Promise<AdminAccessMutationOutcome> {
  try {
    const result = await executeAdminAccessMutation(
      userId,
      action,
      detail,
      reason,
    );
    return { kind: 'success', result };
  } catch (error) {
    if (isMemberKindMutationAction(action))
      return { kind: 'error', message: adminAccessMutationErrorMessage(error) };
    const projection = parseAdminAccessConflictProjection(error);
    if (projection) return { kind: 'conflict', projection };
    return { kind: 'error', message: adminAccessMutationErrorMessage(error) };
  }
}
