SELECT
  (SELECT count(*) FROM "ProgramCreateRequest" AS request
    LEFT JOIN "Program" AS program ON program.id = request."programId"
    WHERE program.id IS NULL OR program."createdBy" <> 'USER'
      OR (program."createdById", program."idempotencyKey", program."payloadHash")
        IS DISTINCT FROM (request."actorId", request."idempotencyKey", request."payloadHash"))
  +
  (SELECT count(*) FROM "ProgramAuthoringUpload" AS upload
    LEFT JOIN "Program" AS program ON program.id = upload."programId"
    WHERE upload.lifecycle = 'ATTACHED'
      AND (program.id IS NULL OR upload."actorId" IS DISTINCT FROM program."createdById"))
  +
  (SELECT count(*) FROM "ProgramAuthoringUpload" AS upload
    JOIN "ProgramCreateRequest" AS request ON request.id = upload."createRequestId"
    WHERE upload."programId" IS DISTINCT FROM request."programId");
