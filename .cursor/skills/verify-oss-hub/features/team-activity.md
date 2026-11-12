# Team activity

Team activity shows a weekly chart for each member of a team that has a repository.

## Sub-features

- `activity-open` reaches the chart from the student's team page and from the staff team page.
- `activity-metric` switches the visible metric with the `지표` chip group.
- `activity-api` returns the same team from `GET /api/v1/programs/<program-id>/teams/<team-id>/activity`.
- `activity-nonempty` shows a member in the list named `팀원`. The demo seed does not provide this.

## How to get to it (user POV)

- The seeded student opens `/programs/seed%3Ademo%3Aprogram%3Asummer-internship/team`.
- Staff open `/programs/seed%3Ademo%3Aprogram%3Asummer-internship/teams/seed%3Ademo%3Ateam%3Asummer-internship-alpha`.
- The chart region is `[data-slot="team-activity-chart"]`. The metric chips are the group named `지표`.

## Driving it with verify-oss-hub

Preconditions:

- Doctor reports the instance that this run started.
- The signed-in user is `seed:demo:user:kim-doyoon` for the student page, or `seed:demo:user:staff-lead` for the staff page. Mint the cookie with `verify-oss-hub session`.
- The team `seed:demo:team:summer-internship-alpha` has a repository row. The demo seed does not create one, so `activity-open` and `activity-nonempty` fail on a fresh demo database.

- **Open the student team.** Open the student path with the student cookie. The page shows `현장실습 A팀`.
- **Open the chart.** Wait for `[data-slot="team-activity-chart"]`. On the demo seed this element is absent because the repository panel has no repository. Record that failure. Do not pass the feature because the team name rendered.
- **Switch metric.** Choose a chip in the group named `지표`. The chart region remains on the page. Save a screenshot of each chip you select.
- **Confirm the API.** With the same cookie, `GET /api/v1/programs/seed%3Ademo%3Aprogram%3Asummer-internship/teams/seed%3Ademo%3Ateam%3Asummer-internship-alpha/activity` returns 200 and names the team. Save the body.
- **Non-empty members.** The list named `팀원` contains at least one member. This fails when the activity payload has no members.

## Gotchas

- The demo profile does not create `GithubRepository` or activity facts. `activity-nonempty` stays failed until a repository and activity rows exist. `github-ledger.md` writes a different synthetic team, `verify-ledger-team`, not the internship team.
- The chart is mounted only after the repository request resolves to a repository. A skeleton labeled `저장소 불러오는 중` is not the chart.
- Readers of team activity still use the old GitHub tables. A row in `contribution` alone does not change this chart.
- Do not save a repository URL during this drive. That action can call GitHub.
