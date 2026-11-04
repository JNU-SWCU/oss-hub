SELECT
  (SELECT count(*) FROM "ProgramCreateRequest" AS request
    LEFT JOIN "Program" AS program ON program.id = request."programId"
    LEFT JOIN "User" AS actor ON actor.id = request."actorId"
    WHERE program.id IS NULL OR actor.id IS NULL
      OR char_length(btrim(request."idempotencyKey")) NOT BETWEEN 1 AND 128
      OR request."payloadHash" !~ '^[0-9a-f]{64}$')
  +
  (SELECT count(*) FROM "ProgramAuthoringUpload" AS upload
    LEFT JOIN "ProgramCreateRequest" AS request ON request.id = upload."createRequestId"
      AND request."actorId" = upload."createRequestActorId"
    WHERE upload.lifecycle = 'ATTACHED'
      AND (request.id IS NULL OR upload."actorId" <> request."actorId"));
