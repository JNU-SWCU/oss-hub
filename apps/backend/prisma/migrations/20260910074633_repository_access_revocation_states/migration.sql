-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RepositoryInvitationStatus" ADD VALUE 'REVOKE_REQUIRED';
ALTER TYPE "RepositoryInvitationStatus" ADD VALUE 'REVOKED';
ALTER TYPE "RepositoryInvitationStatus" ADD VALUE 'REVOKE_FAILED_RETRYABLE';
ALTER TYPE "RepositoryInvitationStatus" ADD VALUE 'REVOKE_FAILED_FINAL';
