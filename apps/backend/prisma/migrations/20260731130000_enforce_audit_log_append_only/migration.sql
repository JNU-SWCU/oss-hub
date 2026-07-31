CREATE FUNCTION reject_audit_log_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'AuditLog is append-only: % is not allowed', TG_OP
        USING ERRCODE = 'object_not_in_prerequisite_state';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_append_only
BEFORE UPDATE OR DELETE OR TRUNCATE
ON "AuditLog"
FOR EACH STATEMENT
EXECUTE FUNCTION reject_audit_log_mutation();
