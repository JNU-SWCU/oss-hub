SELECT ((SELECT count(*) FROM "SubmissionFile")<>81)::int
 + ((SELECT count(*) FROM "ProgramAuthoringUpload")<>3)::int
 + ((SELECT count(*) FROM "MilestoneDocumentTemplateFile")<>5)::int
 + ((SELECT count(*) FROM "ProgramCover")<>3)::int
 + ((SELECT count(*) FROM "ProgramPurgeFileTombstone")<>2)::int
 + (SELECT count(*) FROM (
     SELECT "storageKey" FROM "SubmissionFile"
     UNION SELECT "storageKey" FROM "ProgramAuthoringUpload"
     UNION SELECT "storageKey" FROM "MilestoneDocumentTemplateFile"
     UNION SELECT "storageKey" FROM "ProgramCover" WHERE source='OWNED'
     UNION SELECT "storageKey" FROM "ProgramPurgeFileTombstone"
   ) source WHERE NOT EXISTS (SELECT 1 FROM "File" f WHERE f."storageKey"=source."storageKey"))
 + (SELECT count(*) FROM "File" WHERE NOT (
     (kind='UPLOAD' AND lifecycle IN ('PENDING','DELETE_PENDING','DELETED'))
     OR (kind IN ('TEMPLATE','COVER') AND lifecycle IN ('ATTACHED','DELETE_PENDING','DELETED'))
     OR kind='SUBMISSION'
   ))
 + (SELECT count(*) FROM "Program" WHERE NOT (
     ("coverFileId" IS NOT NULL AND "coverSourceUrl" IS NULL AND "coverImageUrl" IS NULL)
     OR ("coverFileId" IS NULL AND ("coverSourceUrl" IS NULL)=("coverImageUrl" IS NULL))
   ));
