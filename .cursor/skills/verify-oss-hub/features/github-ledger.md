# GitHub ledger

The GitHub ledger path collects one repository into the old GitHub tables, copies those rows into the shadow ledger, and checks the counts. The collector writes the old fact tables and rebuilds the daily rollup `"Contribution"`. It does not write the shadow tables `"repo"`, `"team_repo"`, `"contribution"`, or `"github_user_activity_history"`. `apps/backend/prisma/github-ledger-copy.sql` does that copy, and `apps/backend/prisma/github-ledger-verify.sql` compares the counts. Jenkins runs the copy during deploy and does not run the verify SQL.

## Sub-features

- `ledger-collect` runs the collector for `verify-ledger-org/verify-ledger-repo` through an in-memory GitHub client and writes one commit fact and one pull request fact.
- `ledger-copy` runs `github-ledger-copy.sql` against the verification database.
- `ledger-verify` runs `github-ledger-verify.sql` and requires every check to have equal expected and actual counts.

## How to get to it (user POV)

- An administrator can post `POST /api/v1/admin/collection/trigger`. That route calls GitHub. Do not use it for this drive.
- This drive uses the collector service with the same in-memory client the integration tests use, then the two SQL files a deploy would run.

## Driving it with verify-oss-hub

Preconditions:

- Doctor reports the instance that this run started.
- `DATABASE_URL` names `oss_hub_verify` on `127.0.0.1` or `localhost`.
- No `GITHUB_COLLECTION_APP_PRIVATE_KEY_FILE` or `GITHUB_PUBLIC_READ_TOKEN` is exported into the command. Launch already unsets them for the app process. The drive unsets them again before the collector.

- **Collect one repository.** Run `.cursor/skills/verify-oss-hub/scripts/verify-oss-hub drive github-ledger`. The command seeds team `verify-ledger-team` and repository id `verify-ledger-repository`, then runs `CollectionSyncService.run`. `github-ledger/collector.json` reports `commitFacts` and `pullRequestFacts` of at least 1. `github-ledger/old-tables.txt` shows those counts in `CollectionCommitFact` and `CollectionPullRequestFact`.
- **Copy into the ledger.** The same command runs `github-ledger-copy.sql` and saves `github-ledger/copy.log`. The command exits non-zero if `psql` does.
- **Verify the counts.** The same command runs `github-ledger-verify.sql` and saves `github-ledger/verify.tsv`. Each data row is `check`, `expected`, `actual`, separated by tabs. `expected` equals `actual` on every row. `latest_commit_sum`, `latest_pull_request_sum`, `latest_issue_sum`, and `latest_star_sum` are greater than zero.
- **Second view.** After the command, `repo` contains github repo id `981200100001`, and `contribution` contains at least one `commit` row and one `pull_request` row for that id. `github-ledger/activity-copy.txt` shows the old history row and the ledger row for github id `981200200001` both at commit 11, pull request 2, issue 1, and star 3.

## Gotchas

- The in-memory client is the production boundary used by `apps/backend/src/github/collection-sync.member-filter.integration.spec.ts`. A drive that reaches `api.github.com` is the wrong drive.
- The collector does not write the shadow tables. If `verify.tsv` matches before the copy SQL, the run is not proof of the copy.
- This drive does not run `CollectionUserActivityService`. It inserts one `GithubUserActivityHistory` row for the synthetic member and requires the copy to reproduce those non-zero counts. A zero equals zero activity row is a failed drive.
- `github-ledger-copy.sql` aborts when team or repository periods overlap. A second drive deletes the `verify-ledger-*` rows first and collects again.
- Jenkins runs the copy file and does not run the verify file. `github-ledger-copy.integration.spec.ts` executes the verify file when backend integration tests run, on database `oss_hub_test`. This drive checks `oss_hub_verify` instead.
- `repo_stream` is not a table in this checkout. `CollectionRepositoryStream` is still the stream table. A drive that looks for `repo_stream` is the wrong check.
- `user_consolidation_backup` and production databases are out of scope. The script rejects any database name other than `oss_hub_verify`.
