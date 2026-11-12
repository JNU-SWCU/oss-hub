# GitHub 테이블 축소 계획

학생과 교직원이 보는 기여 수와 랭킹의 원천을 옛 GitHub 테이블에서 `repo`, `team_repo`, `contribution`, `github_user_activity_history`로 옮긴다. main의 스트림 테이블 이름은 `CollectionRepositoryStream`이다.

호출부를 옮긴 PR이 증명된 뒤에만 옛 테이블을 지운다. 배포 복사는 같은 값을 두 번 넣지 않는다. 지우는 PR은 운영자가 테이블 이름을 적은 뒤에만 연다.

순서는 I, A, B, C, V, D, E이다. P와 Q는 E 다음에 쌓인다. F와 K는 E에서 갈라지고 운영자 확인 뒤에 연다. G1, G2, G3, Gm, Gs, Go는 승인 뒤에만 연다.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. A nested box is a sub-step of the box above it. Check a box only when its evidence exists, a file, a log line, a screenshot, a test run, or a SHA. 본문은 하는 방법이다. 부록은 설명과 기록이다.

The program runs `playbooks/autopilot-stack.md`. 운영자가 머지한다. 에이전트는 머지하지 않는다. 이 프로그램의 PR은 드래프트로 연다. I와 A는 `main`에서 시작한다. 나머지는 부모 브랜치 위에 쌓는다. 승인 전 드래프트도 만들지 않는 PR은 F, K, G1, G2, G3, Gm, Gs, Go이다.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

## Program checklist

### Arm the program

- [ ] State the protocol and this plan to the operator, then stop. Start execution only on the operator's explicit go.
- [ ] Read these from trunk at program start. Re-read them at every tick. oss-hub trunk has no `pstack/` tree, so each `git show origin/main:` command below fails. Read the same file from the installed poteto-mode plugin when that happens.
  - [ ] `git show origin/main:pstack/skills/poteto-mode/playbooks/autopilot-stack.md`
  - [ ] `git show origin/main:pstack/skills/swarm/SKILL.md`
  - [ ] `git show origin/main:pstack/skills/control-cli/SKILL.md`
  - [ ] `git show origin/main:pstack/skills/poteto-mode/playbooks/opening-a-pr.md`
  - [ ] `git show origin/main:pstack/skills/principle-sequence-verifiable-units/SKILL.md`
  - [ ] `git show origin/main:pstack/skills/principle-make-operations-idempotent/SKILL.md`
  - [ ] `git show origin/main:pstack/skills/principle-migrate-callers-then-delete-legacy-apis/SKILL.md`
  - [ ] `git show origin/main:pstack/skills/blast-radius/SKILL.md`
  - [ ] `git show origin/main:pstack/skills/poteto-mode/playbooks/shipping.md`
- [ ] On the operator's go, arm the audit tick as `/loop 1h` with the tick prompt below. Never leave the cadence to memory.
- [ ] Use this tick prompt, verbatim. "Re-read the execution playbook from trunk. Audit the operation against it and fix drift in this tick. Probe every active lane and judge progress by side effects only. Stand down a stuck lane and dispatch its replacement now. Then post a short status message to the operator in chat only when the audit found a tracked change that no earlier status message reported, such as a PR opened, a code-ready head, a round launched or closed, a verdict, a merge, a stuck agent and the action taken, a blocker added or cleared, or a decision only the operator can make. Name every such change and nothing else. Do not repeat a table, the merged list, or an unchanged blocker. If the audit found none, end the turn with no reply text. Either way, log this tick's row in your decision trail. The row names the items reported, or none."
- [ ] On the operator's hold or stand-down, send every owner a zero-writes order at once.

### Spawn owners

- [ ] Spawn one owner per PR that this checklist says to open. Do not spawn F, K, G1, G2, G3, Gm, Gs, or Go on the initial go.
- [ ] Follow this dependency graph. Stack a child on its parent branch. I and A are independent and first. Both branch from `main`.
  - [ ] B after A, and only after I's note names no open code defect. If the note names a defect, stop and extend this plan with a fix PR before B.
  - [ ] C after B. V after C. D after V. E after D.
  - [ ] P after E. Q after P. G1 after Q. G2 after G1. Open G1 and G2 only after the operator names the tables.
  - [ ] F after E, only after the operator accepts or replaces the column placement in Appendix B. K after F. G3 after K, only if the operator names a new parent for the issuance foreign keys.
  - [ ] Gm, Gs, and Go each branch from E. Open one only after the operator writes the matching approval. Do not combine their drops.
- [ ] Hold the file boundaries. A touches the copy SQL, the verify shell, and the Jenkins copy call. B and E touch the collector repositories. C touches the stream migration. V touches only the verify shell's exit code. D touches ranking, staff insights, team evidence, and public project metrics. P and Q touch deletion counts. F does not edit `repository-deletion.repository.ts`. K touches the Jenkins copy call. Each drop PR touches only its own migration.
- [ ] Hold the review gate. D, F, Gm, Gs, and Go change an interaction. They wait for the operator's review in chat with screenshots and a video before merge.

### PR mechanics, for every PR

- [ ] Resolve the forge once. Default to `gh`. If `command -v origin` succeeds and Origin can resolve the repository, use `origin pr` for every PR operation. Record any fallback to `gh`. Never require `gt`.
- [ ] Open the PR as a draft. The operator required drafts for this program so a stack cannot merge on the ready default. Use the run's built-in PR tool with draft set. A stack child targets its parent branch. I and A target `main`.
- [ ] Run the repo's lint and typecheck once before the PR-facing push. Push with hooks on.
- [ ] Run `/deslop` before each commit and `/no-comments` before review.
- [ ] Triage every Bugbot and security-reviewer comment per `../references/bugbot-triage.md`.
- [ ] Rebase onto the parent tip before the code-ready report and babysit. Keep that merge base in fix rounds. Rebase again only at merge prep, on a `git merge-tree` conflict with the parent, on a CI failure that comes from a change on the parent, or when a known concurrent change to the same files lands.

### Verdict and merge, for every PR

- [ ] A full swarm runs once, at the code-ready head. Another full swarm runs only for new behavior, a redesign, or a large new diff. A rebase, a merge-conflict resolution, or a minor fix gets a single verifier at the new head, and a wording-only change gets none. Run each full swarm per `pstack/skills/swarm/SKILL.md`. One gates lane. The ten live lanes from the PR's **Verify, live** block. The perf lane from its **Verify, perf** block. Two or more audit lanes, each with its own focus, that read the diff and the receipts and distrust the PR body. The root audits the receipts in the merge-ready report before the verdict.
- [ ] Judge every finding by the execution playbook's blocking rule. The verdict is clean when none blocks. A failure on trunk behavior in a lane marked `Regression lane against trunk.` is recorded against trunk and does not block the PR. A new head gets a fresh verdict, except for results that stay valid under the patch-id rule in `playbooks/shipping.md`.
- [ ] Stop at verified and green. Hand the draft to the operator. Nobody pushes after that handoff without the operator's go. The operator lands the stack bottom-up. Compare `git patch-id` before reusing a verdict after a restack. The agent does not merge.

### Boot recipe, for every live lane

Each live lane runs on its own cloud VM at the PR head. The named driver is `.cursor/skills/verify-oss-hub/scripts/verify-oss-hub` from commit `d4bbbd6885bccefa1cb05d1d28a5a112e98d71f0` when the head does not contain that skill yet. That commit is open PR 1789. `control-cli` is not installed here. Appendix C records that gap. The driver refuses any database other than `oss_hub_verify` on the loopback host.

- [ ] `git fetch origin <head-branch> && git checkout <head SHA>`.
- [ ] If the head has no `verify-oss-hub` script, check out that directory from `d4bbbd6885bccefa1cb05d1d28a5a112e98d71f0` and do not commit it. Start Docker, then run the script's launch command and wait for the ready line on stderr.
- [ ] Drive with `doctor` and `drive` commands only. Production parity is a separate session that starts with `BEGIN READ ONLY` and sets `statement_timeout` to 5 seconds. Do not print logins, credentials, or row bodies.
- [ ] Save every screenshot to `/tmp/swarm-<pr-id>/worker-<n>/<slug>.png` and return the paths with the report.

## 기여 사실 정지를 조사한다 (I)

범위는 읽기 전용 조회와 원인 기록이다. 백필은 하지 않는다. 롤백은 조회 파일을 되돌리는 것이다. 기존 행은 그대로 남는다. 코드 결함이 적히면 B를 열지 않고 계획을 늘린다. 운영자 결정은 없다.

**Depends on.** None.

**Files.**

- [ ] Create `apps/backend/prisma/contribution-stall-queries.sql`.
- [ ] Create `apps/backend/prisma/contribution-stall-queries.test.mjs`.

**Build.**

- [ ] Put only `BEGIN READ ONLY` statements in the SQL file. Compare `max(observedAt)` on the four fact tables with `max(first_seen_at)` on `contribution`, `max(sweepFinishedAt)` and the sum of inserted counts on `CollectionSweepHistory`, `max(lastRunAt)` on `CollectionRepositoryStream`, and the count of unexpired `CollectionCutoverLease` rows.
- [ ] Use `observedAt` for fact inserts. `committedAt` and issue `createdAt` are GitHub event times. `observedAt` is the insert clock.
- [ ] Write the cause in the PR body only after those queries run. A sweep that inserts nothing while `lastRunAt` moves still needs those counts. Run `onlyRegisteredFacts` in `collection-incremental.repository.ts` and the quiesce check in `collection-trigger.service.ts` as part of that measurement.

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
SELECT 'commit_fact_max' AS check, max("observedAt")::text AS value FROM "CollectionCommitFact";
SELECT 'pull_request_fact_max', max("observedAt")::text FROM "CollectionPullRequestFact";
SELECT 'release_fact_max', max("observedAt")::text FROM "CollectionReleaseFact";
SELECT 'issue_fact_max', max("observedAt")::text FROM "GithubIssueHistory";
SELECT 'contribution_first_seen_max', max("first_seen_at")::text FROM "contribution";
SELECT 'sweep_finished_max', max("sweepFinishedAt")::text FROM "CollectionSweepHistory";
SELECT 'stream_last_run_max', max("lastRunAt")::text FROM "CollectionRepositoryStream";
SELECT 'cutover_lease_open', count(*)::text FROM "CollectionCutoverLease" WHERE "expiresAt" > statement_timestamp();
```

**You see.**

- [ ] The PR records one cause. The cause names a file and a line, or it says the collector ran and GitHub returned no new accepted facts.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run `node --test apps/backend/prisma/contribution-stall-queries.test.mjs`. The test fails if the SQL file contains a write statement.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.7-xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run the head SQL text on a verify database built at trunk and at head. Trunk has no query file, so record that and gate the head file plus an unchanged seeded row count. Save `I-regression.png`. Pass when both runs return the same seeded counts and neither run writes a row.
- [ ] Lane 2. Run `verify-oss-hub doctor` on the head. Save `I-doctor.png`. Pass when the output contains doctor ok and names database oss_hub_verify.
- [ ] Lane 3. Run `verify-oss-hub drive github-ledger` on the head. Save `I-ledger.png`. Pass when verify.tsv has equal expected and actual on every row and the four latest sums are greater than zero.
- [ ] Lane 4. Run `verify-oss-hub drive activity-ranking` on the head. Save `I-ranking.png`. Pass when the first public rows are verify-rank-alpha then verify-rank-beta with totals 18 and 8.
- [ ] Lane 5. Run `verify-oss-hub drive team-activity` on the head. Save `I-activity.png`. Pass when the chart totals match the seeded contribution counts.
- [ ] Lane 6. Run `verify-oss-hub drive browse-programs` on the head. Save `I-programs.png`. Pass when the seeded program is listed.
- [ ] Lane 7. Run `verify-oss-hub drive team-management` on the head. Save `I-teams.png`. Pass when an anonymous session does not receive the staff list.
- [ ] Lane 8. Prod parity. Run the Build SQL in a production session that is already read only, with statement_timeout of 5 seconds. Save `I-prod.png`. Pass when the image shows the eight check names and values, and no login or row body.
- [ ] Lane 9. On the verify database, confirm the test file rejects INSERT, UPDATE, DELETE, DROP, ALTER, and TRUNCATE. Save `I-readonly.png`. Pass when `node --test` exits 0.
- [ ] Lane 10. Point `verify-oss-hub drive github-ledger` at a database name other than oss_hub_verify. Save `I-refuse-prod.png`. Pass when the command fails and prints that DATABASE_URL is not the local oss_hub_verify database.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Runtime of each stall query on the verify database, and the same statements on production.
- [ ] Probe. Run the SQL file with `\timing` on the verify database at trunk (ad hoc text) and at head (the committed file). Then run it once in the read-only production session. Interleave verify before production.
- [ ] Baseline. Record the trunk ad hoc timing first. Trunk has no file. The ad hoc text is the head file.
- [ ] Rule. Fail the PR when any statement exceeds 5000 ms. Do not compare production time to the verify time as a ratio.

**Review gate.** None. This PR is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto the parent tip, or onto trunk for I and A, with git patch-id unchanged from the verdict.
- [ ] The owner stops at merge-ready. The operator lands this draft. The agent does not merge.
- [ ] Rollback deletes the two new files. Data loss risk is none because the SQL is read only.

## 이력 복사를 값이 바뀔 때만 추가한다 (A)

범위는 `GithubUserActivityHistory`에서 `github_user_activity_history`로 복사하는 INSERT와, 검증 결과를 배포 로그에 남기는 스크립트다. 스냅샷 INSERT는 이미 값 비교가 있다. 백필은 하지 않고 기존 중복 행도 지우지 않는다. 롤백은 SQL과 스크립트와 Jenkins 호출을 되돌리는 것이다. 기존 행은 그대로 남는다. 운영자 결정은 없다.

**Depends on.** None.

**Files.**

- [ ] Edit `apps/backend/prisma/github-ledger-copy.sql`.
- [ ] Create `apps/backend/prisma/github-ledger-verify.sh`.
- [ ] Edit `Jenkinsfile` so the ordinary deploy runs that script after the copy and keeps going when counts differ.
- [ ] Create `apps/backend/prisma/github-ledger-copy.history-change.test.sh`.
- [ ] Edit `.github/workflows/ci.yml` to run the new test next to the existing ledger transition test.

**Build.**

- [ ] Add the five-count `NOT EXISTS` check from the snapshot INSERT to the history INSERT. Keep `ON CONFLICT DO NOTHING`. Do not change the snapshot INSERT.
- [ ] The shell runs `github-ledger-verify.sql`, prints `verify_mismatch` when expected and actual differ, and exits 0. The SQL file itself has no RAISE.

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
WITH ordered AS (
  SELECT "commit_count", "pull_request_count", "issue_count", "repository_count", "star_count",
    lag("commit_count") OVER w AS prev_commit,
    lag("pull_request_count") OVER w AS prev_pull_request,
    lag("issue_count") OVER w AS prev_issue,
    lag("repository_count") OVER w AS prev_repository,
    lag("star_count") OVER w AS prev_star
  FROM "github_user_activity_history"
  WINDOW w AS (PARTITION BY "github_id", "year", "visibility" ORDER BY "observed_at")
)
SELECT count(*)::text AS rows,
  count(*) FILTER (
    WHERE prev_commit IS NOT NULL
      AND "commit_count" = prev_commit
      AND "pull_request_count" = prev_pull_request
      AND "issue_count" = prev_issue
      AND "repository_count" = prev_repository
      AND "star_count" = prev_star
  )::text AS same_value_as_previous
FROM ordered;
```

**You see.**

- [ ] A second copy with a new observed_at and the same five counts inserts 0 rows. A second copy with a changed count inserts 1 row.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run `bash apps/backend/prisma/github-ledger-copy.history-change.test.sh` and `bash apps/backend/prisma/github-ledger-copy.transitions.test.sh`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.7-xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. On both checkouts, copy once, move observed_at, keep the five counts, and copy again. Save `A-regression.png`. Pass when trunk's second copy inserts 1 row and head's second copy inserts 0.
- [ ] Lane 2. Run `verify-oss-hub doctor` on the head. Save `A-doctor.png`. Pass when the output contains doctor ok and names database oss_hub_verify.
- [ ] Lane 3. Run `verify-oss-hub drive github-ledger` on the head. Save `A-ledger.png`. Pass when verify.tsv has equal expected and actual on every row and the four latest sums are greater than zero.
- [ ] Lane 4. Run `verify-oss-hub drive activity-ranking` on the head. Save `A-ranking.png`. Pass when the first public rows are verify-rank-alpha then verify-rank-beta with totals 18 and 8.
- [ ] Lane 5. Run `verify-oss-hub drive team-activity` on the head. Save `A-activity.png`. Pass when the chart totals match the seeded contribution counts.
- [ ] Lane 6. Run `verify-oss-hub drive browse-programs` on the head. Save `A-programs.png`. Pass when the seeded program is listed.
- [ ] Lane 7. Run `verify-oss-hub drive team-management` on the head. Save `A-teams.png`. Pass when an anonymous session does not receive the staff list.
- [ ] Lane 8. Prod parity. Run the Build query in a read-only production session with statement_timeout of 5 seconds. Save `A-prod.png`. Pass when the image shows rows and same_value_as_previous. A non-zero duplicate count does not fail this PR.
- [ ] Lane 9. Change one count, copy again, and read the new row. Save `A-changed.png`. Pass when head inserts exactly one row and the latest counts match the old table.
- [ ] Lane 10. Run the verify shell against a drifted fixture. Save `A-mismatch-log.png`. Pass when it prints verify_mismatch and exits 0.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Rows inserted by a second history copy after observed_at changes and the five counts stay the same. Also the wall time of that copy.
- [ ] Probe. Run the history-change test at trunk and at head, interleaved, on the same Postgres 17 database the transition test uses.
- [ ] Baseline. Record trunk's inserted row count and wall time first. The prototype on Postgres 16.15 inserted 1 row for this case.
- [ ] Rule. Fail the PR when head inserts any row in the same-count case, or when head's wall time is more than twice the trunk wall time.

**Review gate.** None. This PR is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto the parent tip, or onto trunk for I and A, with git patch-id unchanged from the verdict.
- [ ] The owner stops at merge-ready. The operator lands this draft. The agent does not merge.
- [ ] Rollback restores the old INSERT and removes the Jenkins log call. Existing duplicate rows stay. This PR deletes nothing.

## 사실과 이력을 새 테이블에 같이 쓴다 (B)

범위는 사실 네 종류와 개인 활동 관측이다. `repo`와 `team_repo`는 배포 복사가 계속 쓴다. 기간을 두 경로가 같이 쓰면 배제 제약이 다음 배포를 막을 수 있다. 백필은 하지 않는다. 배포 복사가 빈 구간을 메운다. 롤백은 이미지를 되돌리는 것이다. 새 행은 남아도 아직 화면이 읽지 않는다. I의 기록에 코드 결함이 있으면 이 PR을 열지 않는다.

**Depends on.** A, and I's cause note with no open code defect.

**Files.**

- [ ] Edit `apps/backend/src/github/collection-incremental.repository.ts`.
- [ ] Edit `apps/backend/src/github/repository-provision-job.repository.ts`.
- [ ] Edit the unit specs beside those files.

**Build.**

- [ ] In the same transaction as each fact `createMany`, insert into `contribution` with `ON CONFLICT DO NOTHING` on repo id, kind, and github key.
- [ ] When `upsertObservation` or `upsertPrivateObservation` writes the old history row, insert into `github_user_activity_history` only when the five counts differ from the latest row for that github id, year, and visibility.
- [ ] Do not write `repo` or `team_repo` from the collector in this PR. Leave `TeamArchiveRepository.run` as the only app writer of `team_repo`.

**You see.**

- [ ] A second collect of the same commit does not add a second `contribution` row. A second observation with the same five counts does not add a history row.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run `pnpm --filter backend exec jest --testPathPattern='collection-incremental.repository.spec.ts|collection-user-activity.service.spec.ts' --testPathIgnorePatterns='[]'`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.7-xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run `verify-oss-hub drive github-ledger` at trunk and head. Trunk's collector does not write `contribution`. Head's collector does, and the following copy still matches verify.tsv. Save `B-regression.png`. Pass when head verify.tsv matches and trunk's pre-copy `contribution` count for the synthetic repo is 0.
- [ ] Lane 2. Run `verify-oss-hub doctor` on the head. Save `B-doctor.png`. Pass when the output contains doctor ok and names database oss_hub_verify.
- [ ] Lane 3. Run `verify-oss-hub drive github-ledger` on the head. Save `B-ledger.png`. Pass when verify.tsv has equal expected and actual on every row and the four latest sums are greater than zero.
- [ ] Lane 4. Run `verify-oss-hub drive activity-ranking` on the head. Save `B-ranking.png`. Pass when the first public rows are verify-rank-alpha then verify-rank-beta with totals 18 and 8.
- [ ] Lane 5. Run `verify-oss-hub drive team-activity` on the head. Save `B-activity.png`. Pass when the chart totals match the seeded contribution counts.
- [ ] Lane 6. Run `verify-oss-hub drive browse-programs` on the head. Save `B-programs.png`. Pass when the seeded program is listed.
- [ ] Lane 7. Run `verify-oss-hub drive team-management` on the head. Save `B-teams.png`. Pass when an anonymous session does not receive the staff list.
- [ ] Lane 8. Prod parity. Run `github-ledger-verify.sql` inside a read-only production session with statement_timeout of 5 seconds. Save `B-prod.png`. Pass when the image shows each check. Unequal sums do not block this PR. They block V.
- [ ] Lane 9. Collect the synthetic repository twice. Save `B-second-collect.png`. Pass when the second collect adds 0 contribution rows and 0 same-count history rows.
- [ ] Lane 10. Archive a synthetic team and then run the copy. Save `B-archive.png`. Pass when the open team_repo period closes once and the copy does not raise an exclusion error.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Contribution rows after two collects of one synthetic repository, and the time of the second collect.
- [ ] Probe. Run the github-ledger drive, then the collector once more, at trunk and at head, interleaved.
- [ ] Baseline. Record trunk's post-copy contribution count and second-collect time first.
- [ ] Rule. Fail when head's contribution count is not equal to the distinct fact count, when the second collect adds a row, or when the second collect takes more than twice the trunk time.

**Review gate.** None. This PR is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto the parent tip, or onto trunk for I and A, with git patch-id unchanged from the verdict.
- [ ] The owner stops at merge-ready. The operator lands this draft. The agent does not merge.
- [ ] Rollback is the previous image. Rows already written to the new tables stay. No table is dropped.

## 스트림에 sync_epoch를 추가한다 (C)

범위는 `CollectionRepositoryStream`의 nullable `sync_epoch`와, 그 값을 조건에 넣는 스트림 쓰기다. 테이블 이름은 바꾸지 않는다. `CollectionSyncLease`와 `CollectionCutoverLease`는 그대로 잠금이다. 백필은 빈 값이다. 롤백은 코드를 되돌리고 컬럼은 남겨도 된다. 기존 행은 그대로 남는다. 이름 변경과 커서 이동은 운영자 결정이라 이 PR에 넣지 않는다.

**Depends on.** B.

**Files.**

- [ ] Create a Prisma migration that adds nullable `sync_epoch` to `CollectionRepositoryStream`.
- [ ] Edit `apps/backend/prisma/schema.prisma`.
- [ ] Edit `apps/backend/src/github/collection-incremental.repository.ts`.
- [ ] Edit `apps/backend/src/github/collection-incremental.repository.spec.ts`.

**Build.**

- [ ] Add `sync_epoch` as a nullable bigint with no default that locks the table longer than an add-column.
- [ ] A stream update writes the next epoch only when the stored epoch is null or equal to the caller's epoch. A stale epoch writes nothing and raises a typed error.
- [ ] Do not rename the table. Do not drop either lease table. Do not move `CollectionSyncCursor`.

**You see.**

- [ ] A stale epoch leaves the stream row unchanged. A current epoch advances it by one.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run `pnpm --filter backend exec jest --testPathPattern='collection-incremental.repository.spec.ts' --testPathIgnorePatterns='[]'`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.7-xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run `verify-oss-hub drive github-ledger` at trunk and head. Trunk has no sync_epoch. Record that, and gate a successful collect plus a stream row at head. Save `C-regression.png`. Pass when head's collect writes one commit fact and the stream row has a non-null sync_epoch.
- [ ] Lane 2. Run `verify-oss-hub doctor` on the head. Save `C-doctor.png`. Pass when the output contains doctor ok and names database oss_hub_verify.
- [ ] Lane 3. Run `verify-oss-hub drive github-ledger` on the head. Save `C-ledger.png`. Pass when verify.tsv has equal expected and actual on every row and the four latest sums are greater than zero.
- [ ] Lane 4. Run `verify-oss-hub drive activity-ranking` on the head. Save `C-ranking.png`. Pass when the first public rows are verify-rank-alpha then verify-rank-beta with totals 18 and 8.
- [ ] Lane 5. Run `verify-oss-hub drive team-activity` on the head. Save `C-activity.png`. Pass when the chart totals match the seeded contribution counts.
- [ ] Lane 6. Run `verify-oss-hub drive browse-programs` on the head. Save `C-programs.png`. Pass when the seeded program is listed.
- [ ] Lane 7. Run `verify-oss-hub drive team-management` on the head. Save `C-teams.png`. Pass when an anonymous session does not receive the staff list.
- [ ] Lane 8. Prod parity. In a read-only production session, select count of `CollectionRepositoryStream` rows and count of null `sync_epoch` after the migration deploy. Save `C-prod.png`. Pass when the row count matches the pre-deploy count. Before deploy, record that the column is absent.
- [ ] Lane 9. Send a stale epoch update. Save `C-stale.png`. Pass when the command fails with the typed error and the stream row is unchanged.
- [ ] Lane 10. Run the copy SQL after a collect. Save `C-copy.png`. Pass when the copy exits 0 and does not update sync_epoch.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Time to add the nullable column on the transition test's Postgres 17 database, and time of one stream update.
- [ ] Probe. Run the migration and one stream update at trunk and at head, interleaved. Trunk has no column, so trunk's column time is recorded as absent and the update time is the existing stream update.
- [ ] Baseline. Record the trunk stream-update time first.
- [ ] Rule. Fail when the head migration exceeds 1000 ms on that database, or when the head stream update takes more than twice the trunk update time.

**Review gate.** None. This PR is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto the parent tip, or onto trunk for I and A, with git patch-id unchanged from the verdict.
- [ ] The owner stops at merge-ready. The operator lands this draft. The agent does not merge.
- [ ] Rollback reverts the writer. The nullable column may stay. This PR drops nothing.

## 검증 불일치를 배포 실패로 바꾼다 (V)

범위는 `github-ledger-verify.sh`의 종료 코드뿐이다. 백필은 없다. 롤백은 불일치 때 종료 코드 0으로 되돌리는 것이다. 기존 행은 그대로 남는다. 운영 조회에서 최신 합이 하나라도 다르면 실패 비트는 켜지 않고 이 PR은 멈춘다.

**Depends on.** C.

**Files.**

- [ ] Edit `apps/backend/prisma/github-ledger-verify.sh`.

**Build.**

- [ ] Change the mismatch path from exit 0 to exit 1. Leave the Jenkins call from A in place.
- [ ] Before that edit is committed, run the production read of `github-ledger-verify.sql`. If any expected value differs from actual, stop this PR and report the checks. Do not weaken the SQL to make the deploy pass.

**You see.**

- [ ] A drifted fixture fails the shell. A matched fixture exits 0.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run `bash apps/backend/prisma/github-ledger-verify.sh` against a matched fixture and a drifted fixture in the history-change test.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.7-xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run the verify shell on a drifted fixture at trunk and head. Trunk exits 0 and prints verify_mismatch. Head exits 1. Save `V-regression.png`. Pass when those two exit codes are the ones just named.
- [ ] Lane 2. Run `verify-oss-hub doctor` on the head. Save `V-doctor.png`. Pass when the output contains doctor ok and names database oss_hub_verify.
- [ ] Lane 3. Run `verify-oss-hub drive github-ledger` on the head. Save `V-ledger.png`. Pass when verify.tsv has equal expected and actual on every row and the four latest sums are greater than zero.
- [ ] Lane 4. Run `verify-oss-hub drive activity-ranking` on the head. Save `V-ranking.png`. Pass when the first public rows are verify-rank-alpha then verify-rank-beta with totals 18 and 8.
- [ ] Lane 5. Run `verify-oss-hub drive team-activity` on the head. Save `V-activity.png`. Pass when the chart totals match the seeded contribution counts.
- [ ] Lane 6. Run `verify-oss-hub drive browse-programs` on the head. Save `V-programs.png`. Pass when the seeded program is listed.
- [ ] Lane 7. Run `verify-oss-hub drive team-management` on the head. Save `V-teams.png`. Pass when an anonymous session does not receive the staff list.
- [ ] Lane 8. Prod parity. Run `github-ledger-verify.sql` in a read-only production session with statement_timeout of 5 seconds. Save `V-prod.png`. Pass when every expected equals actual. If any pair differs, this lane fails and the fail bit stays off.
- [ ] Lane 9. Run the shell on the verify database after `drive github-ledger`. Save `V-match.png`. Pass when the shell exits 0.
- [ ] Lane 10. Drift one history count on the verify database and run the shell. Save `V-drift.png`. Pass when the shell exits 1 and the database has no new write from the shell.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Wall time of `github-ledger-verify.sql` on the verify database.
- [ ] Probe. Run the SQL at trunk and at head, interleaved, after the same github-ledger drive.
- [ ] Baseline. Record the trunk time first. Trunk and head share the same SQL file unless a parent changed it.
- [ ] Rule. Fail when head's verify time is more than twice the trunk time, or when the matched fixture does not finish under 5000 ms.

**Review gate.** None. This PR is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto the parent tip, or onto trunk for I and A, with git patch-id unchanged from the verdict.
- [ ] The owner stops at merge-ready. The operator lands this draft. The agent does not merge.
- [ ] Do not land while the production lane shows a mismatch. Rollback restores exit 0 on mismatch. This PR writes no table.

## 랭킹과 팀 기여 읽기를 새 테이블로 바꾼다 (D)

범위는 랭킹, 교직원 인사이트, 팀 기여 증거, 공개 프로젝트 지표의 읽기다. 월별 차트는 `GithubUserActivityMonthly`를 그대로 읽는다. 백필은 없다. 롤백은 이미지를 되돌리는 것이다. 옛 테이블이 아직 쓰이므로 화면 데이터는 돌아온다. 월별 백필 여부는 운영자 결정이라 이 PR에 넣지 않는다.

**Depends on.** V.

**Files.**

- [ ] Edit `apps/backend/src/ranking/ranking.repository.ts`.
- [ ] Edit `apps/backend/src/staff/staff-insights.repository.ts`.
- [ ] Edit `apps/backend/src/programs/program-team-repository-evidence.repository.ts`.
- [ ] Edit `apps/backend/src/programs/public-project-metrics.repository.ts`.
- [ ] Create a migration for views `contributor_standing` and `repo_contribution`.
- [ ] Edit the unit and integration specs that read those repositories.

**Build.**

- [ ] `contributor_standing` is the latest `github_user_activity_history` row per github id, year, and visibility. Ranking and staff insights read that view. The query returns one latest row per key.
- [ ] `repo_contribution` groups `contribution` by repository, author, and Seoul date. It keeps the same author set the old `Contribution` rebuild writes. A test on the verify database must match the old table before the reader switches.
- [ ] Leave `findMonthlySnapshots` on `GithubUserActivityMonthly`. Do not recompute January through October 2026 from history.

**You see.**

- [ ] Two history rows for one key contribute the latest counts once. The team evidence totals match the old daily table on the verify seed.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run `pnpm --filter backend exec jest --testPathPattern='ranking.repository.spec.ts|staff-insights.repository.spec.ts' --testPathIgnorePatterns='[]'`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.7-xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run `verify-oss-hub drive activity-ranking` and `drive team-activity` at trunk and head. Save `D-regression.png`. Pass when both sides show verify-rank-alpha then verify-rank-beta with totals 18 and 8, and the same seeded chart totals.
- [ ] Lane 2. Run `verify-oss-hub doctor` on the head. Save `D-doctor.png`. Pass when the output contains doctor ok and names database oss_hub_verify.
- [ ] Lane 3. Run `verify-oss-hub drive github-ledger` on the head. Save `D-ledger.png`. Pass when verify.tsv has equal expected and actual on every row and the four latest sums are greater than zero.
- [ ] Lane 4. Run `verify-oss-hub drive activity-ranking` on the head. Save `D-ranking.png`. Pass when the first public rows are verify-rank-alpha then verify-rank-beta with totals 18 and 8.
- [ ] Lane 5. Run `verify-oss-hub drive team-activity` on the head. Save `D-activity.png`. Pass when the chart totals match the seeded contribution counts.
- [ ] Lane 6. Run `verify-oss-hub drive browse-programs` on the head. Save `D-programs.png`. Pass when the seeded program is listed.
- [ ] Lane 7. Run `verify-oss-hub drive team-management` on the head. Save `D-teams.png`. Pass when an anonymous session does not receive the staff list.
- [ ] Lane 8. Prod parity. In a read-only production session, hash the top ranking page's ordered github ids from the old reader SQL and from `contributor_standing`. Save `D-prod.png`. Pass when the two hashes match. Do not print names.
- [ ] Lane 9. Insert two observations for one synthetic user and open the ranking API. Save `D-latest.png`. Pass when the totals equal the latest observation once.
- [ ] Lane 10. Open the monthly chart for the seeded year. Save `D-monthly.png`. Pass when the chart still reads `GithubUserActivityMonthly` and the seeded points are unchanged from trunk.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Time to answer the ranking API on the verify seed, from request start to the JSON body.
- [ ] Probe. Request the public ranking at trunk and at head, interleaved, after doctor passes. Repeat the pair three times and use the median.
- [ ] Baseline. Record the trunk median first.
- [ ] Rule. Fail when the head median is more than twice the trunk median, or when the head median exceeds 1000 ms.

**Review gate.** The operator reviews before merge.

- [ ] Copy the ranking and team-activity screenshots into `docs/evidence/github-table-reduction/D-review-ranking.png` and `docs/evidence/github-table-reduction/D-review-activity.png`.
- [ ] Record a 30 to 60 second video of the ranking page and the team activity chart on a lane VM. Save it as `docs/evidence/github-table-reduction/D-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto the parent tip, or onto trunk for I and A, with git patch-id unchanged from the verdict.
- [ ] The owner stops at merge-ready. The operator lands this draft. The agent does not merge.
- [ ] Rollback is the previous image. History rows stay. The monthly chart is unchanged, so this PR does not drop October or earlier points.

## 옛 사실 쓰기를 끊는다 (E)

범위는 사실 네 종류의 옛 `createMany`, 일별 `Contribution` 재집계, 사이클 스냅샷 교체, 옛 이력 upsert의 원천 역할이다. 월별, 외부인, 스위프 이력 쓰기는 남긴다. 배포 복사의 INSERT도 남긴다. 백필은 없다. 롤백 이미지 동안 생긴 행은 새 테이블에만 있다. 화면은 D가 새 테이블을 읽으므로 유지된다. 옛 테이블을 다시 원천으로 쓰려면 그 구간을 되돌려 복사해야 한다.

**Depends on.** D.

**Files.**

- [ ] Edit `apps/backend/src/github/collection-incremental.repository.ts`.
- [ ] Edit `apps/backend/src/github/repository-provision-job.repository.ts`.
- [ ] Edit the specs that expect the old writes.

**Build.**

- [ ] Stop `createMany` into `CollectionCommitFact`, `CollectionPullRequestFact`, `CollectionReleaseFact`, and `GithubIssueHistory`. Keep the `contribution` insert from B.
- [ ] Stop the daily `Contribution` delete and insert. Stop the cycle-snapshot delete and copy. Stop upserting `GithubUserActivityHistory` and `GithubUserActivityCycleSnapshot`.
- [ ] Keep monthly upserts, outsider writes, and `CollectionSweepHistory` writes. Keep the deploy copy SQL.

**You see.**

- [ ] After one synthetic collect, the old fact tables gain 0 rows and `contribution` gains the new facts.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run `pnpm --filter backend exec jest --testPathPattern='collection-incremental.repository.spec.ts|collection-user-activity.service.spec.ts' --testPathIgnorePatterns='[]'`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.7-xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run `verify-oss-hub drive github-ledger` at trunk and head. Trunk still fills the old fact tables. Head fills `contribution` and leaves those old counts unchanged. Save `E-regression.png`. Pass when that split is visible in old-tables.txt and verify.tsv still matches under the updated expectations.
- [ ] Lane 2. Run `verify-oss-hub doctor` on the head. Save `E-doctor.png`. Pass when the output contains doctor ok and names database oss_hub_verify.
- [ ] Lane 3. Run `verify-oss-hub drive github-ledger` on the head. Save `E-ledger.png`. Pass when verify.tsv has equal expected and actual on every row and the four latest sums are greater than zero.
- [ ] Lane 4. Run `verify-oss-hub drive activity-ranking` on the head. Save `E-ranking.png`. Pass when the first public rows are verify-rank-alpha then verify-rank-beta with totals 18 and 8.
- [ ] Lane 5. Run `verify-oss-hub drive team-activity` on the head. Save `E-activity.png`. Pass when the chart totals match the seeded contribution counts.
- [ ] Lane 6. Run `verify-oss-hub drive browse-programs` on the head. Save `E-programs.png`. Pass when the seeded program is listed.
- [ ] Lane 7. Run `verify-oss-hub drive team-management` on the head. Save `E-teams.png`. Pass when an anonymous session does not receive the staff list.
- [ ] Lane 8. Prod parity. Before the deploy that contains E, store the fact counts in the PR. After one production collect window, read those counts again in a read-only session. Save `E-prod.png`. Pass when the old fact counts stay at the stored numbers and `contribution` has moved.
- [ ] Lane 9. Collect twice. Save `E-twice.png`. Pass when the second collect adds 0 duplicate contribution rows.
- [ ] Lane 10. Run the monthly observation path. Save `E-monthly-still.png`. Pass when `GithubUserActivityMonthly` still receives the upsert.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Time of one synthetic collect, and rows written to the old fact tables.
- [ ] Probe. Run `drive github-ledger` at trunk and head, interleaved.
- [ ] Baseline. Record trunk's collect time and old-fact insert count first.
- [ ] Rule. Fail when head writes any old fact row, or when head's collect time is more than twice the trunk time.

**Review gate.** None. This PR is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto the parent tip, or onto trunk for I and A, with git patch-id unchanged from the verdict.
- [ ] The owner stops at merge-ready. The operator lands this draft. The agent does not merge.
- [ ] Rollback restores old writers. The gap while this image ran is only in the new tables. Copy that gap back before using the old tables as the source again.

## 연간 집계 읽기를 제거한다 (P)

범위는 삭제 건수와 수명 주기 설정이 연간 집계 두 테이블을 세는 부분이다. 테이블은 지우지 않는다. 백필은 없다. 롤백은 그 조회를 되돌리는 것이다. 집계 행은 그대로 남는다. 드롭 승인과는 별도다.

**Depends on.** E.

**Files.**

- [ ] Edit `apps/backend/src/platform/repository-deletion.repository.ts`.
- [ ] Edit `apps/backend/src/programs/program-lifecycle.config.ts`.
- [ ] Edit the specs that assert those two counts.

**Build.**

- [ ] Remove the counts and config entries for `CollectionRepositoryYearAggregate` and `CollectionContributorYearAggregate`.
- [ ] Leave fact, issue, outsider, and stream counts in place for Q.

**You see.**

- [ ] A repository deletion receipt no longer names the two year-aggregate tables.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run `pnpm --filter backend exec jest --testPathPattern='repository-deletion|program-lifecycle' --testPathIgnorePatterns='[]'`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.7-xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Delete a synthetic repository at trunk and head. Trunk's receipt includes the two aggregate counts. Head's receipt does not. Save `P-regression.png`. Pass when the repository is gone on both sides and only trunk names those tables.
- [ ] Lane 2. Run `verify-oss-hub doctor` on the head. Save `P-doctor.png`. Pass when the output contains doctor ok and names database oss_hub_verify.
- [ ] Lane 3. Run `verify-oss-hub drive github-ledger` on the head. Save `P-ledger.png`. Pass when verify.tsv has equal expected and actual on every row and the four latest sums are greater than zero.
- [ ] Lane 4. Run `verify-oss-hub drive activity-ranking` on the head. Save `P-ranking.png`. Pass when the first public rows are verify-rank-alpha then verify-rank-beta with totals 18 and 8.
- [ ] Lane 5. Run `verify-oss-hub drive team-activity` on the head. Save `P-activity.png`. Pass when the chart totals match the seeded contribution counts.
- [ ] Lane 6. Run `verify-oss-hub drive browse-programs` on the head. Save `P-programs.png`. Pass when the seeded program is listed.
- [ ] Lane 7. Run `verify-oss-hub drive team-management` on the head. Save `P-teams.png`. Pass when an anonymous session does not receive the staff list.
- [ ] Lane 8. Prod parity. In a read-only production session, select the two aggregate counts and confirm no writer session is required. Save `P-prod.png`. Pass when the image shows the two counts and the head code has no query of those tables.
- [ ] Lane 9. Search the head for the two model names outside migrations and the schema's ignore block. Save `P-search.png`. Pass when the product source has no remaining query.
- [ ] Lane 10. Run `drive github-ledger`. Save `P-ledger.png`. Pass when the collect still exits 0. This PR does not change collection.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Time of the deletion receipt query on the verify database.
- [ ] Probe. Run the deletion against one synthetic repository at trunk and head, interleaved.
- [ ] Baseline. Record the trunk receipt time first.
- [ ] Rule. Fail when the head receipt time is more than twice the trunk time.

**Review gate.** None. This PR is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto the parent tip, or onto trunk for I and A, with git patch-id unchanged from the verdict.
- [ ] The owner stops at merge-ready. The operator lands this draft. The agent does not merge.
- [ ] Rollback restores the two count fields. The tables stay. This PR is not a drop.

## 드롭 대상의 남은 읽기를 제거한다 (Q)

범위는 G2가 지울 테이블을 제품 코드가 아직 읽는 곳이다. 테이블은 지우지 않는다. 백필은 없다. 롤백은 조회를 되돌리는 것이다. 행은 그대로 남는다. G2 승인 없이 이 PR만 배포하면 삭제 영수증이 아직 있는 테이블을 빠뜨린다. 운영자는 Q와 G2를 같은 점검 창에서 올린다.

**Depends on.** P.

**Files.**

- [ ] Edit `apps/backend/src/platform/repository-deletion.repository.ts`.
- [ ] Edit any remaining product reader the search names.
- [ ] Edit `apps/backend/prisma/github-ledger-verify.sql` so it no longer reads tables G2 will drop.

**Build.**

- [ ] Remove product queries of `CollectionCommitFact`, `CollectionPullRequestFact`, `CollectionReleaseFact`, `GithubIssueHistory`, `Contribution`, `GithubUserActivityHistory`, and `GithubUserActivityCycleSnapshot`.
- [ ] Keep queries of `GithubUserActivityMonthly`, `GithubRepositoryOutsiderContribution`, `CollectionSweepHistory`, `CollectionRepositoryStream`, `CollectionSyncCursor`, and `GithubRepository`.

**You see.**

- [ ] A repository search of product source finds no query of the seven tables, and the verify shell still exits 0 on the verify database.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run `pnpm --filter backend exec jest --testPathPattern='repository-deletion' --testPathIgnorePatterns='[]'` and `bash apps/backend/prisma/github-ledger-copy.history-change.test.sh`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.7-xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run the deletion receipt at trunk and head. Trunk still counts fact tables. Head does not. Save `Q-regression.png`. Pass when head deletes the synthetic repository and omits those counts.
- [ ] Lane 2. Run `verify-oss-hub doctor` on the head. Save `Q-doctor.png`. Pass when the output contains doctor ok and names database oss_hub_verify.
- [ ] Lane 3. Run `verify-oss-hub drive github-ledger` on the head. Save `Q-ledger.png`. Pass when verify.tsv has equal expected and actual on every row and the four latest sums are greater than zero.
- [ ] Lane 4. Run `verify-oss-hub drive activity-ranking` on the head. Save `Q-ranking.png`. Pass when the first public rows are verify-rank-alpha then verify-rank-beta with totals 18 and 8.
- [ ] Lane 5. Run `verify-oss-hub drive team-activity` on the head. Save `Q-activity.png`. Pass when the chart totals match the seeded contribution counts.
- [ ] Lane 6. Run `verify-oss-hub drive browse-programs` on the head. Save `Q-programs.png`. Pass when the seeded program is listed.
- [ ] Lane 7. Run `verify-oss-hub drive team-management` on the head. Save `Q-teams.png`. Pass when an anonymous session does not receive the staff list.
- [ ] Lane 8. Prod parity. Read-only counts of the seven tables, saved before this deploy. Save `Q-prod.png`. Pass when the image shows the seven counts. The PR does not require those counts to be zero.
- [ ] Lane 9. Search product source for the seven table names. Save `Q-search.png`. Pass when the only matches are migrations, the copy SQL, and this PR's deletion edit.
- [ ] Lane 10. Run the verify shell on the verify database. Save `Q-verify.png`. Pass when it exits 0 without reading the seven tables.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Time of the deletion receipt after the fact counts are removed.
- [ ] Probe. Run one synthetic deletion at trunk and head, interleaved.
- [ ] Baseline. Record the trunk receipt time first.
- [ ] Rule. Fail when head's receipt time is more than twice the trunk time.

**Review gate.** None. This PR is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto the parent tip, or onto trunk for I and A, with git patch-id unchanged from the verdict.
- [ ] The owner stops at merge-ready. The operator lands this draft. The agent does not merge.
- [ ] Land Q only in the same maintenance window as G2. Rollback restores the queries. The tables stay until G2.

## 연간 집계 테이블을 삭제한다 (G1)

범위는 `CollectionRepositoryYearAggregate`와 `CollectionContributorYearAggregate`의 DROP이다. 다른 테이블은 지우지 않는다. 백필은 없다. 롤백은 직전 pg_dump 복원뿐이다. 이 두 테이블의 행은 사라진다. 운영자가 테이블 이름을 적은 승인 없이는 브랜치를 만들지 않는다.

**Depends on.** Q.

**Files.**

- [ ] Create a Prisma migration that drops only the two year-aggregate tables.

**Build.**

- [ ] The migration drops those two tables and nothing else. Take a pg_dump of those tables before the migration runs in production.

**You see.**

- [ ] After migrate, both tables are absent and the deletion receipt still succeeds.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run `BACKEND_INTEGRATION_TEST_PATTERN='repository-deletion' pnpm --filter backend test:integration`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.7-xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Trunk still has both tables. Head's migrate drops them. Save `G1-regression.png`. Pass when trunk's count query succeeds and head's regclass query returns null for both.
- [ ] Lane 2. Run `verify-oss-hub doctor` on the head. Save `G1-doctor.png`. Pass when the output contains doctor ok and names database oss_hub_verify.
- [ ] Lane 3. Run `verify-oss-hub drive github-ledger` on the head. Save `G1-ledger.png`. Pass when verify.tsv has equal expected and actual on every row and the four latest sums are greater than zero.
- [ ] Lane 4. Run `verify-oss-hub drive activity-ranking` on the head. Save `G1-ranking.png`. Pass when the first public rows are verify-rank-alpha then verify-rank-beta with totals 18 and 8.
- [ ] Lane 5. Run `verify-oss-hub drive team-activity` on the head. Save `G1-activity.png`. Pass when the chart totals match the seeded contribution counts.
- [ ] Lane 6. Run `verify-oss-hub drive browse-programs` on the head. Save `G1-programs.png`. Pass when the seeded program is listed.
- [ ] Lane 7. Run `verify-oss-hub drive team-management` on the head. Save `G1-teams.png`. Pass when an anonymous session does not receive the staff list.
- [ ] Lane 8. Prod parity. Read-only counts of both tables before the drop, and regclass after a rehearsal restore, not against production itself until the operator approves the production drop. Save `G1-prod.png`. Pass when the rehearsal image shows the pre-drop counts and a null regclass after migrate.
- [ ] Lane 9. Run the app deletion path on the verify database. Save `G1-delete.png`. Pass when deletion exits 0 with the tables already gone.
- [ ] Lane 10. Confirm the migration's SQL contains no other DROP. Save `G1-sql.png`. Pass when the only dropped names are the two aggregate tables.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. AccessExclusive lock time of the two DROP statements on the verify database.
- [ ] Probe. Run the migration at head with `log_lock_waits` on. Trunk has no DROP, so record trunk lock time as absent and measure head's DROP.
- [ ] Baseline. Record trunk as absent before measuring head.
- [ ] Rule. Fail when either DROP's lock time exceeds 1000 ms on the fixture database. That 1000 ms is a budget, not a production measurement.

**Review gate.** None. This PR is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto the parent tip, or onto trunk for I and A, with git patch-id unchanged from the verdict.
- [ ] The owner stops at merge-ready. The operator lands this draft. The agent does not merge.
- [ ] Do not open this draft until the operator's approval names both aggregate tables. Rollback is the pg_dump. The drop deletes those rows.

## 대체된 옛 테이블을 삭제한다 (G2)

범위는 사실 네 테이블, 일별 `Contribution`, `GithubUserActivityHistory`, `GithubUserActivityCycleSnapshot`의 DROP이다. 월별, 외부인, 스위프, 스트림, 커서, `GithubRepository`는 남긴다. 백필은 없다. 롤백은 pg_dump 복원뿐이다. 새 테이블에 없는 행이 있으면 그 행은 사라진다. 승인 전에는 브랜치를 만들지 않는다.

**Depends on.** G1.

**Files.**

- [ ] Create a Prisma migration that drops only the seven replaced tables.
- [ ] Edit schema relations that would otherwise keep those models.

**Build.**

- [ ] Drop the seven tables only after Q's search is clean and a read-only count comparison against `contribution` and `github_user_activity_history` is stored in the PR.
- [ ] Take a pg_dump of the seven tables before the production migration.

**You see.**

- [ ] The seven regclass values are null, and the ranking page still loads.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run `bash apps/backend/prisma/github-ledger-copy.history-change.test.sh` and `pnpm --filter backend test:unit`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.7-xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Trunk still queries the old history table. Head's ranking reads `contributor_standing` with the tables gone. Save `G2-regression.png`. Pass when trunk shows the old table and head's ranking totals stay 18 and 8.
- [ ] Lane 2. Run `verify-oss-hub doctor` on the head. Save `G2-doctor.png`. Pass when the output contains doctor ok and names database oss_hub_verify.
- [ ] Lane 3. Run `verify-oss-hub drive github-ledger` on the head. Save `G2-ledger.png`. Pass when verify.tsv has equal expected and actual on every row and the four latest sums are greater than zero.
- [ ] Lane 4. Run `verify-oss-hub drive activity-ranking` on the head. Save `G2-ranking.png`. Pass when the first public rows are verify-rank-alpha then verify-rank-beta with totals 18 and 8.
- [ ] Lane 5. Run `verify-oss-hub drive team-activity` on the head. Save `G2-activity.png`. Pass when the chart totals match the seeded contribution counts.
- [ ] Lane 6. Run `verify-oss-hub drive browse-programs` on the head. Save `G2-programs.png`. Pass when the seeded program is listed.
- [ ] Lane 7. Run `verify-oss-hub drive team-management` on the head. Save `G2-teams.png`. Pass when an anonymous session does not receive the staff list.
- [ ] Lane 8. Prod parity. Read-only counts of the seven tables and of `contribution` by kind, before any production DROP. Save `G2-prod.png`. Pass when contribution kind counts equal the fact counts in that image. Do not run the DROP in production from this lane.
- [ ] Lane 9. Run `drive activity-ranking` and `drive github-ledger` on head after migrate. Save `G2-after-drop.png`. Pass when ranking totals hold and the ledger drive no longer inserts into the dropped tables.
- [ ] Lane 10. Read the migration and confirm the DROP list. Save `G2-sql.png`. Pass when Monthly, Outsider, SweepHistory, CollectionRepositoryStream, CollectionSyncCursor, and GithubRepository are absent from the DROP list.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Lock time of the seven DROP statements on the verify database, and ranking API time after the drop.
- [ ] Probe. Measure DROP lock time at head. Trunk has no DROP, so record that as absent. Measure ranking API time at both, interleaved.
- [ ] Baseline. Record the trunk ranking median first.
- [ ] Rule. Fail when any DROP lock exceeds 1000 ms on the fixture database, or when head ranking time is more than twice the trunk median. The 1000 ms figure is a budget.

**Review gate.** None. This PR is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto the parent tip, or onto trunk for I and A, with git patch-id unchanged from the verdict.
- [ ] The owner stops at merge-ready. The operator lands this draft. The agent does not merge.
- [ ] Do not open this draft until the operator's approval names the seven tables. Rollback is the pg_dump of those tables.

## GithubRepository 읽기와 쓰기를 repo로 옮긴다 (F)

범위는 수집과 화면이 `GithubRepository` 대신 `repo`와 `team_repo`를 쓰는 변경이다. 발급 테이블의 FK는 `GithubRepository`에 둔다. 그래서 이 PR은 `GithubRepository`를 지우지 않는다. 컬럼 배치는 부록 B의 기본안이다. 운영자가 그 문장을 받아들이거나 바꾸기 전에는 브랜치를 만들지 않는다. 백필은 배포 복사가 이미 채운 행을 기준으로 하고, 없는 운영 컬럼만 채운다.

**Depends on.** E.

**Files.**

- [ ] Edit the product files the owner lists by searching `githubRepository` and `GithubRepository`.
- [ ] Create a migration that adds only the columns the accepted placement names.
- [ ] Edit `apps/backend/prisma/github-ledger-copy.sql` only if the accepted placement changes the copy's column list.

**Build.**

- [ ] Move collection reads and writes, and the ranking or team screens that still need repository identity, onto `repo` and the open `team_repo` period.
- [ ] Leave `RepositoryInvitation.repositoryId` and `RepositoryProvisionJob.repositoryId` on `GithubRepository`. Both relations omit onDelete, so a drop would be restricted.
- [ ] Do not add a current-team column on `repo` unless the operator replaces the Appendix B default.

**You see.**

- [ ] The synthetic ledger repository is readable from `repo`, and an invitation row still points at `GithubRepository`.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run `pnpm --filter backend test:unit` and `bash apps/backend/prisma/github-ledger-copy.transitions.test.sh`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.7-xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Open the public program list, the ranking page, and the team activity chart at trunk and head. Save `F-regression.png`. Pass when the seeded program, the ranking order, and the chart totals match across the two checkouts.
- [ ] Lane 2. Run `verify-oss-hub doctor` on the head. Save `F-doctor.png`. Pass when the output contains doctor ok and names database oss_hub_verify.
- [ ] Lane 3. Run `verify-oss-hub drive github-ledger` on the head. Save `F-ledger.png`. Pass when verify.tsv has equal expected and actual on every row and the four latest sums are greater than zero.
- [ ] Lane 4. Run `verify-oss-hub drive activity-ranking` on the head. Save `F-ranking.png`. Pass when the first public rows are verify-rank-alpha then verify-rank-beta with totals 18 and 8.
- [ ] Lane 5. Run `verify-oss-hub drive team-activity` on the head. Save `F-activity.png`. Pass when the chart totals match the seeded contribution counts.
- [ ] Lane 6. Run `verify-oss-hub drive browse-programs` on the head. Save `F-programs.png`. Pass when the seeded program is listed.
- [ ] Lane 7. Run `verify-oss-hub drive team-management` on the head. Save `F-teams.png`. Pass when an anonymous session does not receive the staff list.
- [ ] Lane 8. Prod parity. Read-only comparison of `GithubRepository` github ids to `repo.github_repo_id`, and of open team links to open `team_repo` rows. Save `F-prod.png`. Pass when both set differences are empty. Do not print names.
- [ ] Lane 9. Create a synthetic invitation. Save `F-invitation.png`. Pass when the invitation insert still uses `GithubRepository` and the collect path uses `repo`.
- [ ] Lane 10. Run the copy after a team archive. Save `F-period.png`. Pass when the copy exits 0 and does not create an overlapping period.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Time of the public program list and the ranking API.
- [ ] Probe. Request both routes at trunk and head, interleaved, three times, and keep the median of each.
- [ ] Baseline. Record both trunk medians first.
- [ ] Rule. Fail when either head median is more than twice its trunk median, or when either exceeds 1000 ms.

**Review gate.** The operator reviews before merge.

- [ ] Copy the program, ranking, and team-activity screenshots into `docs/evidence/github-table-reduction/F-review-programs.png`, `F-review-ranking.png`, and `F-review-activity.png`.
- [ ] Record a 30 to 60 second video of those three screens on a lane VM. Save it as `docs/evidence/github-table-reduction/F-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click. Also wait until the operator has accepted or replaced the column placement.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto the parent tip, or onto trunk for I and A, with git patch-id unchanged from the verdict.
- [ ] The owner stops at merge-ready. The operator lands this draft. The agent does not merge.
- [ ] Do not open this draft until the operator accepts or replaces Appendix B. Rollback is the previous image. GithubRepository stays, so this PR does not drop it.

## 배포 복사 단계를 제거한다 (K)

범위는 Jenkins의 `github-ledger-copy.sql` 실행과, 그 파일이 아직 채우던 `repo` 및 `team_repo` 쓰기다. 앱이 그 쓰기를 맡은 뒤에만 단계를 뺀다. 백필은 없다. 롤백은 Jenkins 단계를 되돌리는 것이다. 이미 복사된 행은 남는다. F가 열리기 전에는 이 PR도 열지 않는다.

**Depends on.** F.

**Files.**

- [ ] Edit `Jenkinsfile` and remove the copy invocation.
- [ ] Delete `apps/backend/prisma/github-ledger-copy.sql` only after no caller remains. Otherwise leave the file and remove the Jenkins call.
- [ ] Edit `apps/backend/prisma/github-ledger-verify.sh` so the deploy no longer depends on a copy that just ran.

**Build.**

- [ ] Remove the `prisma db execute` of the copy from the ordinary deploy stage. Keep migrate deploy.
- [ ] On a rehearsal, run the copy once manually before the removal and record that it would change 0 rows. If it would change a row, stop and fix the missed writer before merging K.

**You see.**

- [ ] A deploy log has no github-ledger-copy invocation, and a collect still adds a contribution row.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run `bash apps/backend/prisma/github-ledger-copy.transitions.test.sh` if the SQL file remains, and `pnpm --filter backend test:unit`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.7-xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Trunk's Jenkinsfile still contains the copy command. Head's file does not. Run a collect at both. Save `K-regression.png`. Pass when head's collect writes `contribution` without running the copy SQL.
- [ ] Lane 2. Run `verify-oss-hub doctor` on the head. Save `K-doctor.png`. Pass when the output contains doctor ok and names database oss_hub_verify.
- [ ] Lane 3. Run `verify-oss-hub drive github-ledger` on the head. Save `K-ledger.png`. Pass when verify.tsv has equal expected and actual on every row and the four latest sums are greater than zero.
- [ ] Lane 4. Run `verify-oss-hub drive activity-ranking` on the head. Save `K-ranking.png`. Pass when the first public rows are verify-rank-alpha then verify-rank-beta with totals 18 and 8.
- [ ] Lane 5. Run `verify-oss-hub drive team-activity` on the head. Save `K-activity.png`. Pass when the chart totals match the seeded contribution counts.
- [ ] Lane 6. Run `verify-oss-hub drive browse-programs` on the head. Save `K-programs.png`. Pass when the seeded program is listed.
- [ ] Lane 7. Run `verify-oss-hub drive team-management` on the head. Save `K-teams.png`. Pass when an anonymous session does not receive the staff list.
- [ ] Lane 8. Prod parity. Before removal, run the copy in a transaction that rolls back and count rows it would insert or update. Save `K-prod.png`. Pass when that rolled-back rehearsal reports 0 inserted rows and 0 updated rows.
- [ ] Lane 9. Run `drive github-ledger` on head. Save `K-ledger.png`. Pass when verify.tsv matches without a separate copy step, or the drive's copy step is skipped and the collector's own writes already match.
- [ ] Lane 10. Restore the Jenkins line on a throwaway branch of the same SHA and show the command returns. Save `K-rollback.png`. Pass when the restored line is the only difference and the copy command is syntactically present.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Wall time of one synthetic collect with no deploy copy, and the rolled-back copy's would-change count.
- [ ] Probe. Time the collect at trunk, including its copy, and at head, without the copy. Interleave. Run the rolled-back copy count once at head.
- [ ] Baseline. Record the trunk collect-plus-copy time first.
- [ ] Rule. Fail when head's collect time exceeds the trunk collect-plus-copy time, or when the rolled-back copy would change any row.

**Review gate.** None. This PR is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto the parent tip, or onto trunk for I and A, with git patch-id unchanged from the verdict.
- [ ] The owner stops at merge-ready. The operator lands this draft. The agent does not merge.
- [ ] Do not open this draft before F is merge-ready and the rolled-back copy changes 0 rows. Rollback puts the Jenkins line back. Tables stay.

## GithubRepository를 삭제한다 (G3)

기본안은 이 PR을 열지 않는 것이다. `RepositoryInvitation`과 `RepositoryProvisionJob`이 `GithubRepository`를 onDelete 없이 가리킨다. `RepositoryIssuanceHistory.repositoryId`는 관계 없이 문자열로 남아 있다. 범위는 그 FK를 옮긴 뒤의 DROP뿐이다. 롤백은 pg_dump 복원뿐이다. 운영자가 발급 테이블의 새 집을 적기 전에는 브랜치를 만들지 않는다.

**Depends on.** K.

**Files.**

- [ ] Create a migration that drops `GithubRepository` only after the invitation and provision foreign keys have a new parent.
- [ ] Edit the invitation and provision models to that parent.

**Build.**

- [ ] Move the two foreign keys in an earlier commit of this same PR, then drop `GithubRepository` in the migration. Do not use CASCADE to hide remaining readers.

**You see.**

- [ ] Invitation create still succeeds, and `GithubRepository` regclass is null.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run `pnpm --filter backend test:unit`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.7-xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Trunk still creates an invitation against `GithubRepository`. Head creates it against the new parent. Save `G3-regression.png`. Pass when both invitations exist and only head lacks the old table.
- [ ] Lane 2. Run `verify-oss-hub doctor` on the head. Save `G3-doctor.png`. Pass when the output contains doctor ok and names database oss_hub_verify.
- [ ] Lane 3. Run `verify-oss-hub drive github-ledger` on the head. Save `G3-ledger.png`. Pass when verify.tsv has equal expected and actual on every row and the four latest sums are greater than zero.
- [ ] Lane 4. Run `verify-oss-hub drive activity-ranking` on the head. Save `G3-ranking.png`. Pass when the first public rows are verify-rank-alpha then verify-rank-beta with totals 18 and 8.
- [ ] Lane 5. Run `verify-oss-hub drive team-activity` on the head. Save `G3-activity.png`. Pass when the chart totals match the seeded contribution counts.
- [ ] Lane 6. Run `verify-oss-hub drive browse-programs` on the head. Save `G3-programs.png`. Pass when the seeded program is listed.
- [ ] Lane 7. Run `verify-oss-hub drive team-management` on the head. Save `G3-teams.png`. Pass when an anonymous session does not receive the staff list.
- [ ] Lane 8. Prod parity. Read-only counts of invitation rows, provision rows, and `GithubRepository` rows before any DROP. Save `G3-prod.png`. Pass when the image shows those three counts. Do not drop in production from this lane.
- [ ] Lane 9. Create an invitation and a provision job on the verify database. Save `G3-issuance.png`. Pass when both inserts succeed after the drop.
- [ ] Lane 10. Search product source for `GithubRepository`. Save `G3-search.png`. Pass when no product query remains.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Lock time of the DROP on the verify database, and time to create one invitation.
- [ ] Probe. Measure the DROP at head only. Trunk has no DROP, so record trunk lock time as absent. Measure invitation create at both, interleaved.
- [ ] Baseline. Record the trunk invitation-create time first.
- [ ] Rule. Fail when the DROP lock exceeds 1000 ms on the fixture database, or when head's invitation create takes more than twice the trunk time. The 1000 ms figure is a budget.

**Review gate.** None. This PR is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto the parent tip, or onto trunk for I and A, with git patch-id unchanged from the verdict.
- [ ] The owner stops at merge-ready. The operator lands this draft. The agent does not merge.
- [ ] Do not open this draft unless the operator names a new parent for the issuance foreign keys and approves the DROP. The Appendix B default is to leave this PR unopened.

## 월별 활동 테이블을 삭제한다 (Gm)

범위는 `GithubUserActivityMonthly`의 DROP이다. 관측 이력은 월 단위 행을 갖고 있지 않다. 백필 없이 지우면 월별 차트의 과거 점이 사라진다. 감사 문서는 2026년 1월부터 10월이 이 테이블에만 있다고 측정했다. 이 계획은 그 구간을 다시 재지 않았다. 롤백은 pg_dump 복원뿐이다. 운영자가 백필 또는 삭제를 적기 전에는 브랜치를 만들지 않는다.

**Depends on.** E.

**Files.**

- [ ] Create a migration that drops only `GithubUserActivityMonthly`, and only after a backfill migration if the operator chose backfill.
- [ ] Edit `findMonthlySnapshots` so it reads the backfill target the operator named.

**Build.**

- [ ] If the operator chooses keep, do not open this PR. If the operator chooses backfill, add the monthly points into the named target in an earlier commit, prove the chart, then drop.

**You see.**

- [ ] The monthly chart either still matches the stored points, or this PR was not opened.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run the ranking unit tests that cover `findMonthlySnapshots`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.7-xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Open the monthly chart at trunk and head. Save `Gm-regression.png`. Pass when trunk shows the seeded points and head shows the same points after the chosen backfill, or this lane records that the PR was not opened.
- [ ] Lane 2. Run `verify-oss-hub doctor` on the head. Save `Gm-doctor.png`. Pass when the output contains doctor ok and names database oss_hub_verify.
- [ ] Lane 3. Run `verify-oss-hub drive github-ledger` on the head. Save `Gm-ledger.png`. Pass when verify.tsv has equal expected and actual on every row and the four latest sums are greater than zero.
- [ ] Lane 4. Run `verify-oss-hub drive activity-ranking` on the head. Save `Gm-ranking.png`. Pass when the first public rows are verify-rank-alpha then verify-rank-beta with totals 18 and 8.
- [ ] Lane 5. Run `verify-oss-hub drive team-activity` on the head. Save `Gm-activity.png`. Pass when the chart totals match the seeded contribution counts.
- [ ] Lane 6. Run `verify-oss-hub drive browse-programs` on the head. Save `Gm-programs.png`. Pass when the seeded program is listed.
- [ ] Lane 7. Run `verify-oss-hub drive team-management` on the head. Save `Gm-teams.png`. Pass when an anonymous session does not receive the staff list.
- [ ] Lane 8. Prod parity. Read-only count of `GithubUserActivityMonthly` grouped by year and month. Save `Gm-prod.png`. Pass when the image shows counts per month and no personal rows. Do not drop in production from this lane.
- [ ] Lane 9. Compare chart totals to the grouped counts on the verify database. Save `Gm-chart.png`. Pass when each seeded month matches.
- [ ] Lane 10. Read the migration DROP list. Save `Gm-sql.png`. Pass when the only dropped table is `GithubUserActivityMonthly`.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Time of the monthly chart API before and after the reader change.
- [ ] Probe. Request the chart at trunk and head, interleaved, three times, and keep the median.
- [ ] Baseline. Record the trunk median first.
- [ ] Rule. Fail when the head median is more than twice the trunk median, or when it exceeds 1000 ms.

**Review gate.** The operator reviews before merge.

- [ ] Copy the monthly chart screenshot into `docs/evidence/github-table-reduction/Gm-review-chart.png`.
- [ ] Record a 30 to 60 second video of the monthly chart on a lane VM. Save it as `docs/evidence/github-table-reduction/Gm-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click, and wait for a written keep or backfill decision.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto the parent tip, or onto trunk for I and A, with git patch-id unchanged from the verdict.
- [ ] The owner stops at merge-ready. The operator lands this draft. The agent does not merge.
- [ ] Do not open this draft until the operator writes keep or backfill. Keep means do not open it. Backfill then drop still needs a DROP approval that names the table.

## 스위프 이력 테이블을 삭제한다 (Gs)

범위는 `CollectionSweepHistory`의 DROP이다. 새 구조에 대응 테이블이 없다. 시스템 상태 화면이 이 테이블을 읽는다. 백필은 없다. 롤백은 pg_dump 복원뿐이다. 운영 로그 행은 사라진다. 운영자가 로그를 버려도 된다고 적기 전에는 브랜치를 만들지 않는다.

**Depends on.** E.

**Files.**

- [ ] Edit `apps/backend/src/admin/system-status.repository.ts` so it stops reading `CollectionSweepHistory`.
- [ ] Create a migration that drops only that table.

**Build.**

- [ ] Replace the sweep panel with the source the operator names. If the operator names no source, do not open this PR.

**You see.**

- [ ] The system status page loads, and the sweep table's regclass is null.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run `pnpm --filter backend exec jest --testPathPattern='system-status.repository.spec.ts' --testPathIgnorePatterns='[]'`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.7-xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Open system status at trunk and head. Trunk shows sweep rows. Head shows the replacement the operator named. Save `Gs-regression.png`. Pass when head loads and does not query the dropped table.
- [ ] Lane 2. Run `verify-oss-hub doctor` on the head. Save `Gs-doctor.png`. Pass when the output contains doctor ok and names database oss_hub_verify.
- [ ] Lane 3. Run `verify-oss-hub drive github-ledger` on the head. Save `Gs-ledger.png`. Pass when verify.tsv has equal expected and actual on every row and the four latest sums are greater than zero.
- [ ] Lane 4. Run `verify-oss-hub drive activity-ranking` on the head. Save `Gs-ranking.png`. Pass when the first public rows are verify-rank-alpha then verify-rank-beta with totals 18 and 8.
- [ ] Lane 5. Run `verify-oss-hub drive team-activity` on the head. Save `Gs-activity.png`. Pass when the chart totals match the seeded contribution counts.
- [ ] Lane 6. Run `verify-oss-hub drive browse-programs` on the head. Save `Gs-programs.png`. Pass when the seeded program is listed.
- [ ] Lane 7. Run `verify-oss-hub drive team-management` on the head. Save `Gs-teams.png`. Pass when an anonymous session does not receive the staff list.
- [ ] Lane 8. Prod parity. Read-only count of `CollectionSweepHistory` before any DROP. Save `Gs-prod.png`. Pass when the image shows the count only. Do not drop in production from this lane.
- [ ] Lane 9. Load system status on the verify database after migrate. Save `Gs-status.png`. Pass when the page returns 200.
- [ ] Lane 10. Read the DROP list. Save `Gs-sql.png`. Pass when the only dropped table is `CollectionSweepHistory`.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Time of the system status API.
- [ ] Probe. Request it at trunk and head, interleaved, three times, and keep the median.
- [ ] Baseline. Record the trunk median first.
- [ ] Rule. Fail when the head median is more than twice the trunk median, or when it exceeds 1000 ms.

**Review gate.** The operator reviews before merge.

- [ ] Copy the system status screenshot into `docs/evidence/github-table-reduction/Gs-review-status.png`.
- [ ] Record a 30 to 60 second video of the system status page on a lane VM. Save it as `docs/evidence/github-table-reduction/Gs-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator to write that the sweep log can be deleted.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto the parent tip, or onto trunk for I and A, with git patch-id unchanged from the verdict.
- [ ] The owner stops at merge-ready. The operator lands this draft. The agent does not merge.
- [ ] Do not open this draft without that written approval. Rollback is the pg_dump. The sweep rows are deleted.

## 외부인 기여 테이블을 삭제한다 (Go)

범위는 `GithubRepositoryOutsiderContribution`의 DROP이다. 새 구조에 대응 행이 없다. 팀 증거 화면이 이 값을 읽을 수 있다. 백필은 없다. 롤백은 pg_dump 복원뿐이다. 외부인 합계는 사라진다. 운영자가 그 합계를 버려도 된다고 적기 전에는 브랜치를 만들지 않는다.

**Depends on.** E.

**Files.**

- [ ] Edit the outsider reader and `saveOutsiderContribution` so product code stops using the table.
- [ ] Create a migration that drops only `GithubRepositoryOutsiderContribution`.

**Build.**

- [ ] Remove the writer and the reader in this PR before the DROP migration. If the operator wants the counts kept, do not open this PR.

**You see.**

- [ ] The team evidence page loads without an outsider query, and the regclass is null.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run `pnpm --filter backend exec jest --testPathPattern='outsider|program-team-repository-evidence' --testPathIgnorePatterns='[]'`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.7-xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Open team evidence at trunk and head. Trunk may show an outsider total. Head loads without that query. Save `Go-regression.png`. Pass when head returns the member totals and does not query the dropped table.
- [ ] Lane 2. Run `verify-oss-hub doctor` on the head. Save `Go-doctor.png`. Pass when the output contains doctor ok and names database oss_hub_verify.
- [ ] Lane 3. Run `verify-oss-hub drive github-ledger` on the head. Save `Go-ledger.png`. Pass when verify.tsv has equal expected and actual on every row and the four latest sums are greater than zero.
- [ ] Lane 4. Run `verify-oss-hub drive activity-ranking` on the head. Save `Go-ranking.png`. Pass when the first public rows are verify-rank-alpha then verify-rank-beta with totals 18 and 8.
- [ ] Lane 5. Run `verify-oss-hub drive team-activity` on the head. Save `Go-activity.png`. Pass when the chart totals match the seeded contribution counts.
- [ ] Lane 6. Run `verify-oss-hub drive browse-programs` on the head. Save `Go-programs.png`. Pass when the seeded program is listed.
- [ ] Lane 7. Run `verify-oss-hub drive team-management` on the head. Save `Go-teams.png`. Pass when an anonymous session does not receive the staff list.
- [ ] Lane 8. Prod parity. Read-only count of `GithubRepositoryOutsiderContribution`. Save `Go-prod.png`. Pass when the image shows the count only. Do not drop in production from this lane.
- [ ] Lane 9. Load team evidence on the verify database. Save `Go-evidence.png`. Pass when member contribution totals match the seeded chart.
- [ ] Lane 10. Read the DROP list. Save `Go-sql.png`. Pass when the only dropped table is `GithubRepositoryOutsiderContribution`.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Time of the team evidence API.
- [ ] Probe. Request it at trunk and head, interleaved, three times, and keep the median.
- [ ] Baseline. Record the trunk median first.
- [ ] Rule. Fail when the head median is more than twice the trunk median, or when it exceeds 1000 ms.

**Review gate.** The operator reviews before merge.

- [ ] Copy the team evidence screenshot into `docs/evidence/github-table-reduction/Go-review-evidence.png`.
- [ ] Record a 30 to 60 second video of team evidence on a lane VM. Save it as `docs/evidence/github-table-reduction/Go-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator to write that the outsider totals can be deleted.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto the parent tip, or onto trunk for I and A, with git patch-id unchanged from the verdict.
- [ ] The owner stops at merge-ready. The operator lands this draft. The agent does not merge.
- [ ] Do not open this draft without that written approval. Rollback is the pg_dump. The outsider rows are deleted.

## Close the program

- [ ] Every box above is checked with its evidence.
- [ ] Reply to the operator with the report the execution playbook names. List each PR with its verdict. Nothing in this program is merged by the agent.

## Appendix A. Prototype evidence

이력 INSERT가 같은 값을 다시 넣는지 확인하려고, `github-ledger-copy.sql` 410행부터 432행까지와 토큰이 같은 문장을 Postgres 16.15에서 실행했다. 이 환경에는 Postgres 17과 Docker가 처음에 없었고, 설치한 서버는 16이다. 그 문장은 버전 전용 문법을 쓰지 않는다. 파일 전체는 다른 테이블이 필요해서 실행하지 않았다. 프로토타입 데이터베이스 이름은 `ledger_history_proto`이고 커밋하지 않았다. 브랜치와 SHA는 없다.

같은 `observed_at`으로 두 번 실행하면 행은 1이고 두 번째 `INSERT`는 0행이다. `observed_at`만 새 값으로 바꾸고 다섯 개 수는 그대로 두면 행은 2가 되고 `INSERT`는 1행이다. 스냅샷 INSERT와 같은 값 비교를 그 뒤에 실행하면 `INSERT`는 0행이고 행은 2로 남는다.

운영 측정 320행과 507행, 최신 합의 차이, 2026-11-04 18:00 KST 이후 사실 행 0건은 다시 재지 않았다. 감사 문서의 측정으로 적혀 있고, I와 A와 V의 운영 조회가 다시 잰다.

프로토타입으로 정할 수 없는 결정은 부록 B에 둔다. 월별 백필, 각 DROP, `CollectionSyncCursor`의 위치, `repo_stream`이라는 이름, 발급 FK의 새 부모, `user_consolidation_backup`의 보관 기간이 그 결정이다.

## Appendix B. Alternatives rejected

감사 문서의 B안은 수집기가 `repo`와 `team_repo`에도 쓰게 한다. 그 안은 채택하지 않는다. `team_repo`의 기간은 배포 복사와 `TeamArchiveRepository.run`만 쓴다. 세 번째 작성자가 기간을 겹치면 다음 배포의 복사가 배제 제약으로 멈춘다. F가 그 쓰기를 맡고 K가 복사 단계를 빼는 편이 작성자가 하나다.

감사 문서의 A안은 검증 SQL을 배포에 연결하되 불일치 실패는 뒤로 미룬다. 그 순서는 유지한다. 검증 SQL은 SELECT만 있고 RAISE가 없다. 실패는 V의 셸 종료 코드가 만든다. 운영 합이 아직 다르면 V는 실패 비트를 켜지 않는다.

`CollectionSyncCursor`를 스트림 행으로 옮기는 안은 채택하지 않는다. 커서는 앱과 스코프 단위이고 스트림은 저장소 단위다. 기본안은 테이블을 그대로 둔다. 운영자가 옮기라고 하면 그 문장 뒤에 별도 PR을 계획에 추가한다.

`CollectionRepositoryStream`을 `repo_stream`으로 이름만 바꾸는 안은 이 프로그램에 넣지 않는다. 읽는 코드가 아직 그 이름이다. C는 `sync_epoch`만 추가한다.

`GithubRepository`에 현재 팀 컬럼을 두는 안은 채택하지 않는다. 현재 팀은 `team_repo`의 열린 기간이다. F의 기본 컬럼은 수집이 이미 읽는 운영 값이다. 브랜치, 보관 여부, 공개 여부, 존재, 다음 실행 시각, 실패 횟수, 마지막 성공 시각, 공개 시각이다. 운영자가 이 목록을 바꾸면 F는 그 목록을 따른다.

월별 표를 관측 이력으로 다시 계산하는 안은 채택하지 않는다. 관측 이력의 시작 시각은 감사 문서가 2026-11-01 23:37 KST로 측정했고, 이 계획은 그 시각을 다시 재지 않았다. 1월부터 10월은 백필 또는 테이블 유지가 아니면 차트에서 사라진다. 기본안은 테이블을 유지하고 Gm을 열지 않는 것이다.

중복 이력 320행을 지우는 안은 채택하지 않는다. D의 읽기는 키마다 최신 `observed_at` 한 행만 쓴다. 삭제는 운영자 승인 뒤의 다른 프로그램이다.

`user_consolidation_backup`을 이 스택에서 지우는 안은 채택하지 않는다. `deploy/jenkins/user-consolidation/`의 스크립트가 그 스키마를 읽는다. 보관 기간을 닫는 결정은 이 프로그램 밖이다.

## Appendix C. Risks

`control-cli`는 이 환경에 없다. 라이브 레인의 드라이버는 `verify-oss-hub`이다. 스킬 커밋 `d4bbbd6885bccefa1cb05d1d28a5a112e98d71f0`의 스크립트는 데이터베이스 이름이 `oss_hub_verify`가 아니거나 호스트가 루프백이 아니면 실패한다. 운영 조회는 그 스크립트로 하지 않는다.

PR 1789는 이 계획을 쓸 때 열려 있다. main에는 스킬 디렉터리가 없다. 헤드에 스킬이 없으면 레인은 그 커밋에서 디렉터리만 가져오고 커밋하지 않는다.

V를 운영 합이 다른 상태에서 켜면 다음 일반 배포가 검증 단계에서 멈춘다. 복사는 `Jenkinsfile`의 일반 배포 단계, `USER_CONSOLIDATION`이 ordinary일 때만 돈다. 통합 배포 경로는 그 단계를 건너뛴다.

E 이후 옛 사실 테이블은 새 행을 받지 않는다. 이미지를 되돌리기 전에 그 공백을 채우지 않으면 옛 테이블은 그 구간이 비다.

G3을 CASCADE로 지우면 스트림과 사실 테이블이 같이 지워질 수 있다. 그 PR은 CASCADE를 쓰지 않는다. 기본안은 G3을 열지 않는 것이다.

I가 끝나기 전에 원인을 코드 결함으로 단정하면 B가 잘못된 쓰기를 고친다. B는 I의 기록에 코드 결함이 없을 때만 시작한다.

## Appendix D. Links and reading list

코드를 고치기 전에 읽는다. `apps/backend/prisma/github-ledger-copy.sql`, `apps/backend/prisma/github-ledger-verify.sql`, `Jenkinsfile`의 복사 호출, `apps/backend/prisma/schema.prisma`의 수집 모델, `apps/backend/src/github/collection-incremental.repository.ts`, `apps/backend/src/github/repository-provision-job.repository.ts`, `apps/backend/src/ranking/ranking.repository.ts`.

B, D, F를 열기 전에 `pstack/skills/how/SKILL.md`를 읽는다. F를 열기 전에 `pstack/skills/interrogate/SKILL.md`를 읽는다. 컬럼 배치가 바뀌면 F의 설계를 그 스킬로 다시 본다.

실행 기록은 이 계획의 체크와 각 PR의 증거 디렉터리에 남긴다. 틱 프롬프트가 말하는 decision trail에 같은 사실을 한 줄로 적는다.

검증 스킬 설명은 커밋 `d4bbbd6885bccefa1cb05d1d28a5a112e98d71f0`의 `.cursor/skills/verify-oss-hub/SKILL.md`와 `features/github-ledger.md`이다.
