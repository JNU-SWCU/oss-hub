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

/**
 * `before`/`after`를 세 필드에 대해 비교해 실제로 바뀐 것만 `changes`에 담는다. 아무것도
 * 바뀌지 않았으면(요청 필드가 기존 값과 같은 경우) `null`을 돌려주고, 호출부는 이 경우
 * 감사 로그를 쓰지 않는다 — 애초에 아무 일도 일어나지 않은 이벤트를 남기지 않는다.
 */
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
      // 대상은 이 트랜잭션에서 읽은 이벤트 시점 레코드(input.target)에서 스냅샷한다 —
      // `admin-access-audit.ts`의 actor/target 스냅샷 규약과 동일하게, 조회 시점에 User를
      // 다시 읽어 재계산하지 않는다.
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
