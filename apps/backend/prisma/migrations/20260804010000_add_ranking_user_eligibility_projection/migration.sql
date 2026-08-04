CREATE TABLE "ConsentWithdrawal" (
    "id" TEXT NOT NULL,
    "consentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "withdrawnAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConsentWithdrawal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConsentWithdrawal_consentId_key" ON "ConsentWithdrawal"("consentId");
CREATE INDEX "ConsentWithdrawal_userId_withdrawnAt_idx" ON "ConsentWithdrawal"("userId", "withdrawnAt");

CREATE UNIQUE INDEX "Consent_id_userId_key" ON "Consent"("id", "userId");

ALTER TABLE "ConsentWithdrawal"
ADD CONSTRAINT "ConsentWithdrawal_consentId_userId_fkey"
FOREIGN KEY ("consentId", "userId") REFERENCES "Consent"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "RankingUserEligibilityProjection" (
    "githubUserId" BIGINT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RankingUserEligibilityProjection_pkey" PRIMARY KEY ("githubUserId")
);

CREATE FUNCTION refresh_ranking_user_eligibility(target_user_id TEXT)
RETURNS VOID AS $$
BEGIN
    DELETE FROM "RankingUserEligibilityProjection" AS projection
    USING "User" AS account
    WHERE account."id" = target_user_id
      AND projection."githubUserId" = account."githubId";

    INSERT INTO "RankingUserEligibilityProjection" (
        "githubUserId",
        "policyVersion",
        "updatedAt"
    )
    SELECT
        account."githubId",
        consent."policyVersion",
        CURRENT_TIMESTAMP
    FROM "User" AS account
    JOIN "Consent" AS consent
      ON consent."userId" = account."id"
     AND consent."policyVersion" = '2026-07-21'
    LEFT JOIN "ConsentWithdrawal" AS withdrawal
      ON withdrawal."consentId" = consent."id"
    WHERE account."id" = target_user_id
      AND account."accountStatus" = 'ACTIVE'
      AND withdrawal."id" IS NULL
    ON CONFLICT ("githubUserId") DO UPDATE SET
        "policyVersion" = EXCLUDED."policyVersion",
        "updatedAt" = CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql;

INSERT INTO "RankingUserEligibilityProjection" (
    "githubUserId",
    "policyVersion",
    "updatedAt"
)
SELECT
    account."githubId",
    consent."policyVersion",
    CURRENT_TIMESTAMP
FROM "User" AS account
JOIN "Consent" AS consent
  ON consent."userId" = account."id"
 AND consent."policyVersion" = '2026-07-21'
LEFT JOIN "ConsentWithdrawal" AS withdrawal
  ON withdrawal."consentId" = consent."id"
WHERE account."accountStatus" = 'ACTIVE'
  AND withdrawal."id" IS NULL
ON CONFLICT ("githubUserId") DO NOTHING;

CREATE FUNCTION sync_ranking_user_eligibility_from_user()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        DELETE FROM "RankingUserEligibilityProjection"
        WHERE "githubUserId" = OLD."githubId";
        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' AND OLD."githubId" <> NEW."githubId" THEN
        DELETE FROM "RankingUserEligibilityProjection"
        WHERE "githubUserId" = OLD."githubId";
    END IF;

    PERFORM refresh_ranking_user_eligibility(NEW."id");
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ranking_user_eligibility_user_sync
AFTER INSERT OR UPDATE OR DELETE
ON "User"
FOR EACH ROW
EXECUTE FUNCTION sync_ranking_user_eligibility_from_user();

CREATE FUNCTION sync_ranking_user_eligibility_from_consent()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM refresh_ranking_user_eligibility(
        CASE WHEN TG_OP = 'DELETE' THEN OLD."userId" ELSE NEW."userId" END
    );
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ranking_user_eligibility_consent_sync
AFTER INSERT OR DELETE
ON "Consent"
FOR EACH ROW
EXECUTE FUNCTION sync_ranking_user_eligibility_from_consent();

CREATE FUNCTION sync_ranking_user_eligibility_from_withdrawal()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM refresh_ranking_user_eligibility(
        CASE WHEN TG_OP = 'DELETE' THEN OLD."userId" ELSE NEW."userId" END
    );
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ranking_user_eligibility_withdrawal_sync
AFTER INSERT OR DELETE
ON "ConsentWithdrawal"
FOR EACH ROW
EXECUTE FUNCTION sync_ranking_user_eligibility_from_withdrawal();