\set ON_ERROR_STOP on
BEGIN;
SELECT import_legacy_program_mail(:'receipt_id');
COMMIT;
