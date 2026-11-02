BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $rollback$
DECLARE item record; actual jsonb; expected jsonb;
BEGIN
  IF current_setting('oss_hub.user_consolidation_rollback',true) IS DISTINCT FROM 'FENCED' THEN
    RAISE EXCEPTION 'user consolidation rollback requires FENCED maintenance decision';
  END IF;
  IF to_regclass('public."UserProfile"') IS NOT NULL AND to_regclass('public."Consent"') IS NOT NULL
    AND to_regclass('public."UserPolicy"') IS NULL THEN
    IF EXISTS (SELECT 1 FROM public._prisma_migrations
      WHERE migration_name='20261102160000_consolidate_user_domain' AND finished_at IS NOT NULL AND rolled_back_at IS NULL) THEN
      RAISE EXCEPTION 'user consolidation: old schema with committed new ledger';
    END IF;
    IF to_regclass('user_consolidation_backup.control') IS NOT NULL THEN
      IF (SELECT phase FROM user_consolidation_backup.control)<>'ROLLED_BACK' THEN
        RAISE EXCEPTION 'user consolidation: old schema has inconsistent recovery receipt';
      END IF;
    END IF;
    RETURN;
  END IF;
  IF to_regclass('public."UserPolicy"') IS NULL OR to_regclass('user_consolidation_backup.control') IS NULL THEN
    RAISE EXCEPTION 'user consolidation: unknown schema; restore forbidden';
  END IF;
  IF (SELECT phase FROM user_consolidation_backup.control)<>'FENCED' THEN
    RAISE EXCEPTION 'user consolidation: post-open or ambiguous rollback forbidden';
  END IF;
  LOCK TABLE public."User",public."Admin",public."UserHistory",public."AdminHistory",
    public."UserPolicy",public."AuditLog",public."LoginHistory",public._prisma_migrations
    IN ACCESS EXCLUSIVE MODE;
  FOR item IN SELECT * FROM (VALUES ('User','id'),('Admin','userId'),
    ('UserHistory','id'),('AdminHistory','id'),('UserPolicy','id'),('AuditLog','id'),('LoginHistory','id')
  ) t(table_name,key_name) LOOP
    EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY %I),''[]''::jsonb) FROM public.%I t',
      item.key_name,item.table_name) INTO actual;
    SELECT coalesce(jsonb_agg(data ORDER BY id),'[]'::jsonb) INTO expected
      FROM user_consolidation_backup.forward_rows WHERE table_name=item.table_name;
    IF actual IS DISTINCT FROM expected THEN
      RAISE EXCEPTION 'user consolidation: % changed since migration; snapshot rollback forbidden',item.table_name;
    END IF;
  END LOOP;
  FOR item IN SELECT * FROM (VALUES ('UserProfile','userId'),('StaffAccessRequest','id')) t(table_name,key_name) LOOP
    EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY %I),''[]''::jsonb) FROM user_consolidation_backup.%I t',
      item.key_name,item.table_name) INTO actual;
    SELECT coalesce(jsonb_agg(data ORDER BY id),'[]'::jsonb) INTO expected
      FROM user_consolidation_backup.source_rows WHERE table_name=item.table_name;
    IF actual IS DISTINCT FROM expected THEN
      RAISE EXCEPTION 'user consolidation: protected source mismatch in %',item.table_name;
    END IF;
  END LOOP;
  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) INTO actual
    FROM public._prisma_migrations t WHERE migration_name<>'20261102160000_consolidate_user_domain';
  SELECT coalesce(jsonb_agg(data ORDER BY id),'[]'::jsonb) INTO expected
    FROM user_consolidation_backup.source_rows WHERE table_name='_prisma_migrations';
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'user consolidation: old ledger changed'; END IF;
  INSERT INTO user_consolidation_backup.ledger_attempts
    SELECT id,to_jsonb(t) FROM public._prisma_migrations t
    WHERE migration_name='20261102160000_consolidate_user_domain' ON CONFLICT DO NOTHING;
  ALTER TYPE user_consolidation_backup."MemberKind" SET SCHEMA public;
  ALTER TYPE user_consolidation_backup."AffiliationKind" SET SCHEMA public;
  ALTER TYPE user_consolidation_backup."StaffAccessRequestStatus" SET SCHEMA public;
  ALTER TABLE public."User"
    ADD COLUMN "selectedMemberKind" public."MemberKind",
    ADD COLUMN "hasStaffAccess" boolean NOT NULL DEFAULT false,
    ADD COLUMN "hasAdminAccess" boolean NOT NULL DEFAULT false;
  UPDATE public."User" u SET
    "selectedMemberKind"=(s.data->>'selectedMemberKind')::public."MemberKind",
    "hasStaffAccess"=(s.data->>'hasStaffAccess')::boolean,
    "hasAdminAccess"=(s.data->>'hasAdminAccess')::boolean
  FROM user_consolidation_backup.source_rows s WHERE s.table_name='User' AND s.id=u.id;
  DROP TABLE public."UserHistory",public."AdminHistory",public."Admin";
  ALTER TABLE public."User"
    DROP COLUMN type, DROP COLUMN name, DROP COLUMN "studentId", DROP COLUMN "staffNumber",
    DROP COLUMN department, DROP COLUMN "departmentType", DROP COLUMN "profileCreatedAt",
    DROP COLUMN "profileUpdatedAt", DROP COLUMN "approvalStatus", DROP COLUMN "approvalRequestId",
    DROP COLUMN "approvalRequestedAt", DROP COLUMN "approvalDecidedAt", DROP COLUMN "approvalDecidedById",
    DROP COLUMN "approvalReason";
  DROP TRIGGER immutable_profile ON user_consolidation_backup."UserProfile";
  DROP TRIGGER immutable_profile_truncate ON user_consolidation_backup."UserProfile";
  DROP TRIGGER immutable_requests ON user_consolidation_backup."StaffAccessRequest";
  DROP TRIGGER immutable_requests_truncate ON user_consolidation_backup."StaffAccessRequest";
  ALTER TABLE user_consolidation_backup."UserProfile" SET SCHEMA public;
  ALTER TABLE user_consolidation_backup."StaffAccessRequest" SET SCHEMA public;
  ALTER TABLE public."UserPolicy" RENAME TO "Consent";
  ALTER TABLE public."Consent" RENAME CONSTRAINT "UserPolicy_pkey" TO "Consent_pkey";
  ALTER TABLE public."Consent" RENAME CONSTRAINT "UserPolicy_userId_fkey" TO "Consent_userId_fkey";
  ALTER INDEX public."UserPolicy_userId_policyVersion_key" RENAME TO "Consent_userId_policyVersion_key";
  DROP TYPE public."UserType",public."DepartmentType",public."ApprovalStatus",public."AdminOrigin",
    public."HistorySource",public."UserHistoryEvent",public."AdminHistoryEvent";
  DELETE FROM public._prisma_migrations WHERE migration_name='20261102160000_consolidate_user_domain';
  UPDATE user_consolidation_backup.control SET phase='ROLLED_BACK';
END
$rollback$;
COMMIT;
