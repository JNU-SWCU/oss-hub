# Activity ranking

Activity ranking lets a visitor open the public ranking and see the scaffold students in count order.

## Sub-features

- `ranking-open` shows the heading `랭킹` with no session.
- `ranking-order` lists `verify-rank-alpha` first and `verify-rank-beta` second.
- `ranking-counts` shows alpha at total 18 and beta at total 8, matching `GithubUserActivityHistory`.

## How to get to it (user POV)

- Open `/ranking`.
- The page requests `GET /api/v1/ranking`.

## Driving it with verify-oss-hub

Preconditions:

- Doctor reports the instance that this run started.
- Launch has applied the verification scaffold. The two ranking students exist for year 2026.

- **Open ranking.** Run `.cursor/skills/verify-oss-hub/scripts/verify-oss-hub drive activity-ranking`. The heading is `랭킹`. `activity-ranking/ranking.png` shows the table.
- **Check the order.** The first two participant links are `verify-rank-alpha` and `verify-rank-beta`. The alpha row shows Commit 11, PR 2, Issue 1, Repo 1, Star 3, and 합계 18.
- **Check the API.** `GET /api/v1/ranking?page=1&pageSize=20` returns those two logins first, with the same totals. `activity-ranking/ranking-api.json` is that body.
- **Second view.** `activity-ranking/activity-rows.txt` has `verify-rank-alpha` at `11 2 1 1 3` and `verify-rank-beta` at `5 1 0 1 1`.

## Gotchas

- The demo seed alone has no `GithubUserActivityHistory` rows. The empty title `집계된 활동 데이터가 없습니다` means the scaffold did not run. Do not pass the feature on that title.
- The ranking students have no profile. `User_profile_presence_check` rejects a student who has a department and no name, `profileCreatedAt`, `profileUpdatedAt`, and `departmentType`. Leave those columns null together.
- `GET /api/v1/ranking/years` and `GET /api/v1/ranking/timeline?year=<year>` are public too. A timeline chart is not proof of the ranking table.
- Staff see a `CSV 다운로드` button. This drive stays anonymous and does not require that button.
