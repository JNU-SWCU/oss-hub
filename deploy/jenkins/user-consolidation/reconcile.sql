BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
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
