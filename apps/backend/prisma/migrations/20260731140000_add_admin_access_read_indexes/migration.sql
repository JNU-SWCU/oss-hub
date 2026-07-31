CREATE INDEX "LoginHistory_userId_provider_event_success_loginAt_id_idx"
ON "LoginHistory"("userId", "provider", "event", "success", "loginAt", "id");

CREATE INDEX "LoginHistory_userId_provider_loginAt_id_idx"
ON "LoginHistory"("userId", "provider", "loginAt", "id");

CREATE INDEX "RoleRequest_userId_status_createdAt_id_idx"
ON "RoleRequest"("userId", "status", "createdAt", "id");

CREATE INDEX "RoleRequest_userId_createdAt_id_idx"
ON "RoleRequest"("userId", "createdAt", "id");
