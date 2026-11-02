BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
DO $preflight$
BEGIN
  IF to_regclass('public."UserProfile"') IS NULL
     OR to_regclass('public."StaffAccessRequest"') IS NULL
     OR to_regclass('public."Consent"') IS NULL
     OR to_regclass('public."UserPolicy"') IS NOT NULL THEN
    RAISE EXCEPTION 'user consolidation: expected old schema';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public._prisma_migrations
    WHERE migration_name='20261101000000_add_github_user_activity_monthly'
      AND finished_at IS NOT NULL AND rolled_back_at IS NULL)
    OR (SELECT max(migration_name) FROM public._prisma_migrations
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)
      IS DISTINCT FROM '20261101000000_add_github_user_activity_monthly'
    OR EXISTS (SELECT 1 FROM public._prisma_migrations
      WHERE migration_name <> '20261102160000_consolidate_user_domain'
        AND finished_at IS NULL AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'user consolidation: unexpected migration ledger';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public."UserProfile"
    WHERE name IS NULL OR btrim(name) <> name OR length(name) NOT BETWEEN 1 AND 100
      OR department IS NULL OR btrim(department) <> department
      OR length(department) NOT BETWEEN 1 AND 100
      OR "affiliationName" IS DISTINCT FROM department
      OR "memberKind" IS NULL OR "affiliationKind" IS NULL
      OR ("studentId" IS NOT NULL AND "studentId" !~ '^[0-9]{6,10}$')
      OR ("memberKind"='STUDENT' AND "affiliationKind"<>'DEPARTMENT')
  ) THEN RAISE EXCEPTION 'user consolidation: invalid profile'; END IF;
  IF EXISTS (SELECT 1 FROM public."UserProfile" WHERE "studentId" IS NOT NULL
    GROUP BY "studentId" HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'user consolidation: duplicate studentId';
  END IF;
  IF EXISTS (SELECT 1 FROM public."User" WHERE "hasStaffAccess" IS NULL
    OR "hasAdminAccess" IS NULL OR (phone IS NOT NULL AND phone !~ '^[0-9]{10,11}$')) THEN
    RAISE EXCEPTION 'user consolidation: invalid account fields';
  END IF;
  IF EXISTS (SELECT 1 FROM public."StaffAccessRequest" r
    LEFT JOIN public."User" u ON u.id=r."userId"
    LEFT JOIN public."User" actor ON actor.id=r."decidedById"
    WHERE u.id IS NULL OR (r."decidedById" IS NOT NULL AND actor.id IS NULL))
    OR EXISTS (SELECT 1 FROM public."UserProfile" p
      LEFT JOIN public."User" u ON u.id=p."userId" WHERE u.id IS NULL) THEN
    RAISE EXCEPTION 'user consolidation: unresolved source owners';
  END IF;
  IF EXISTS (SELECT 1 FROM public."AuditLog" a
    LEFT JOIN public."StaffAccessRequest" r ON r.id=a."targetId"
    LEFT JOIN public."User" u ON u.id=r."userId"
    WHERE a."targetType"='ROLE_REQUEST' AND u.id IS NULL) THEN
    RAISE EXCEPTION 'user consolidation: unresolved audit subjects';
  END IF;
  IF EXISTS (SELECT 1 FROM public."AuditLog"
    WHERE ("action" LIKE 'STAFF_ROLE_REQUEST_%'
      OR action IN ('USER_ROLE_CHANGED','USER_ACCOUNT_STATUS_CHANGED',
      'GRANT_STAFF_ACCESS','REVOKE_STAFF_ACCESS','GRANT_ADMIN_ACCESS',
      'REVOKE_ADMIN_ACCESS','USER_PROFILE_UPDATED','USER_PHONE_UPDATED'))
    AND "targetType" NOT IN ('USER','ROLE_REQUEST')) THEN
    RAISE EXCEPTION 'user consolidation: unsupported audit subject kind';
  END IF;
  RAISE NOTICE 'user consolidation: preserved unresolved USER audits %, identity conflicts %, non-STAFF staff flags %',
    (SELECT count(*) FROM public."AuditLog" a LEFT JOIN public."User" u
      ON u.id=a."targetId" WHERE a."targetType"='USER' AND u.id IS NULL),
    (SELECT count(*) FROM public."UserProfile" p JOIN public."User" u ON u.id=p."userId"
      WHERE p."memberKind" IS DISTINCT FROM u."selectedMemberKind"),
    (SELECT count(*) FROM public."User" u LEFT JOIN public."UserProfile" p ON p."userId"=u.id
      WHERE u."hasStaffAccess" AND coalesce(p."memberKind"::text,u."selectedMemberKind"::text,'UNSELECTED')<>'STAFF');
END
$preflight$;
COMMIT;
