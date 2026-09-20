-- RepositoryProvisionJob.repositoryId is issuance/reconciliation history, not current
-- connection ownership. Multiple application jobs may therefore retain the same
-- historical repository pointer after a connection moves.
DROP INDEX "RepositoryProvisionJob_repositoryId_key";
