

ALTER TYPE "RepositoryInvitationStatus" ADD VALUE 'REVOKE_REQUIRED';
ALTER TYPE "RepositoryInvitationStatus" ADD VALUE 'REVOKED';
ALTER TYPE "RepositoryInvitationStatus" ADD VALUE 'REVOKE_FAILED_RETRYABLE';
ALTER TYPE "RepositoryInvitationStatus" ADD VALUE 'REVOKE_FAILED_FINAL';
