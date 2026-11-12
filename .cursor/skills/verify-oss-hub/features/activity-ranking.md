# Activity ranking

Activity ranking lets a visitor open the public ranking and see either collected GitHub totals or the empty state.

## Sub-features

- `ranking-open` shows the heading `랭킹` with no session.
- `ranking-empty` shows `집계된 활동 데이터가 없습니다` when the demo seed has no activity rows.
- `ranking-populated` shows at least one participant row when activity rows exist. The demo seed does not provide this.

## How to get to it (user POV)

- Open `/ranking`.
- The page requests `GET /api/v1/ranking`.

## Driving it with verify-oss-hub

Preconditions:

- Doctor reports the instance that this run started.
- The demo seed has loaded and no collector run has added activity rows. For `ranking-populated`, that precondition is unmet.

- **Open ranking.** Open `http://127.0.0.1:<frontend-port>/ranking` in the browser. The heading is `랭킹`.
- **Empty state.** On the demo seed, the page shows `집계된 활동 데이터가 없습니다`. Save a screenshot and the text of `main` under `evidence/<run-id>/activity-ranking/`.
- **API empty state.** `GET http://127.0.0.1:<backend-port>/api/v1/ranking?page=1&pageSize=20` returns 200. The items array is empty. Save the body next to the screenshot.
- **Populated ranking.** This step fails on the demo seed. Do not mark it passed because the empty state rendered. It passes only when the page lists a participant and the same login appears in the ranking API body.

## Gotchas

- The demo seed creates no `GithubUserActivityHistory` rows and no contribution facts. `ranking-populated` fails until a collector run has written some.
- `GET /api/v1/ranking/years` and `GET /api/v1/ranking/timeline?year=<year>` are public too. A timeline chart is not proof of the ranking table.
- Staff see a `CSV 다운로드` button. An anonymous doctor session does not. Do not require that button for the public ranking.
