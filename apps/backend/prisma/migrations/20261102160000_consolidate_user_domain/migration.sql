BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
LOCK TABLE public."User", public."UserProfile", public."StaffAccessRequest",
  public."Consent", public."AuditLog", public."LoginHistory" IN ACCESS EXCLUSIVE MODE;

-- The read-only preflight block is embedded below before the first write.
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

-- A completed reverse ends an attempt: the reopened old application may have
-- acknowledged new writes. Preserve that attempt before taking a fresh snapshot.
-- The source locks above and this control lock make rotation part of the same
-- transaction as the new migration; a failed forward also undoes the rotation.
DO $generation$
DECLARE archive_name text;
BEGIN
  IF to_regnamespace('user_consolidation_backup') IS NOT NULL THEN
    IF to_regclass('user_consolidation_backup.control') IS NULL THEN
      RAISE EXCEPTION 'user consolidation: missing recovery receipt; refresh forbidden';
    END IF;
    LOCK TABLE user_consolidation_backup.control IN ACCESS EXCLUSIVE MODE;
    IF (SELECT count(*) FROM user_consolidation_backup.control) <> 1
      OR (SELECT phase FROM user_consolidation_backup.control) IS DISTINCT FROM 'ROLLED_BACK' THEN
      RAISE EXCEPTION 'user consolidation: backup is not available for replay';
    END IF;
    SELECT 'user_consolidation_backup_' || oid INTO archive_name
      FROM pg_namespace WHERE nspname='user_consolidation_backup';
    -- reject_mutation has no qualified data references. Its trigger dependency
    -- follows the function OID on rename, never the next active backup schema.
    CREATE TRIGGER immutable_closed_control BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE
      ON user_consolidation_backup.control FOR EACH STATEMENT
      EXECUTE FUNCTION user_consolidation_backup.reject_mutation();
    CREATE TRIGGER immutable_closed_ledger BEFORE INSERT
      ON user_consolidation_backup.ledger_attempts FOR EACH STATEMENT
      EXECUTE FUNCTION user_consolidation_backup.reject_mutation();
    EXECUTE format('ALTER SCHEMA user_consolidation_backup RENAME TO %I',archive_name);
  END IF;
END
$generation$;

CREATE SCHEMA IF NOT EXISTS user_consolidation_backup;
REVOKE ALL ON SCHEMA user_consolidation_backup FROM PUBLIC;
CREATE TABLE IF NOT EXISTS user_consolidation_backup.source_rows (
  table_name text NOT NULL, id text NOT NULL, data jsonb NOT NULL,
  PRIMARY KEY (table_name,id)
);
CREATE TABLE IF NOT EXISTS user_consolidation_backup.forward_rows (
  table_name text NOT NULL, id text NOT NULL, data jsonb NOT NULL,
  PRIMARY KEY (table_name,id)
);
CREATE TABLE IF NOT EXISTS user_consolidation_backup.control (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  migrated_at timestamp(3) NOT NULL,
  phase text NOT NULL CHECK (phase IN ('FENCED','ROLLED_BACK','OPEN_COMMITTED'))
);
CREATE TABLE IF NOT EXISTS user_consolidation_backup.ledger_attempts (
  id text PRIMARY KEY, data jsonb NOT NULL
);
CREATE OR REPLACE FUNCTION user_consolidation_backup.reject_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'user consolidation backup is append-only'
    USING ERRCODE='object_not_in_prerequisite_state';
END $$;
CREATE TEMP TABLE source_current (LIKE user_consolidation_backup.source_rows INCLUDING ALL) ON COMMIT DROP;
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['User','UserProfile','StaffAccessRequest','Consent','AuditLog','LoginHistory','_prisma_migrations'] LOOP
    EXECUTE format('INSERT INTO source_current SELECT %L, %s, to_jsonb(t) FROM public.%I t %s',
      table_name, CASE WHEN table_name='UserProfile' THEN '"userId"' ELSE 'id' END,
      table_name, CASE WHEN table_name='_prisma_migrations'
      THEN 'WHERE migration_name <> ''20261102160000_consolidate_user_domain''' ELSE '' END);
  END LOOP;
  INSERT INTO user_consolidation_backup.source_rows TABLE source_current;
  INSERT INTO user_consolidation_backup.control VALUES (true,transaction_timestamp(),'FENCED');
  CREATE TRIGGER immutable_source BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE
    ON user_consolidation_backup.source_rows FOR EACH STATEMENT
    EXECUTE FUNCTION user_consolidation_backup.reject_mutation();
  CREATE TRIGGER immutable_ledger_attempt BEFORE UPDATE OR DELETE OR TRUNCATE
    ON user_consolidation_backup.ledger_attempts FOR EACH STATEMENT
    EXECUTE FUNCTION user_consolidation_backup.reject_mutation();
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA user_consolidation_backup FROM PUBLIC;
-- checkpoint: snapshot

CREATE TYPE public."UserType" AS ENUM ('UNSELECTED','STUDENT','STAFF');
CREATE TYPE public."DepartmentType" AS ENUM ('DEPARTMENT','PROGRAM_OFFICE');
CREATE TYPE public."ApprovalStatus" AS ENUM ('NOT_REQUIRED','PENDING','APPROVED','REJECTED','REVOKED');
CREATE TYPE public."AdminOrigin" AS ENUM ('ADMIN','BOOTSTRAP','MIGRATION');
CREATE TYPE public."HistorySource" AS ENUM ('APPLICATION','BOOTSTRAP','MIGRATION');
CREATE TYPE public."UserHistoryEvent" AS ENUM ('SIGNED_UP','APPROVAL_REQUESTED','APPROVED','REJECTED',
  'REVOKED','REQUEST_SUPERSEDED','TYPE_CHANGED','PROFILE_UPDATED','PHONE_UPDATED','ACCOUNT_STATUS_CHANGED','LEGACY_IMPORT');
CREATE TYPE public."AdminHistoryEvent" AS ENUM ('GRANTED','REVOKED','LEGACY_IMPORT');
ALTER TABLE public."User"
  ADD COLUMN type public."UserType" NOT NULL DEFAULT 'UNSELECTED',
  ADD COLUMN name text,
  ADD COLUMN "studentId" text,
  ADD COLUMN "staffNumber" text,
  ADD COLUMN department text,
  ADD COLUMN "departmentType" public."DepartmentType",
  ADD COLUMN "profileCreatedAt" timestamp(3),
  ADD COLUMN "profileUpdatedAt" timestamp(3),
  ADD COLUMN "approvalStatus" public."ApprovalStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN "approvalRequestId" text,
  ADD COLUMN "approvalRequestedAt" timestamp(3),
  ADD COLUMN "approvalDecidedAt" timestamp(3),
  ADD COLUMN "approvalDecidedById" text,
  ADD COLUMN "approvalReason" text;
UPDATE public."User" u SET
  type=coalesce(p."memberKind"::text,u."selectedMemberKind"::text,'UNSELECTED')::public."UserType",
  name=p.name,"studentId"=p."studentId","staffNumber"=p."staffNumber",
  department=p.department,"departmentType"=p."affiliationKind"::text::public."DepartmentType",
  "profileCreatedAt"=p."createdAt","profileUpdatedAt"=p."updatedAt"
FROM public."User" original LEFT JOIN public."UserProfile" p ON p."userId"=original.id
WHERE u.id=original.id;
WITH latest AS (
  SELECT DISTINCT ON ("userId") * FROM public."StaffAccessRequest"
  ORDER BY "userId","createdAt" DESC,id DESC
)
UPDATE public."User" u SET
  "approvalStatus"=(CASE
    WHEN u.type<>'STAFF' THEN 'NOT_REQUIRED'
    WHEN u."hasStaffAccess" THEN 'APPROVED'
    WHEN r.status='APPROVED' THEN 'REVOKED'
    ELSE coalesce(r.status::text,'PENDING') END)::public."ApprovalStatus",
  "approvalRequestId"=CASE WHEN u.type='STAFF' THEN coalesce(r.id,
    CASE WHEN NOT u."hasStaffAccess" AND u."profileCreatedAt" IS NOT NULL
      THEN 'migration:request:' || u.id END) END,
  "approvalRequestedAt"=CASE WHEN u.type='STAFF' THEN coalesce(r."createdAt",
    CASE WHEN NOT u."hasStaffAccess" AND u."profileCreatedAt" IS NOT NULL
      THEN (SELECT migrated_at FROM user_consolidation_backup.control) END) END,
  "approvalDecidedAt"=CASE WHEN u.type='STAFF' AND
    ((u."hasStaffAccess" AND r.status='APPROVED') OR (NOT u."hasStaffAccess" AND r.status<>'APPROVED'))
    THEN r."decidedAt" END,
  "approvalDecidedById"=CASE WHEN u.type='STAFF' AND
    ((u."hasStaffAccess" AND r.status='APPROVED') OR (NOT u."hasStaffAccess" AND r.status<>'APPROVED'))
    THEN r."decidedById" END,
  "approvalReason"=CASE WHEN u.type='STAFF' AND
    ((u."hasStaffAccess" AND r.status='APPROVED') OR (NOT u."hasStaffAccess" AND r.status<>'APPROVED'))
    THEN r."rejectionReason" END
FROM public."User" original LEFT JOIN latest r ON r."userId"=original.id
WHERE original.id=u.id;
ALTER TABLE public."User"
  ADD CONSTRAINT "User_approvalDecidedById_fkey" FOREIGN KEY ("approvalDecidedById")
    REFERENCES public."User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "User_name_check" CHECK (name IS NULL OR (btrim(name)=name AND length(name) BETWEEN 1 AND 100)),
  ADD CONSTRAINT "User_department_check" CHECK (department IS NULL OR (btrim(department)=department AND length(department) BETWEEN 1 AND 100)),
  ADD CONSTRAINT "User_studentId_check" CHECK ("studentId" IS NULL OR "studentId" ~ '^[0-9]{6,10}$'),
  ADD CONSTRAINT "User_studentDepartment_check" CHECK (type<>'STUDENT' OR "departmentType" IS NULL OR "departmentType"='DEPARTMENT'),
  ADD CONSTRAINT "User_profile_presence_check" CHECK (
    ("profileCreatedAt" IS NULL AND "profileUpdatedAt" IS NULL AND name IS NULL
      AND department IS NULL AND "departmentType" IS NULL AND "studentId" IS NULL AND "staffNumber" IS NULL)
    OR ("profileCreatedAt" IS NOT NULL AND "profileUpdatedAt" IS NOT NULL
      AND name IS NOT NULL AND department IS NOT NULL AND "departmentType" IS NOT NULL AND type<>'UNSELECTED')),
  ADD CONSTRAINT "User_approval_type_check" CHECK (
    (type='STAFF' AND "approvalStatus"<>'NOT_REQUIRED') OR
    (type<>'STAFF' AND "approvalStatus"='NOT_REQUIRED' AND "approvalRequestId" IS NULL
      AND "approvalRequestedAt" IS NULL AND "approvalDecidedAt" IS NULL
      AND "approvalDecidedById" IS NULL AND "approvalReason" IS NULL)),
  ADD CONSTRAINT "User_approval_request_check" CHECK (
    ("approvalRequestId" IS NULL)=("approvalRequestedAt" IS NULL));
CREATE UNIQUE INDEX "User_studentId_key" ON public."User"("studentId");
CREATE UNIQUE INDEX "User_approvalRequestId_key" ON public."User"("approvalRequestId");
CREATE TABLE public."Admin" (
  "userId" text PRIMARY KEY REFERENCES public."User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "grantedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "grantedById" text REFERENCES public."User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  origin public."AdminOrigin" NOT NULL,
  CONSTRAINT "Admin_origin_actor_check" CHECK (origin<>'ADMIN' OR "grantedById" IS NOT NULL)
);
INSERT INTO public."Admin" ("userId","grantedAt",origin)
SELECT id,(SELECT migrated_at FROM user_consolidation_backup.control),'MIGRATION'
FROM public."User" WHERE "hasAdminAccess";
-- checkpoint: copy

CREATE TABLE public."UserHistory" (
  id text PRIMARY KEY,
  "userId" text NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "actorId" text REFERENCES public."User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  event public."UserHistoryEvent" NOT NULL,
  "occurredAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recordedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source public."HistorySource" NOT NULL,
  "sourceTable" text,"sourceId" text,"sourcePart" text DEFAULT 'whole',data jsonb NOT NULL,
  CONSTRAINT "UserHistory_provenance_check" CHECK (
    ("sourceTable" IS NULL AND "sourceId" IS NULL) OR
    ("sourceTable" IS NOT NULL AND "sourceId" IS NOT NULL AND "sourcePart" IS NOT NULL))
);
CREATE TABLE public."AdminHistory" (
  id text PRIMARY KEY,
  "userId" text NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "actorId" text REFERENCES public."User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  event public."AdminHistoryEvent" NOT NULL,
  "occurredAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recordedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source public."HistorySource" NOT NULL,
  "sourceTable" text,"sourceId" text,"sourcePart" text DEFAULT 'whole',data jsonb NOT NULL,
  CONSTRAINT "AdminHistory_provenance_check" CHECK (
    ("sourceTable" IS NULL AND "sourceId" IS NULL) OR
    ("sourceTable" IS NOT NULL AND "sourceId" IS NOT NULL AND "sourcePart" IS NOT NULL))
);
CREATE UNIQUE INDEX "UserHistory_sourceTable_sourceId_sourcePart_key" ON public."UserHistory"("sourceTable","sourceId","sourcePart");
CREATE INDEX "UserHistory_userId_occurredAt_id_idx" ON public."UserHistory"("userId","occurredAt",id);
CREATE INDEX "UserHistory_actorId_occurredAt_id_idx" ON public."UserHistory"("actorId","occurredAt",id);
CREATE UNIQUE INDEX "AdminHistory_sourceTable_sourceId_sourcePart_key" ON public."AdminHistory"("sourceTable","sourceId","sourcePart");
CREATE INDEX "AdminHistory_userId_occurredAt_id_idx" ON public."AdminHistory"("userId","occurredAt",id);
CREATE INDEX "AdminHistory_actorId_occurredAt_id_idx" ON public."AdminHistory"("actorId","occurredAt",id);
INSERT INTO public."UserHistory" (id,"userId",event,"occurredAt","recordedAt",source,"sourceTable","sourceId",data)
SELECT 'migration:user:' || s.id,s.id,'LEGACY_IMPORT',(s.data->>'createdAt')::timestamp,
  c.migrated_at,'MIGRATION','User',s.id,
  jsonb_build_object('schemaVersion',1,'recordKind','USER_SNAPSHOT','original',s.data,'profile',p.data,
    'mapping',jsonb_build_object('type',u.type,'approvalStatus',u."approvalStatus",
      'profileAuthoritative',p.data IS NOT NULL,
      'identityConflict',p.data IS NOT NULL AND p.data->>'memberKind' IS DISTINCT FROM s.data->>'selectedMemberKind',
      'createdRequest',u."approvalRequestId"='migration:request:' || u.id,
      'approvalEvidenceMissing',u."approvalStatus"='APPROVED' AND u."approvalDecidedAt" IS NULL,
      'normalizedApprovedWithoutAccess',u."approvalStatus"='REVOKED' AND
        (SELECT r.status='APPROVED' FROM public."StaffAccessRequest" r WHERE r.id=u."approvalRequestId"),
      'removedNonStaffAccess',u.type<>'STAFF' AND (s.data->>'hasStaffAccess')::boolean))
FROM user_consolidation_backup.source_rows s
JOIN public."User" u ON u.id=s.id
LEFT JOIN user_consolidation_backup.source_rows p ON p.table_name='UserProfile' AND p.id=s.id
CROSS JOIN user_consolidation_backup.control c WHERE s.table_name='User';
INSERT INTO public."UserHistory" (id,"userId","actorId",event,"occurredAt","recordedAt",source,"sourceTable","sourceId",data)
SELECT 'migration:request:' || r.id,r."userId",r."decidedById",'LEGACY_IMPORT',r."createdAt",
  c.migrated_at,'MIGRATION','StaffAccessRequest',r.id,
  jsonb_build_object('schemaVersion',1,'recordKind','REQUEST_SNAPSHOT','requestId',r.id,'original',to_jsonb(r))
FROM public."StaffAccessRequest" r CROSS JOIN user_consolidation_backup.control c;
INSERT INTO public."AdminHistory" (id,"userId",event,"occurredAt","recordedAt",source,"sourceTable","sourceId","sourcePart",data)
SELECT 'migration:admin:' || a."userId",a."userId",'LEGACY_IMPORT',a."grantedAt",a."grantedAt",
  'MIGRATION','User',a."userId",'admin',
  jsonb_build_object('schemaVersion',1,'recordKind','ADMIN_SNAPSHOT','original',s.data,
    'grantTimeMeaning','MIGRATED_QUALIFICATION_CREATED')
FROM public."Admin" a JOIN user_consolidation_backup.source_rows s ON s.table_name='User' AND s.id=a."userId";
CREATE TEMP TABLE audit_import ON COMMIT DROP AS
SELECT a.*,coalesce(u.id,r."userId") AS subject,
  a.action IN ('GRANT_ADMIN_ACCESS','REVOKE_ADMIN_ACCESS') AS pure_admin,
  a.action='USER_ROLE_CHANGED' AND
    (a.metadata::jsonb#>>'{before,role}'='ADMIN' OR a.metadata::jsonb#>>'{after,role}'='ADMIN'
      OR a.metadata::jsonb#>>'{before,hasAdminAccess}' IS DISTINCT FROM a.metadata::jsonb#>>'{after,hasAdminAccess}') AS compound
FROM public."AuditLog" a
LEFT JOIN public."User" u ON a."targetType"='USER' AND u.id=a."targetId"
LEFT JOIN public."StaffAccessRequest" r ON a."targetType"='ROLE_REQUEST' AND r.id=a."targetId"
WHERE a."targetType" IN ('USER','ROLE_REQUEST');
INSERT INTO public."UserHistory" (id,"userId","actorId",event,"occurredAt","recordedAt",source,"sourceTable","sourceId","sourcePart",data)
SELECT 'migration:audit:user:' || a.id,a.subject,a."actorId",'LEGACY_IMPORT',a."occurredAt",
  c.migrated_at,'MIGRATION','AuditLog',a.id,CASE WHEN a.compound THEN 'user' ELSE 'whole' END,
  jsonb_build_object('schemaVersion',1,'recordKind','AUDIT_EVENT','canonicalEventId',a.id,'original',s.data)
FROM audit_import a JOIN user_consolidation_backup.source_rows s ON s.table_name='AuditLog' AND s.id=a.id
CROSS JOIN user_consolidation_backup.control c WHERE a.subject IS NOT NULL AND NOT a.pure_admin;
INSERT INTO public."AdminHistory" (id,"userId","actorId",event,"occurredAt","recordedAt",source,"sourceTable","sourceId","sourcePart",data)
SELECT 'migration:audit:admin:' || a.id,a.subject,a."actorId",'LEGACY_IMPORT',a."occurredAt",
  c.migrated_at,'MIGRATION','AuditLog',a.id,CASE WHEN a.compound THEN 'admin' ELSE 'whole' END,
  jsonb_build_object('schemaVersion',1,'recordKind','AUDIT_EVENT','canonicalEventId',a.id,'original',s.data)
FROM audit_import a JOIN user_consolidation_backup.source_rows s ON s.table_name='AuditLog' AND s.id=a.id
CROSS JOIN user_consolidation_backup.control c WHERE a.subject IS NOT NULL AND (a.pure_admin OR a.compound);
CREATE TRIGGER user_history_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON public."UserHistory"
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_audit_log_mutation();
CREATE TRIGGER admin_history_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON public."AdminHistory"
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_audit_log_mutation();
-- checkpoint: history

ALTER TABLE public."UserProfile" SET SCHEMA user_consolidation_backup;
ALTER TABLE public."StaffAccessRequest" SET SCHEMA user_consolidation_backup;
CREATE TRIGGER immutable_profile BEFORE INSERT OR UPDATE OR DELETE
  ON user_consolidation_backup."UserProfile" FOR EACH ROW EXECUTE FUNCTION user_consolidation_backup.reject_mutation();
CREATE TRIGGER immutable_profile_truncate BEFORE TRUNCATE
  ON user_consolidation_backup."UserProfile" FOR EACH STATEMENT EXECUTE FUNCTION user_consolidation_backup.reject_mutation();
CREATE TRIGGER immutable_requests BEFORE INSERT OR UPDATE OR DELETE
  ON user_consolidation_backup."StaffAccessRequest" FOR EACH ROW EXECUTE FUNCTION user_consolidation_backup.reject_mutation();
CREATE TRIGGER immutable_requests_truncate BEFORE TRUNCATE
  ON user_consolidation_backup."StaffAccessRequest" FOR EACH STATEMENT EXECUTE FUNCTION user_consolidation_backup.reject_mutation();
ALTER TABLE public."User" DROP COLUMN "selectedMemberKind", DROP COLUMN "hasStaffAccess", DROP COLUMN "hasAdminAccess";
ALTER TYPE public."MemberKind" SET SCHEMA user_consolidation_backup;
ALTER TYPE public."AffiliationKind" SET SCHEMA user_consolidation_backup;
ALTER TYPE public."StaffAccessRequestStatus" SET SCHEMA user_consolidation_backup;
ALTER TABLE public."Consent" RENAME TO "UserPolicy";
ALTER TABLE public."UserPolicy" RENAME CONSTRAINT "Consent_pkey" TO "UserPolicy_pkey";
ALTER TABLE public."UserPolicy" RENAME CONSTRAINT "Consent_userId_fkey" TO "UserPolicy_userId_fkey";
ALTER INDEX public."Consent_userId_policyVersion_key" RENAME TO "UserPolicy_userId_policyVersion_key";
REVOKE ALL ON ALL TABLES IN SCHEMA user_consolidation_backup FROM PUBLIC;
CREATE TEMP TABLE forward_current (LIKE user_consolidation_backup.forward_rows INCLUDING ALL) ON COMMIT DROP;
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['User','Admin','UserHistory','AdminHistory','UserPolicy','AuditLog','LoginHistory'] LOOP
    EXECUTE format('INSERT INTO forward_current SELECT %L, %s, to_jsonb(t) FROM public.%I t',
      table_name, CASE WHEN table_name='Admin' THEN '"userId"' ELSE 'id' END,table_name);
  END LOOP;
  INSERT INTO user_consolidation_backup.forward_rows TABLE forward_current;
  CREATE TRIGGER immutable_forward BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE
    ON user_consolidation_backup.forward_rows FOR EACH STATEMENT
    EXECUTE FUNCTION user_consolidation_backup.reject_mutation();
END $$;
-- checkpoint: switch
DO $reconcile$
DECLARE item record; actual jsonb; expected jsonb; mismatch boolean;
BEGIN
  IF to_regclass('public."UserPolicy"') IS NULL
    OR to_regclass('public."UserProfile"') IS NOT NULL
    OR to_regclass('user_consolidation_backup.source_rows') IS NULL THEN
    RAISE EXCEPTION 'user consolidation: expected committed new schema and protected snapshot';
  END IF;
  FOR item IN SELECT unnest(ARRAY['User','Admin','UserHistory','AdminHistory','UserPolicy','AuditLog','LoginHistory']) AS table_name LOOP
    EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY %s),''[]''::jsonb) FROM public.%I t',
      CASE WHEN item.table_name='Admin' THEN '"userId"' ELSE 'id' END,item.table_name) INTO actual;
    SELECT coalesce(jsonb_agg(data ORDER BY id),'[]'::jsonb) INTO expected
      FROM user_consolidation_backup.forward_rows WHERE table_name=item.table_name;
    IF actual IS DISTINCT FROM expected THEN
      RAISE EXCEPTION 'user consolidation: forward field mismatch in %',item.table_name;
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM user_consolidation_backup.source_rows s
    FULL JOIN public."User" u ON u.id=s.id
    WHERE s.table_name='User' AND (
      u.id IS NULL OR
      to_jsonb(u)-ARRAY['type','name','studentId','staffNumber','department','departmentType',
        'profileCreatedAt','profileUpdatedAt','approvalStatus','approvalRequestId',
        'approvalRequestedAt','approvalDecidedAt','approvalDecidedById','approvalReason']
      IS DISTINCT FROM s.data-ARRAY['selectedMemberKind','hasStaffAccess','hasAdminAccess'])
  ) THEN RAISE EXCEPTION 'user consolidation: account field conservation mismatch'; END IF;
  IF EXISTS (
    SELECT 1 FROM public."User" u
    JOIN user_consolidation_backup.source_rows s ON s.table_name='User' AND s.id=u.id
    LEFT JOIN user_consolidation_backup.source_rows p ON p.table_name='UserProfile' AND p.id=u.id
    WHERE u.type::text IS DISTINCT FROM coalesce(p.data->>'memberKind',s.data->>'selectedMemberKind','UNSELECTED')
      OR jsonb_build_object('name',u.name,'studentId',u."studentId",'staffNumber',u."staffNumber",
        'department',u.department,'departmentType',u."departmentType",
        'profileCreatedAt',u."profileCreatedAt",'profileUpdatedAt',u."profileUpdatedAt")
      IS DISTINCT FROM jsonb_build_object('name',p.data->'name','studentId',p.data->'studentId',
        'staffNumber',p.data->'staffNumber','department',p.data->'department',
        'departmentType',p.data->'affiliationKind','profileCreatedAt',p.data->'createdAt',
        'profileUpdatedAt',p.data->'updatedAt')
  ) THEN RAISE EXCEPTION 'user consolidation: profile field conservation mismatch'; END IF;
  IF EXISTS (
    SELECT 1 FROM public."User" u
    JOIN user_consolidation_backup.source_rows s ON s.table_name='User' AND s.id=u.id
    LEFT JOIN LATERAL (
      SELECT data FROM user_consolidation_backup.source_rows r
      WHERE r.table_name='StaffAccessRequest' AND r.data->>'userId'=u.id
      ORDER BY (r.data->>'createdAt')::timestamp DESC,r.id DESC LIMIT 1
    ) r ON true
    CROSS JOIN user_consolidation_backup.control c
    WHERE jsonb_build_array(u."approvalStatus",u."approvalRequestId",u."approvalRequestedAt",
      u."approvalDecidedAt",u."approvalDecidedById",u."approvalReason")
    IS DISTINCT FROM jsonb_build_array(
      CASE WHEN u.type<>'STAFF' THEN 'NOT_REQUIRED'
        WHEN (s.data->>'hasStaffAccess')::boolean THEN 'APPROVED'
        WHEN r.data->>'status'='APPROVED' THEN 'REVOKED' ELSE coalesce(r.data->>'status','PENDING') END,
      CASE WHEN u.type='STAFF' THEN coalesce(r.data->>'id',
        CASE WHEN NOT (s.data->>'hasStaffAccess')::boolean AND u."profileCreatedAt" IS NOT NULL
          THEN 'migration:request:' || u.id END) END,
      CASE WHEN u.type='STAFF' THEN coalesce((r.data->>'createdAt')::timestamp,
        CASE WHEN NOT (s.data->>'hasStaffAccess')::boolean AND u."profileCreatedAt" IS NOT NULL
          THEN c.migrated_at END) END,
      CASE WHEN u.type='STAFF' AND ((s.data->>'hasStaffAccess')::boolean=(r.data->>'status'='APPROVED'))
        THEN (r.data->>'decidedAt')::timestamp END,
      CASE WHEN u.type='STAFF' AND ((s.data->>'hasStaffAccess')::boolean=(r.data->>'status'='APPROVED'))
        THEN r.data->>'decidedById' END,
      CASE WHEN u.type='STAFF' AND ((s.data->>'hasStaffAccess')::boolean=(r.data->>'status'='APPROVED'))
        THEN r.data->>'rejectionReason' END)
  ) THEN RAISE EXCEPTION 'user consolidation: approval mapping mismatch'; END IF;
  IF EXISTS (
    (SELECT id FROM user_consolidation_backup.source_rows WHERE table_name='User' AND (data->>'hasAdminAccess')::boolean
      EXCEPT SELECT "userId" FROM public."Admin")
    UNION ALL
    (SELECT "userId" FROM public."Admin" EXCEPT
      SELECT id FROM user_consolidation_backup.source_rows WHERE table_name='User' AND (data->>'hasAdminAccess')::boolean)
  ) OR EXISTS (SELECT 1 FROM public."Admin" a CROSS JOIN user_consolidation_backup.control c
    WHERE a.origin<>'MIGRATION' OR a."grantedById" IS NOT NULL OR a."grantedAt"<>c.migrated_at)
  THEN RAISE EXCEPTION 'user consolidation: administrator conservation mismatch'; END IF;
  FOR item IN SELECT * FROM (VALUES
    ('UserProfile','user_consolidation_backup','UserProfile','userId'),
    ('StaffAccessRequest','user_consolidation_backup','StaffAccessRequest','id'),
    ('Consent','public','UserPolicy','id'),
    ('AuditLog','public','AuditLog','id'),
    ('LoginHistory','public','LoginHistory','id')
  ) x(source_name,schema_name,table_name,key_name) LOOP
    EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY %I),''[]''::jsonb) FROM %I.%I t',
      item.key_name,item.schema_name,item.table_name) INTO actual;
    SELECT coalesce(jsonb_agg(data ORDER BY id),'[]'::jsonb) INTO expected
      FROM user_consolidation_backup.source_rows WHERE table_name=item.source_name;
    IF actual IS DISTINCT FROM expected THEN
      RAISE EXCEPTION 'user consolidation: source field mismatch in %',item.source_name;
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM user_consolidation_backup.source_rows s
    LEFT JOIN public."UserHistory" h ON h."sourceTable"=s.table_name AND h."sourceId"=s.id AND h."sourcePart"='whole'
    WHERE s.table_name IN ('User','StaffAccessRequest') AND (h.id IS NULL OR h.data->'original' IS DISTINCT FROM s.data)
  ) THEN RAISE EXCEPTION 'user consolidation: source history mismatch'; END IF;
  IF EXISTS (
    SELECT 1 FROM public."UserHistory" h JOIN user_consolidation_backup.source_rows s
      ON s.table_name='StaffAccessRequest' AND s.id=h."sourceId"
    WHERE h."sourceTable"='StaffAccessRequest' AND (h."userId" IS DISTINCT FROM s.data->>'userId'
      OR h."actorId" IS DISTINCT FROM s.data->>'decidedById'
      OR h."occurredAt" IS DISTINCT FROM (s.data->>'createdAt')::timestamp
      OR h.data->>'recordKind'<>'REQUEST_SNAPSHOT')
  ) THEN RAISE EXCEPTION 'user consolidation: request history identity mismatch'; END IF;
  WITH imports AS (
    SELECT "userId","actorId","occurredAt","sourceTable","sourceId",data FROM public."UserHistory"
    UNION ALL SELECT "userId","actorId","occurredAt","sourceTable","sourceId",data FROM public."AdminHistory"
  )
  SELECT EXISTS (
    SELECT 1 FROM imports h LEFT JOIN user_consolidation_backup.source_rows s ON s.table_name='AuditLog' AND s.id=h."sourceId"
    LEFT JOIN user_consolidation_backup."StaffAccessRequest" r ON r.id=s.data->>'targetId'
    WHERE h."sourceTable"='AuditLog' AND (
      h.data->'original' IS DISTINCT FROM s.data OR h.data->>'canonicalEventId' IS DISTINCT FROM s.id
      OR h."actorId" IS DISTINCT FROM s.data->>'actorId'
      OR h."occurredAt" IS DISTINCT FROM (s.data->>'occurredAt')::timestamp
      OR h."userId" IS DISTINCT FROM CASE s.data->>'targetType' WHEN 'USER' THEN s.data->>'targetId' ELSE r."userId" END)
  ) INTO mismatch;
  IF mismatch THEN RAISE EXCEPTION 'user consolidation: audit import field mismatch'; END IF;
  WITH imported AS (
    SELECT "sourceId" FROM public."UserHistory" WHERE "sourceTable"='AuditLog'
    UNION SELECT "sourceId" FROM public."AdminHistory" WHERE "sourceTable"='AuditLog'
  )
  SELECT EXISTS (
    SELECT 1 FROM public."AuditLog" a
    LEFT JOIN public."User" u ON a."targetType"='USER' AND u.id=a."targetId"
    LEFT JOIN user_consolidation_backup."StaffAccessRequest" r ON a."targetType"='ROLE_REQUEST' AND r.id=a."targetId"
    LEFT JOIN imported i ON i."sourceId"=a.id
    WHERE (a."targetType" IN ('USER','ROLE_REQUEST') AND coalesce(u.id,r."userId") IS NOT NULL) IS DISTINCT FROM (i."sourceId" IS NOT NULL)
  ) INTO mismatch;
  IF mismatch THEN RAISE EXCEPTION 'user consolidation: imported/preserved audit partition mismatch'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) INTO actual
    FROM public._prisma_migrations t WHERE migration_name<>'20261102160000_consolidate_user_domain';
  SELECT coalesce(jsonb_agg(data ORDER BY id),'[]'::jsonb) INTO expected
    FROM user_consolidation_backup.source_rows WHERE table_name='_prisma_migrations';
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'user consolidation: old ledger changed'; END IF;
  RAISE NOTICE 'user consolidation: reconciliation passed; preserved unresolved USER audits %',
    (SELECT count(*) FROM public."AuditLog" a LEFT JOIN public."User" u ON u.id=a."targetId"
      WHERE a."targetType"='USER' AND u.id IS NULL);
END
$reconcile$;
COMMIT;
