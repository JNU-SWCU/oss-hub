SELECT (SELECT count(*) FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = 'AuditLog')
  + (SELECT CASE WHEN count(*) = 1 THEN 0 ELSE 1 END FROM pg_proc
    WHERE proname = 'reject_audit_log_mutation' AND pronamespace = current_schema()::regnamespace);
