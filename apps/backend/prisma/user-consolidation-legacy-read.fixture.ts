import { Prisma } from '@prisma/client';

type Kind = 'STUDENT' | 'STAFF';
type RequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'REVOKED';
export type LegacyStore = Pick<
  Prisma.TransactionClient,
  '$queryRaw' | '$executeRaw'
>;

export type LegacyUser = {
  readonly id: string;
  readonly githubId: bigint;
  readonly nickname: string;
  readonly avatarUrl: string | null;
  readonly phone: string | null;
  readonly accountStatus: 'ACTIVE' | 'DEACTIVATED';
  readonly sessionVersion: number;
  readonly notificationEmail: string | null;
  readonly notifyEnabled: boolean;
  readonly selectedMemberKind: Kind | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};
export type LegacyProfile = {
  readonly userId: string;
  readonly name: string;
  readonly studentId: string | null;
  readonly staffNumber: string | null;
  readonly department: string;
  readonly memberKind: Kind;
  readonly affiliationKind: 'DEPARTMENT' | 'PROGRAM_OFFICE';
  readonly affiliationName: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};
export type LegacyRequest = {
  readonly id: string;
  readonly userId: string;
  readonly status: RequestStatus;
  readonly rejectionReason: string | null;
  readonly decidedById: string | null;
  readonly decidedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};
export type LegacyConsent = {
  readonly id: string;
  readonly userId: string;
  readonly policyVersion: string;
  readonly consentedAt: Date;
};
export type LegacyLogin = {
  readonly id: string;
  readonly userId: string;
  readonly event: 'LOGIN' | 'LOGOUT';
  readonly provider: string;
  readonly success: boolean;
  readonly loginAt: Date;
};
export type LegacyAudit = {
  readonly id: string;
  readonly actorId: string;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly metadata: Prisma.JsonValue;
  readonly occurredAt: Date;
};
export type LegacyInsertRows = {
  readonly User: Omit<LegacyUser, 'nickname'> & { readonly login: string };
  readonly UserProfile: LegacyProfile;
  readonly StaffAccessRequest: LegacyRequest;
  readonly Consent: LegacyConsent;
  readonly LoginHistory: LegacyLogin;
  readonly AuditLog: LegacyAudit;
};
type LegacyUserView = LegacyUser & {
  readonly name: string | null;
  readonly memberKind: Kind | null;
  readonly studentId: string | null;
  readonly department: string | null;
};
type RequestView = Pick<
  LegacyRequest,
  'id' | 'status' | 'rejectionReason' | 'decidedAt' | 'createdAt'
> & {
  readonly decidedBy: string | null;
};

const userView = Prisma.sql`SELECT u.id, u."githubId", u.login AS nickname,
  u."avatarUrl", u.phone, u."accountStatus"::text AS "accountStatus",
  u."sessionVersion", u."notificationEmail", u."notifyEnabled",
  u."selectedMemberKind"::text AS "selectedMemberKind", u."hasStaffAccess",
  u."hasAdminAccess", u."createdAt", u."updatedAt", p.name,
  p."memberKind"::text AS "memberKind", p."studentId", p.department
  FROM "User" u LEFT JOIN "UserProfile" p ON p."userId"=u.id`;

export const legacyRead = {
  async findAdminAccessUserById(transaction: LegacyStore, id: string) {
    const [user] = await transaction.$queryRaw<LegacyUserView[]>(
      Prisma.sql`${userView} WHERE u.id=${id}`,
    );
    if (user === undefined) return null;
    const [pendingRequest] = await transaction.$queryRaw<LegacyRequest[]>`
      SELECT id,"userId",status::text AS status,"rejectionReason","decidedById",
      "decidedAt","createdAt","updatedAt" FROM "StaffAccessRequest"
      WHERE "userId"=${id} AND status='PENDING' ORDER BY "createdAt" DESC,id DESC LIMIT 1
    `;
    return { ...user, pendingRequest: pendingRequest ?? null };
  },

  async listAdminAccessUsers(
    transaction: LegacyStore,
    input: {
      readonly query: string;
      readonly page: number;
      readonly limit: number;
    },
  ) {
    const pattern = `%${input.query}%`;
    const [{ total }] = await transaction.$queryRaw<
      readonly [{ readonly total: number }]
    >`
      SELECT count(*)::int AS total FROM "User" WHERE login ILIKE ${pattern}
    `;
    const items = await transaction.$queryRaw<LegacyUserView[]>(
      Prisma.sql`${userView} WHERE u.login ILIKE ${pattern} ORDER BY u.id
        LIMIT ${input.limit} OFFSET ${(input.page - 1) * input.limit}`,
    );
    return { items, total, page: input.page, limit: input.limit };
  },

  async listAdminAccessStaffAccessRequestHistory(
    transaction: LegacyStore,
    userId: string,
    input: { readonly page: number; readonly limit: number },
  ) {
    const [{ total }] = await transaction.$queryRaw<
      readonly [{ readonly total: number }]
    >`
      SELECT count(*)::int AS total FROM "StaffAccessRequest" WHERE "userId"=${userId}
    `;
    const items = await transaction.$queryRaw<RequestView[]>`
      SELECT r.id,r.status::text AS status,r."rejectionReason",r."decidedAt",
      u.login AS "decidedBy",r."createdAt" FROM "StaffAccessRequest" r
      LEFT JOIN "User" u ON u.id=r."decidedById" WHERE r."userId"=${userId}
      ORDER BY r."createdAt" DESC,r.id DESC LIMIT ${input.limit}
      OFFSET ${(input.page - 1) * input.limit}
    `;
    return { items, total, page: input.page, limit: input.limit };
  },
};

export async function legacyProfileById(
  transaction: LegacyStore,
  userId: string,
): Promise<LegacyProfile> {
  const [profile] = await transaction.$queryRaw<LegacyProfile[]>`
    SELECT "userId",name,"studentId","staffNumber",department,
    "memberKind"::text AS "memberKind","affiliationKind"::text AS "affiliationKind",
    "affiliationName","createdAt","updatedAt" FROM "UserProfile" WHERE "userId"=${userId}
  `;
  if (profile === undefined)
    throw new TypeError(`Missing legacy fixture profile: ${userId}`);
  return profile;
}
