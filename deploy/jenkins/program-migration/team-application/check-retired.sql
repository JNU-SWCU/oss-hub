WITH checks AS (
  SELECT to_regclass('public."Application"') IS NOT NULL AS mismatch
  UNION ALL SELECT to_regclass('public."ApplicationReviewHistory"') IS NOT NULL
  UNION ALL SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ApplicationReviewEventKind')
  UNION ALL SELECT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
      AND table_name IN ('GithubRepository','RepositoryProvisionJob','RepositoryIssuanceHistory','GithubRepositoryOutsiderContribution','MilestoneDocumentSubmission','SubmissionFile')
      AND (column_name = 'applicationId' OR (table_name = 'GithubRepository' AND column_name = 'programId'))
  )
  UNION ALL SELECT (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
    AND table_name = 'Team' AND column_name IN ('answers','applicationTemplateVersion','applicantId','status','isRepositoryPublicationPlanned','repositoryConnectionMode','revision','submittedAt') AND is_nullable = 'NO') <> 8
  UNION ALL SELECT (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
    AND table_name IN ('RepositoryProvisionJob','RepositoryIssuanceHistory','GithubRepositoryOutsiderContribution','MilestoneDocumentSubmission') AND column_name = 'teamId' AND is_nullable = 'NO') <> 4
  UNION ALL SELECT NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Team_application_fields_check' AND convalidated)
  UNION ALL SELECT (SELECT count(*) FROM "Team") <> 33
  UNION ALL SELECT (SELECT count(*) FROM "TeamMember") <> 65
  UNION ALL SELECT (SELECT count(*) FROM "TeamHistory") <> 105
  UNION ALL SELECT (SELECT count(*) FROM "SubmissionFile") <> 81
  UNION ALL SELECT (SELECT count(*) FROM "GithubRepository") <> 7
)
SELECT count(*) FROM checks WHERE mismatch;
