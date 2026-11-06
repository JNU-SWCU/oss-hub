BEGIN;
SET LOCAL lock_timeout = '5s';

-- Only the earlier Team and AuditLog migrations read this Application -> Team map, and they run before this one.
-- Drop the table by name and the schema without CASCADE, so any other object in the schema
-- fails the migration instead of being dropped with it.
DROP TABLE IF EXISTS program_team_backup.application_team_map;
DROP SCHEMA IF EXISTS program_team_backup;

COMMIT;
