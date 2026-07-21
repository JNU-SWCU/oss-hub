CREATE TABLE "RepositoryOwnerProjection" (
    "githubRepositoryId" BIGINT NOT NULL,
    "ownerGithubId" BIGINT NOT NULL,
    "ownerGithubLogin" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepositoryOwnerProjection_pkey" PRIMARY KEY ("githubRepositoryId")
);

CREATE INDEX "RepositoryOwnerProjection_ownerGithubId_idx"
ON "RepositoryOwnerProjection"("ownerGithubId");

INSERT INTO "RepositoryOwnerProjection" (
    "githubRepositoryId",
    "ownerGithubId",
    "ownerGithubLogin",
    "updatedAt"
)
SELECT
    repository."githubRepositoryId",
    applicant."githubId",
    applicant."login",
    CURRENT_TIMESTAMP
FROM "Repository" AS repository
JOIN "Application" AS application
    ON application."id" = repository."applicationId"
JOIN "User" AS applicant
    ON applicant."id" = application."applicantId"
ON CONFLICT ("githubRepositoryId") DO UPDATE SET
    "ownerGithubId" = EXCLUDED."ownerGithubId",
    "ownerGithubLogin" = EXCLUDED."ownerGithubLogin",
    "updatedAt" = CURRENT_TIMESTAMP;

CREATE FUNCTION sync_repository_owner_projection_from_repository()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        DELETE FROM "RepositoryOwnerProjection"
        WHERE "githubRepositoryId" = OLD."githubRepositoryId";
        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' AND OLD."githubRepositoryId" <> NEW."githubRepositoryId" THEN
        DELETE FROM "RepositoryOwnerProjection"
        WHERE "githubRepositoryId" = OLD."githubRepositoryId";
    END IF;

    INSERT INTO "RepositoryOwnerProjection" (
        "githubRepositoryId",
        "ownerGithubId",
        "ownerGithubLogin",
        "updatedAt"
    )
    SELECT
        NEW."githubRepositoryId",
        applicant."githubId",
        applicant."login",
        CURRENT_TIMESTAMP
    FROM "Application" AS application
    JOIN "User" AS applicant
        ON applicant."id" = application."applicantId"
    WHERE application."id" = NEW."applicationId"
    ON CONFLICT ("githubRepositoryId") DO UPDATE SET
        "ownerGithubId" = EXCLUDED."ownerGithubId",
        "ownerGithubLogin" = EXCLUDED."ownerGithubLogin",
        "updatedAt" = CURRENT_TIMESTAMP;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER repository_owner_projection_repository_sync
AFTER INSERT OR UPDATE OF "githubRepositoryId", "applicationId" OR DELETE
ON "Repository"
FOR EACH ROW
EXECUTE FUNCTION sync_repository_owner_projection_from_repository();

CREATE FUNCTION sync_repository_owner_projection_from_application()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO "RepositoryOwnerProjection" (
        "githubRepositoryId",
        "ownerGithubId",
        "ownerGithubLogin",
        "updatedAt"
    )
    SELECT
        repository."githubRepositoryId",
        applicant."githubId",
        applicant."login",
        CURRENT_TIMESTAMP
    FROM "Repository" AS repository
    JOIN "User" AS applicant
        ON applicant."id" = NEW."applicantId"
    WHERE repository."applicationId" = NEW."id"
    ON CONFLICT ("githubRepositoryId") DO UPDATE SET
        "ownerGithubId" = EXCLUDED."ownerGithubId",
        "ownerGithubLogin" = EXCLUDED."ownerGithubLogin",
        "updatedAt" = CURRENT_TIMESTAMP;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER repository_owner_projection_application_sync
AFTER UPDATE OF "applicantId"
ON "Application"
FOR EACH ROW
EXECUTE FUNCTION sync_repository_owner_projection_from_application();

CREATE FUNCTION sync_repository_owner_projection_from_user()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE "RepositoryOwnerProjection" AS projection
    SET
        "ownerGithubId" = NEW."githubId",
        "ownerGithubLogin" = NEW."login",
        "updatedAt" = CURRENT_TIMESTAMP
    FROM "Repository" AS repository
    JOIN "Application" AS application
        ON application."id" = repository."applicationId"
    WHERE application."applicantId" = NEW."id"
      AND projection."githubRepositoryId" = repository."githubRepositoryId";

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER repository_owner_projection_user_sync
AFTER UPDATE OF "githubId", "login"
ON "User"
FOR EACH ROW
EXECUTE FUNCTION sync_repository_owner_projection_from_user();
