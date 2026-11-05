BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;

SELECT 'migration_head', max(migration_name)
FROM "_prisma_migrations"
WHERE finished_at IS NOT NULL;

SELECT 'SubmissionFile', count(*) FROM "SubmissionFile"
UNION ALL SELECT 'ProgramAuthoringUpload', count(*) FROM "ProgramAuthoringUpload"
UNION ALL SELECT 'MilestoneDocumentTemplateFile', count(*) FROM "MilestoneDocumentTemplateFile"
UNION ALL SELECT 'ProgramCover', count(*) FROM "ProgramCover"
UNION ALL SELECT 'ProgramPurgeFileTombstone', count(*) FROM "ProgramPurgeFileTombstone";

SELECT 'template_upload_metadata_mismatch', count(*)
FROM "MilestoneDocumentTemplateFile" template
JOIN "ProgramAuthoringUpload" upload USING ("storageKey")
WHERE template."originalFileName" IS DISTINCT FROM upload."originalFileName"
   OR template."mimeType" IS DISTINCT FROM upload."mimeType"
   OR template."sizeBytes" IS DISTINCT FROM upload."sizeBytes"
   OR template."uploadedById" IS DISTINCT FROM upload."actorId";

WITH sources AS (
  SELECT 'submission' AS source, "storageKey" FROM "SubmissionFile"
  UNION ALL SELECT 'upload', "storageKey" FROM "ProgramAuthoringUpload"
  UNION ALL SELECT 'template', "storageKey" FROM "MilestoneDocumentTemplateFile"
  UNION ALL SELECT 'cover', "storageKey" FROM "ProgramCover" WHERE "storageKey" IS NOT NULL
  UNION ALL SELECT 'tombstone', "storageKey" FROM "ProgramPurgeFileTombstone"
), overlaps AS (
  SELECT string_agg(source, ',' ORDER BY source) AS sources
  FROM sources
  GROUP BY "storageKey"
  HAVING count(*) > 1
)
SELECT 'overlap', sources, count(*) FROM overlaps GROUP BY sources;

COMMIT;
