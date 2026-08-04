-- 사용처가 없는 OrgRepositoryInventory·OrgRepositoryActivityEvent·RepositoryOwnerProjection을 제거한다.
-- 20260721173000_add_org_repository_inventory와 20260722020000_add_repository_owner_projection의 DDL을 역순으로 되돌린다.

-- RepositoryOwnerProjection을 유지보수하던 트리거를 먼저 제거한다.
DROP TRIGGER IF EXISTS repository_owner_projection_repository_sync ON "Repository";
DROP TRIGGER IF EXISTS repository_owner_projection_application_sync ON "Application";
DROP TRIGGER IF EXISTS repository_owner_projection_user_sync ON "User";

DROP FUNCTION IF EXISTS sync_repository_owner_projection_from_repository();
DROP FUNCTION IF EXISTS sync_repository_owner_projection_from_application();
DROP FUNCTION IF EXISTS sync_repository_owner_projection_from_user();

-- OrgRepositoryActivityEvent가 OrgRepositoryInventory를 참조하므로 자식 테이블부터 제거한다.
DROP TABLE IF EXISTS "OrgRepositoryActivityEvent";
DROP TABLE IF EXISTS "OrgRepositoryInventory";
DROP TABLE IF EXISTS "RepositoryOwnerProjection";
