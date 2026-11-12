# Team management

Team management lets a student see the teams in a program and lets staff search the application list.

## Sub-features

- `team-student-directory` shows `현장실습 A팀` to the seeded student.
- `team-staff-list` shows the staff heading `팀 관리` and finds that team by search.
- `team-anonymous` does not show the team directory to a visitor without a session.

## How to get to it (user POV)

- A student opens `/programs/seed%3Ademo%3Aprogram%3Asummer-internship/teams`.
- Staff open the same path and see `팀 관리`.
- Staff open `/programs/seed%3Ademo%3Aprogram%3Asummer-internship/teams/seed%3Ademo%3Ateam%3Asummer-internship-alpha` for one application.

## Driving it with verify-oss-hub

Preconditions:

- Doctor reports the instance that this run started.
- The demo seed has loaded.
- The browser is on `127.0.0.1`, the same host as `FRONTEND_URL`.

- **Student directory.** Run `.cursor/skills/verify-oss-hub/scripts/verify-oss-hub session seed:demo:user:kim-doyoon`. Set the printed `oss_session_dev` cookie on `127.0.0.1`. Open `/programs/seed%3Ademo%3Aprogram%3Asummer-internship/teams`. The page contains `현장실습 A팀` and `팀장`. Save a screenshot and the text of `main`.
- **Staff list.** Run the session command for `seed:demo:user:staff-lead` and replace the cookie. Open the same `/teams` path. The heading is `팀 관리`. Fill `현장실습` into the textbox named `팀 검색`. The team name `현장실습 A팀` remains visible. Save a screenshot.
- **Anonymous refusal.** With no session cookie, open the same `/teams` path. The team name is not shown as a directory entry. Save the resulting page. Do not treat the public program detail page as this check.
- **Confirm the row.** In the verification database, `SELECT id, name FROM "Team" WHERE id = 'seed:demo:team:summer-internship-alpha'` returns `현장실습 A팀`.

## Gotchas

- `RoleGate` sends an anonymous visitor away from `/teams`. A 200 from `/programs` does not prove the team directory.
- The student page and the staff page share one URL and render different trees. Assert `팀 관리` only for the staff cookie.
- Approving or rejecting a team is a write. This map does not drive that write. A decision changes application state for every later run on the same database.
- The session token is valid only for this instance's `SESSION_SECRET`. Mint it again after the next launch.
