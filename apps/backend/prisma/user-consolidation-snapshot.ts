import { CONSOLIDATION_PREFIX } from './user-consolidation-fixture';
import type {
  LegacyAudit,
  LegacyConsent,
  LegacyLogin,
  LegacyProfile,
  LegacyRequest,
  LegacyStore,
  LegacyUser,
} from './user-consolidation-legacy-read.fixture';

export async function readUserConsolidationSnapshot(transaction: LegacyStore) {
  const prefix = `${CONSOLIDATION_PREFIX}%`;
  const [users, profiles, requests, consents, logins, audits] =
    await Promise.all([
      transaction.$queryRaw<
        LegacyUser[]
      >`SELECT id,"githubId",login AS nickname,"avatarUrl",phone,
        "accountStatus"::text AS "accountStatus","sessionVersion","notificationEmail","notifyEnabled",
        "selectedMemberKind"::text AS "selectedMemberKind","hasStaffAccess","hasAdminAccess",
        "createdAt","updatedAt" FROM "User" WHERE id LIKE ${prefix} ORDER BY id`,
      transaction.$queryRaw<
        LegacyProfile[]
      >`SELECT "userId",name,"studentId","staffNumber",department,
        "memberKind"::text AS "memberKind","affiliationKind"::text AS "affiliationKind",
        "affiliationName","createdAt","updatedAt" FROM "UserProfile"
        WHERE "userId" LIKE ${prefix} ORDER BY "userId"`,
      transaction.$queryRaw<
        LegacyRequest[]
      >`SELECT id,"userId",status::text AS status,
        "rejectionReason","decidedById","decidedAt","createdAt","updatedAt" FROM "StaffAccessRequest"
        WHERE id LIKE ${prefix} ORDER BY "createdAt" DESC,id DESC`,
      transaction.$queryRaw<
        LegacyConsent[]
      >`SELECT id,"userId","policyVersion","consentedAt"
        FROM "Consent" WHERE id LIKE ${prefix} ORDER BY id`,
      transaction.$queryRaw<
        LegacyLogin[]
      >`SELECT id,"userId",event::text AS event,provider,success,"loginAt"
        FROM "LoginHistory" WHERE id LIKE ${prefix} ORDER BY id`,
      transaction.$queryRaw<
        LegacyAudit[]
      >`SELECT id,"actorId",action,"targetType","targetId",metadata,"occurredAt"
        FROM "AuditLog" WHERE id LIKE ${prefix} ORDER BY id`,
    ]);
  return { users, profiles, requests, consents, logins, audits };
}

export class UnmappedConsolidationEventError extends Error {
  constructor(readonly eventId: string) {
    super(`Unmapped user consolidation audit subject: ${eventId}`);
    this.name = 'UnmappedConsolidationEventError';
  }
}

export async function inspectUserConsolidationSubjects(
  transaction: LegacyStore,
) {
  const snapshot = await readUserConsolidationSnapshot(transaction);
  const users = new Set(snapshot.users.map((user) => user.id));
  const requests = new Map(
    snapshot.requests.map((request) => [request.id, request.userId]),
  );
  const subjects = snapshot.audits.flatMap((audit) => {
    switch (audit.targetType) {
      case 'USER':
        if (!users.has(audit.targetId)) {
          throw new UnmappedConsolidationEventError(audit.id);
        }
        return [{ eventId: audit.id, userId: audit.targetId }];
      case 'ROLE_REQUEST': {
        const userId = requests.get(audit.targetId);
        if (userId === undefined || !users.has(userId)) {
          throw new UnmappedConsolidationEventError(audit.id);
        }
        return [{ eventId: audit.id, userId }];
      }
      default:
        return [];
    }
  });
  return { snapshot, subjects };
}
