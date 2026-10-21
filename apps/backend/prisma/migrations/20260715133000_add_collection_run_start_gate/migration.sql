CREATE UNIQUE INDEX "CollectionRun_one_running_per_target_idx"
ON "CollectionRun"("targetGithubId")
WHERE "status" = 'RUNNING';
