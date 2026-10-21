
DROP TRIGGER IF EXISTS repository_owner_projection_repository_sync ON "Repository";
DROP TRIGGER IF EXISTS repository_owner_projection_application_sync ON "Application";
DROP TRIGGER IF EXISTS repository_owner_projection_user_sync ON "User";

DROP FUNCTION IF EXISTS sync_repository_owner_projection_from_repository();
DROP FUNCTION IF EXISTS sync_repository_owner_projection_from_application();
DROP FUNCTION IF EXISTS sync_repository_owner_projection_from_user();

DROP TABLE IF EXISTS "OrgRepositoryActivityEvent";
DROP TABLE IF EXISTS "OrgRepositoryInventory";
DROP TABLE IF EXISTS "RepositoryOwnerProjection";
