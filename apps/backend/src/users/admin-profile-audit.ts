import {
  USER_PROFILE_AUDIT_ACTIONS,
  USER_PROFILE_AUDIT_FIELDS,
  createUserProfileAuditMetadata,
  type UserProfileAuditAction,
  type UserProfileAuditFieldChange,
  type UserProfileAuditMetadata,
} from '../audit-log/audit-log-metadata';
import type { AdminProfileFields } from './domain/admin-profile';
import type { AdminProfileTargetRecord } from './admin-profile.repository.types';

export type AdminProfileActor = {
  readonly name: string | null;
  readonly githubLogin: string;
};

export type AdminProfileAudit = {
  readonly action: UserProfileAuditAction;
  readonly targetType: 'USER';
  readonly targetId: string;
  readonly metadata: UserProfileAuditMetadata;
};

export function createAdminProfileAudit(input: {
  readonly actor: AdminProfileActor;
  readonly target: AdminProfileTargetRecord;
  readonly before: AdminProfileFields;
  readonly after: AdminProfileFields;
}): AdminProfileAudit | null {
  const changes = diffAdminProfileFields(input.before, input.after);
  if (changes.length === 0) {
    return null;
  }
  return {
    action: USER_PROFILE_AUDIT_ACTIONS.PROFILE_UPDATED,
    targetType: 'USER',
    targetId: input.target.id,
    metadata: createUserProfileAuditMetadata({
      actor: {
        displayName: input.actor.name,
        githubLogin: input.actor.githubLogin,
      },

      target: {
        displayName: input.target.name,
        githubLogin: input.target.githubLogin,
      },
      changes,
    }),
  };
}

function diffAdminProfileFields(
  before: AdminProfileFields,
  after: AdminProfileFields,
): UserProfileAuditFieldChange[] {
  const changes: UserProfileAuditFieldChange[] = [];
  if (before.name !== after.name) {
    changes.push({
      field: USER_PROFILE_AUDIT_FIELDS.NAME,
      before: before.name,
      after: after.name,
    });
  }
  if (before.studentId !== after.studentId) {
    changes.push({
      field: USER_PROFILE_AUDIT_FIELDS.STUDENT_ID,
      before: before.studentId,
      after: after.studentId,
    });
  }
  if (before.department !== after.department) {
    changes.push({
      field: USER_PROFILE_AUDIT_FIELDS.DEPARTMENT,
      before: before.department,
      after: after.department,
    });
  }
  return changes;
}
