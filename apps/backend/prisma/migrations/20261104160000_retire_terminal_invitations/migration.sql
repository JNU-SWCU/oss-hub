BEGIN;
SET LOCAL TIME ZONE 'UTC';

DO $$
DECLARE
  invitation_ids TEXT[];
  terminal_count BIGINT;
  accepted_count BIGINT;
  declined_count BIGINT;
  pending_count BIGINT;
  team_count BIGINT;
  member_count BIGINT;
  covered_count BIGINT;
  copied_count BIGINT;
  deleted_count BIGINT;
  mismatch_count BIGINT;
BEGIN
  LOCK TABLE "Team", "TeamMember", "TeamInvitation", "TeamHistory" IN SHARE ROW EXCLUSIVE MODE;

  IF EXISTS (SELECT 1 FROM "ApplicationPreparation")
     OR EXISTS (SELECT 1 FROM "ApplicationPreparationParticipant") THEN
    RAISE EXCEPTION 'Preparation must remain empty before invitation retirement';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE contype = 'f' AND confrelid = '"TeamInvitation"'::regclass
  ) THEN
    RAISE EXCEPTION 'Invitation retirement requires review of incoming foreign keys';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "TeamInvitation" i
    WHERE i.status = 'PENDING'
      AND (i."respondedAt" IS NOT NULL OR EXISTS (
        SELECT 1 FROM "TeamHistory" h
        WHERE h."sourceTable" = 'TeamInvitation' AND h."sourceId" = i.id
      ))
  ) THEN
    RAISE EXCEPTION 'Pending invitations have a response or closing history';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "TeamInvitation" i
    LEFT JOIN "Team" t ON t.id = i."teamId" AND t."programId" = i."programId"
    WHERE i.status <> 'PENDING' AND t.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Terminal invitation team identity is inconsistent';
  END IF;

  SELECT coalesce(array_agg(id ORDER BY id), ARRAY[]::TEXT[])
  INTO invitation_ids
  FROM "TeamInvitation" WHERE status <> 'PENDING';
  terminal_count := cardinality(invitation_ids);

  SELECT count(*) FILTER (WHERE status = 'ACCEPTED'),
         count(*) FILTER (WHERE status = 'DECLINED'),
         count(*) FILTER (WHERE status = 'PENDING')
  INTO accepted_count, declined_count, pending_count
  FROM "TeamInvitation";

  SELECT count(*) INTO team_count FROM "Team";
  SELECT count(*) INTO member_count FROM "TeamMember";

  IF terminal_count = 0 THEN
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = '"TeamInvitation"'::regclass
        AND conname = 'TeamInvitation_pending_only'
        AND contype = 'c' AND convalidated
    ) THEN
      RAISE NOTICE 'INVITATION_RETIRE replay terminal=0 copied=0 deleted=0';
      RETURN;
    ELSIF pending_count = 0 AND team_count = 0 AND member_count = 0 AND NOT EXISTS (
      SELECT 1 FROM "TeamHistory" WHERE "sourceTable" = 'TeamInvitation'
    ) THEN
      RAISE NOTICE 'INVITATION_RETIRE fresh terminal=0 copied=0 deleted=0';
      RETURN;
    END IF;
  END IF;

  IF terminal_count <> 25 OR accepted_count <> 20
     OR declined_count <> 5 OR pending_count <> 3
     OR team_count <> 40 OR member_count <> 72 THEN
    RAISE EXCEPTION
      'Invitation approval count mismatch: terminal=% accepted=% declined=% pending=% teams=% members=%; expected 25/20/5/3/40/72',
      terminal_count, accepted_count, declined_count, pending_count, team_count, member_count;
  END IF;

  SELECT count(*) INTO covered_count
  FROM "TeamInvitation" i
  WHERE i.id = ANY(invitation_ids) AND EXISTS (
    SELECT 1 FROM "TeamHistory" h
    WHERE h."sourceTable" = 'TeamInvitation' AND h."sourceId" = i.id
  );

  INSERT INTO "TeamHistory" (
    id, "teamId", "programId", "actorId", event, "occurredAt", "recordedAt",
    source, "sourceTable", "sourceId", data
  )
  SELECT
    'team-invitation:' || i.id, i."teamId", i."programId", NULL,
    'INVITATION_ARCHIVED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
    'MIGRATION', 'TeamInvitation', i.id,
    jsonb_build_object(
      'schemaVersion', 1,
      'invitation', jsonb_build_object(
        'id', i.id,
        'inviteeId', i."inviteeId",
        'invitedById', i."invitedById",
        'createdAt', to_char(i."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'status', i.status::TEXT,
        'respondedAt', CASE WHEN i."respondedAt" IS NULL THEN NULL
          ELSE to_char(i."respondedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
        'updatedAt', to_char(i."updatedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      )
    )
  FROM "TeamInvitation" i
  WHERE i.id = ANY(invitation_ids)
  ON CONFLICT ("sourceTable", "sourceId") DO NOTHING;
  GET DIAGNOSTICS copied_count = ROW_COUNT;

  SELECT count(*) INTO mismatch_count
  FROM "TeamInvitation" i
  LEFT JOIN "TeamHistory" h
    ON h."sourceTable" = 'TeamInvitation' AND h."sourceId" = i.id
  WHERE i.id = ANY(invitation_ids) AND (
    h.id IS NULL
    OR h."teamId" IS DISTINCT FROM i."teamId"
    OR h."programId" IS DISTINCT FROM i."programId"
    OR h.data->'invitation'->>'id' IS DISTINCT FROM i.id
    OR h.data->'invitation'->>'inviteeId' IS DISTINCT FROM i."inviteeId"
    OR h.data->'invitation'->>'invitedById' IS DISTINCT FROM i."invitedById"
    OR (h.data->'invitation'->>'createdAt')::TIMESTAMP IS DISTINCT FROM i."createdAt"
    OR CASE
      WHEN h.event::TEXT = 'INVITATION_ARCHIVED' THEN
        h.data->'invitation'->>'status' IS DISTINCT FROM i.status::TEXT
        OR NOT ((h.data->'invitation') ? 'respondedAt')
        OR (h.data->'invitation'->>'respondedAt')::TIMESTAMP IS DISTINCT FROM i."respondedAt"
        OR (h.data->'invitation'->>'updatedAt')::TIMESTAMP IS DISTINCT FROM i."updatedAt"
      WHEN h.event::TEXT = 'INVITATION_ACCEPTED' THEN
        i.status <> 'ACCEPTED' OR h."occurredAt" IS DISTINCT FROM i."respondedAt"
      WHEN h.event::TEXT IN ('INVITATION_DECLINED', 'INVITATION_CANCELLED') THEN
        i.status <> 'DECLINED' OR h."occurredAt" IS DISTINCT FROM i."respondedAt"
      ELSE TRUE
    END
  );
  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'Invitation history mismatch count: %', mismatch_count;
  END IF;
  IF copied_count + covered_count <> terminal_count THEN
    RAISE EXCEPTION 'Invitation archive cardinality mismatch';
  END IF;
  IF copied_count <> 25 THEN
    RAISE EXCEPTION 'Invitation approval insert count mismatch: copied=%; expected 25', copied_count;
  END IF;

  DELETE FROM "TeamInvitation" i
  USING "TeamHistory" h
  WHERE i.id = ANY(invitation_ids)
    AND h."sourceTable" = 'TeamInvitation' AND h."sourceId" = i.id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  IF deleted_count <> terminal_count THEN
    RAISE EXCEPTION 'Invitation retirement cardinality mismatch';
  END IF;
  IF EXISTS (SELECT 1 FROM "TeamInvitation" WHERE status <> 'PENDING') THEN
    RAISE EXCEPTION 'Terminal invitations appeared during retirement; confirm code-first writers';
  END IF;

  RAISE NOTICE 'INVITATION_RETIRE terminal=% covered=% copied=% deleted=%',
    terminal_count, covered_count, copied_count, deleted_count;
EXCEPTION
  WHEN invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'Stored invitation history has invalid timestamp data';
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Invitation archive key collision; no rows retired';
  WHEN check_violation THEN
    RAISE EXCEPTION 'Pending-only invitation invariant failed; no rows retired';
  WHEN foreign_key_violation THEN
    RAISE EXCEPTION 'A retained relation references invitations; no rows retired';
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"TeamInvitation"'::regclass
      AND conname = 'TeamInvitation_pending_only'
  ) THEN
    ALTER TABLE "TeamInvitation"
      ADD CONSTRAINT "TeamInvitation_pending_only"
      CHECK (status = 'PENDING' AND "respondedAt" IS NULL);
  END IF;
END $$;

COMMIT;
