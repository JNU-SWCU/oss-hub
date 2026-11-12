# Team activity

Team activity shows a weekly chart for each member of a team that has a repository.

## Sub-features

- `activity-open` reaches the chart from the student's team page.
- `activity-metric` switches Commit, PR, and Issue and checks the scaffold sums.
- `activity-api` returns status `COLLECTED` and the same totals from `GET /api/v1/programs/<program-id>/teams/<team-id>/activity`.

## How to get to it (user POV)

- The seeded student opens `/programs/seed%3Ademo%3Aprogram%3Asummer-internship/team`.
- Staff open `/programs/seed%3Ademo%3Aprogram%3Asummer-internship/teams/seed%3Ademo%3Ateam%3Asummer-internship-alpha`.
- The chart region is `[data-slot="team-activity-chart"]`. The metric chips are the group named `지표`.

## Driving it with verify-oss-hub

Preconditions:

- Doctor reports the instance that this run started.
- The verification scaffold has attached `verify:scaffold:repository:internship` to the internship team with `lastSuccessAt` set, and has written the contribution counts.

- **Open the chart.** Run `.cursor/skills/verify-oss-hub/scripts/verify-oss-hub drive team-activity`. The command mints the student cookie and opens the student team path. `[data-slot="team-activity-chart"]` is visible. `team-activity/chart.png` shows that page.
- **Check the sums.** The weekly numbers are in the screen-reader table whose caption contains `주별`. That table sits next to `[data-slot="team-activity-chart"]`. On the Commit chip, the column `@seed-demo-user-kim-doyoon` sums to 4. On PR it sums to 1. On Issue, `@seed-demo-user-lee-seojun` sums to 1.
- **Check the API.** The activity response has status `COLLECTED` and those same totals. `team-activity/activity-api.json` is that body.
- **Second view.** `team-activity/contribution-rows.txt` has `seed-demo-user-kim-doyoon` at `4 1 0` and `seed-demo-user-lee-seojun` at `2 0 1`.

## Gotchas

- The demo profile does not create `GithubRepository` or activity facts. Without the verification scaffold the chart is absent. Do not pass the feature because the team name rendered. `github-ledger.md` writes a different synthetic team, `verify-ledger-team`, not the internship team.
- The chart is mounted only after the repository request resolves to a repository. A skeleton labeled `저장소 불러오는 중` is not the chart. A repository whose `lastSuccessAt` is null stays on `첫 수집을 기다리는 중입니다` even when fact rows exist. Do not pass the chart on that copy.
- This chart reads the daily rollup `Contribution`. The scaffold writes those rows, dated on the program's Seoul start day. The ledger shadow table `contribution` does not feed this chart.
- The activity API is session-protected. The drive requests it on the frontend origin so the `oss_session_dev` cookie is sent. A request to the backend port does not carry that cookie.
- Do not save a repository URL during this drive. That action can call GitHub.
