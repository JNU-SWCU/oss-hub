export const FILE_UNIFICATION_SOURCE_FIXTURE_SQL = `
    CREATE TYPE "SubmissionFileLifecycle" AS ENUM ('PENDING','ATTACHED','DELETE_PENDING','DELETED');
    CREATE TYPE "ProgramAuthoringUploadLifecycle" AS ENUM ('PENDING','ATTACHED','DELETE_PENDING','DELETED');
    CREATE TYPE "ProgramPurgeFileTombstoneLifecycle" AS ENUM ('DELETE_PENDING','DELETED');
    CREATE TYPE "ProgramCoverSource" AS ENUM ('OWNED','EXTERNAL');
    CREATE TABLE "User" (id text PRIMARY KEY);
    CREATE TABLE "Program" (id text PRIMARY KEY, "createdById" text, lifecycle text, UNIQUE(id,"createdById"));
    CREATE TABLE "Team" (id text PRIMARY KEY, "programId" text);
    CREATE TABLE "Application" (id text PRIMARY KEY, "teamId" text, "programId" text);
    CREATE TABLE "Milestone" (id text PRIMARY KEY, "programId" text);
    CREATE TABLE "MilestoneDocument" (id text PRIMARY KEY, "milestoneId" text);
    CREATE TABLE "MilestoneDocumentSubmission" (id text PRIMARY KEY, "applicationId" text, "milestoneDocumentId" text);
    CREATE TABLE "MilestoneDocumentSubmissionHistory" (id text PRIMARY KEY, "milestoneDocumentSubmissionId" text);
    CREATE TABLE "SubmissionFile" (
      id text PRIMARY KEY, "uploaderId" text NOT NULL, "storageKey" text UNIQUE NOT NULL,
      "originalFileName" text NOT NULL, "mimeType" text NOT NULL, "sizeBytes" integer NOT NULL,
      "createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP, "applicationId" text, "milestoneId" text,
      lifecycle "SubmissionFileLifecycle" DEFAULT 'ATTACHED', "pendingExpiresAt" timestamp(3), "expiresAt" timestamp(3),
      "deleteClaimedAt" timestamp(3), "deleteClaimExpiresAt" timestamp(3), "deleteClaimOwner" text,
      "deleteAttemptCount" integer DEFAULT 0, "nextDeleteAttemptAt" timestamp(3), "lastDeleteError" text,
      "deletedAt" timestamp(3), "milestoneDocumentSubmissionId" text,
      "milestoneDocumentSubmissionHistoryId" text, "milestoneDocumentId" text
    );
    CREATE TABLE "ProgramAuthoringUpload" (
      id text PRIMARY KEY, "actorId" text NOT NULL, "storageKey" text UNIQUE NOT NULL,
      "originalFileName" text NOT NULL, "mimeType" text NOT NULL, "sizeBytes" integer NOT NULL,
      sha256 text NOT NULL, lifecycle "ProgramAuthoringUploadLifecycle" DEFAULT 'PENDING', "expiresAt" timestamp(3) NOT NULL,
      "attachedAt" timestamp(3), "deleteClaimedAt" timestamp(3), "deleteClaimExpiresAt" timestamp(3),
      "deleteClaimOwner" text, "deleteAttemptCount" integer DEFAULT 0, "nextDeleteAttemptAt" timestamp(3),
      "lastDeleteError" text, "deletedAt" timestamp(3), "createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamp(3) NOT NULL, "programId" text
    );
    CREATE TABLE "MilestoneDocumentTemplateFile" (
      id text PRIMARY KEY, "milestoneDocumentId" text UNIQUE NOT NULL, "storageKey" text UNIQUE NOT NULL,
      "originalFileName" text NOT NULL, "mimeType" text NOT NULL, "sizeBytes" integer NOT NULL,
      "uploadedById" text NOT NULL, "uploadedAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE "ProgramCover" (
      id text PRIMARY KEY, "programId" text UNIQUE NOT NULL, "storageKey" text UNIQUE,
      "mimeType" text, "sizeBytes" integer, source "ProgramCoverSource" DEFAULT 'OWNED', "sourceUrl" text, "imageUrl" text
    );
    CREATE TABLE "ProgramPurgeFileTombstone" (
      id text PRIMARY KEY, "storageKey" text UNIQUE NOT NULL, lifecycle "ProgramPurgeFileTombstoneLifecycle" DEFAULT 'DELETE_PENDING',
      "deleteClaimedAt" timestamp(3), "deleteClaimExpiresAt" timestamp(3), "deleteClaimOwner" text,
      "deleteAttemptCount" integer DEFAULT 0, "nextDeleteAttemptAt" timestamp(3), "lastDeleteError" text,
      "deletedAt" timestamp(3), "createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP, "updatedAt" timestamp(3) NOT NULL
    );
    ALTER TABLE "SubmissionFile" ADD FOREIGN KEY ("uploaderId") REFERENCES "User";
    ALTER TABLE "SubmissionFile" ADD FOREIGN KEY ("applicationId") REFERENCES "Application";
    ALTER TABLE "SubmissionFile" ADD FOREIGN KEY ("milestoneId") REFERENCES "Milestone";
    ALTER TABLE "SubmissionFile" ADD FOREIGN KEY ("milestoneDocumentId") REFERENCES "MilestoneDocument";
    ALTER TABLE "SubmissionFile" ADD FOREIGN KEY ("milestoneDocumentSubmissionId") REFERENCES "MilestoneDocumentSubmission";
    ALTER TABLE "SubmissionFile" ADD FOREIGN KEY ("milestoneDocumentSubmissionHistoryId") REFERENCES "MilestoneDocumentSubmissionHistory";
    ALTER TABLE "ProgramAuthoringUpload" ADD FOREIGN KEY ("actorId") REFERENCES "User";
    ALTER TABLE "ProgramAuthoringUpload" ADD FOREIGN KEY ("programId") REFERENCES "Program";
    ALTER TABLE "ProgramAuthoringUpload" ADD FOREIGN KEY ("programId","actorId") REFERENCES "Program"(id,"createdById");
    ALTER TABLE "MilestoneDocumentTemplateFile" ADD FOREIGN KEY ("uploadedById") REFERENCES "User";
    ALTER TABLE "MilestoneDocumentTemplateFile" ADD FOREIGN KEY ("milestoneDocumentId") REFERENCES "MilestoneDocument";
    ALTER TABLE "ProgramCover" ADD FOREIGN KEY ("programId") REFERENCES "Program";
    INSERT INTO "User" VALUES ('actor');
    INSERT INTO "Program" SELECT 'program-'||n, 'actor', 'PUBLISHED' FROM generate_series(1,3) n;
    INSERT INTO "Team" VALUES ('team','program-1');
    INSERT INTO "Application" VALUES ('application','team','program-1');
    INSERT INTO "Milestone" VALUES ('milestone','program-1');
    INSERT INTO "MilestoneDocument" SELECT 'requirement-'||n, 'milestone' FROM generate_series(1,5) n;
    INSERT INTO "MilestoneDocumentSubmission" VALUES ('submission','application','requirement-1');
    INSERT INTO "MilestoneDocumentSubmissionHistory" VALUES ('history','submission');
    INSERT INTO "SubmissionFile" (
      id,"uploaderId","applicationId","milestoneId","milestoneDocumentId","milestoneDocumentSubmissionId",
      "milestoneDocumentSubmissionHistoryId","storageKey","originalFileName","mimeType","sizeBytes",lifecycle,"expiresAt"
    ) SELECT 'submission-file-'||n,'actor','application','milestone','requirement-1','submission',
      'history','submission-files/'||n,'report-'||n||'.pdf','application/pdf',n,'ATTACHED','2027-01-01'
      FROM generate_series(1,81) n;
    INSERT INTO "MilestoneDocumentTemplateFile" (
      id,"milestoneDocumentId","storageKey","originalFileName","mimeType","sizeBytes","uploadedById","uploadedAt"
    ) SELECT 'template-'||n,'requirement-'||n,'program-authoring/template-'||n,
      'template-'||n||'.pdf','application/pdf',n,'actor','2026-01-01'
      FROM generate_series(1,5) n;
    INSERT INTO "ProgramAuthoringUpload" (
      id,"actorId","storageKey","originalFileName","mimeType","sizeBytes",sha256,lifecycle,
      "expiresAt","attachedAt","programId","updatedAt"
    ) SELECT 'upload-'||n,'actor','program-authoring/template-'||n,'template-'||n||'.pdf',
      'application/pdf',n,repeat('a',64),'ATTACHED','2026-01-02','2026-01-01','program-1','2026-01-01'
      FROM generate_series(1,2) n;
    INSERT INTO "ProgramAuthoringUpload" (
      id,"actorId","storageKey","originalFileName","mimeType","sizeBytes",sha256,lifecycle,"expiresAt","updatedAt"
    ) VALUES ('upload-3','actor','program-authoring/deleted','deleted.pdf','application/pdf',1,
      repeat('b',64),'DELETED','2026-01-01','2026-01-01');
    INSERT INTO "ProgramCover" (id,"programId","storageKey","mimeType","sizeBytes")
      SELECT 'cover-'||n,'program-'||n,'program-covers/'||n,'image/png',n FROM generate_series(1,3) n;
    INSERT INTO "ProgramPurgeFileTombstone" (id,"storageKey",lifecycle,"updatedAt")
      SELECT 'tombstone-'||n,'program-authoring/tombstone-'||n,'DELETED','2026-01-01'
      FROM generate_series(1,2) n;
`;
