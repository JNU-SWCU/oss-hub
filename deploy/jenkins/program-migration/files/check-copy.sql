SELECT ((SELECT count(*) FROM "File")<>92)::int
 + ((SELECT count(*) FROM "File" WHERE kind='SUBMISSION')<>81)::int
 + ((SELECT count(*) FROM "File" WHERE kind='TEMPLATE')<>5)::int
 + ((SELECT count(*) FROM "File" WHERE kind='COVER')<>3)::int
 + ((SELECT count(*) FROM "File" WHERE kind='UPLOAD')<>3)::int
 + (SELECT count(*) FROM "SubmissionFile" source LEFT JOIN "File" file ON file.id=source.id WHERE file.id IS NULL OR file."storageKey" IS DISTINCT FROM source."storageKey" OR file."originalFileName" IS DISTINCT FROM source."originalFileName" OR file."mimeType" IS DISTINCT FROM source."mimeType" OR file."sizeBytes" IS DISTINCT FROM source."sizeBytes" OR file.lifecycle::text IS DISTINCT FROM source.lifecycle::text OR file."submissionHistoryId" IS DISTINCT FROM source."milestoneDocumentSubmissionHistoryId")
 + (SELECT count(*) FROM "MilestoneDocumentTemplateFile" source LEFT JOIN "File" file ON file.id=source.id WHERE file.id IS NULL OR file."storageKey" IS DISTINCT FROM source."storageKey" OR file."originalFileName" IS DISTINCT FROM source."originalFileName" OR file."mimeType" IS DISTINCT FROM source."mimeType" OR file."sizeBytes" IS DISTINCT FROM source."sizeBytes" OR file."requirementId" IS DISTINCT FROM source."milestoneDocumentId")
 + (SELECT count(*) FROM "ProgramAuthoringUpload" source LEFT JOIN "File" file USING ("storageKey") WHERE file.id IS NULL OR file.sha256 IS DISTINCT FROM source.sha256 OR file."uploaderId" IS DISTINCT FROM source."actorId")
 + (SELECT count(*) FROM "ProgramCover" source JOIN "Program" program ON program.id=source."programId" WHERE program."coverFileId" IS DISTINCT FROM source.id)
 + (SELECT count(*) FROM "ProgramPurgeFileTombstone" source LEFT JOIN "File" file ON file.id=source.id WHERE file.id IS NULL OR file."storageKey" IS DISTINCT FROM source."storageKey" OR file.lifecycle::text IS DISTINCT FROM source.lifecycle::text);
