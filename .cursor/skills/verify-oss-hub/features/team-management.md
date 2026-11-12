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
- The demo seed has loaded. The verification scaffold has confirmed `seed:demo:user:staff-lead` is approved staff.
- The browser is on `127.0.0.1`, the same host as `FRONTEND_URL`.

- **Student directory.** Run `.cursor/skills/verify-oss-hub/scripts/verify-oss-hub drive team-management`. The command mints the student cookie and opens `/programs/seed%3Ademo%3Aprogram%3Asummer-internship/teams`. The page contains `현장실습 A팀` and `팀장`. `team-management/student.png` shows that page.
- **Staff list.** The same command mints the staff cookie, opens the same path, and sees the heading `팀 관리`. It fills `현장실습` into the textbox named `팀 검색` and activates `검색`. `현장실습 A팀` stays visible. `team-management/staff-api.json` includes that team id.
- **Anonymous refusal.** The same command opens the path with no cookie. The page shows `로그인이 필요합니다` and does not show the heading `팀 관리`.
- **Second view.** `team-management/team-row.txt` is `seed:demo:team:summer-internship-alpha` and `현장실습 A팀`.

## Gotchas

- `RoleGate` sends an anonymous visitor away from `/teams`. A 200 from `/programs` does not prove the team directory.
- The student page and the staff page share one URL and render different trees. Assert `팀 관리` only for the staff cookie.
- Approving or rejecting a team is a write. This map does not drive that write. A decision changes application state for every later run on the same database.
- The session token is valid only for this instance's `SESSION_SECRET`. Mint it again after the next launch.
- The staff list API is session-protected. The drive requests it on the frontend origin so the `oss_session_dev` cookie is sent. A request to the backend port does not carry that cookie.
