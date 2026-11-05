SELECT ((SELECT count(*) FROM "SubmissionFile")<>81)::int
 + ((SELECT count(*) FROM "ProgramAuthoringUpload")<>3)::int
 + ((SELECT count(*) FROM "MilestoneDocumentTemplateFile")<>5)::int
 + ((SELECT count(*) FROM "ProgramCover")<>3)::int
 + ((SELECT count(*) FROM "ProgramPurgeFileTombstone")<>2)::int
 + (SELECT count(*) FROM pg_constraint WHERE contype='f' AND confrelid IN ('"SubmissionFile"'::regclass,'"ProgramAuthoringUpload"'::regclass,'"MilestoneDocumentTemplateFile"'::regclass,'"ProgramCover"'::regclass,'"ProgramPurgeFileTombstone"'::regclass));
