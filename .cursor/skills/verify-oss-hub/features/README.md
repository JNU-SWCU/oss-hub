# OSS Hub verification map

This directory is the maintained source for verifying OSS Hub. Read this index, then follow one feature file. The product UI is Korean. Drive it with the strings below.

## Baseline preconditions

- Node.js 24 or newer, pnpm 11, and Docker are already available. `pnpm install` has been run from the repository root.
- Launch with `.cursor/skills/verify-oss-hub/scripts/verify-oss-hub launch`.
- The database name is `oss_hub_verify` on `127.0.0.1`. The demo seed has loaded.
- Doctor prints `doctor ok` for this run's frontend URL, backend URL, and Compose project.
- Do not drive an instance this run did not start.
- Do not point `DATABASE_URL` at a host other than `127.0.0.1` or `localhost`.

The demo seed creates four programs, fourteen students, and one staff user. It does not create GitHub repositories or activity rows. A journey that needs those rows fails on the demo seed. The reason belongs in that feature's Gotchas.

Seeded ids used by the map:

- Program `seed:demo:program:summer-internship`, named `2026 하계 SW 현장실습 연계 프로그램`.
- Team `seed:demo:team:summer-internship-alpha`, named `현장실습 A팀`.
- Student `seed:demo:user:kim-doyoon`.
- Staff `seed:demo:user:staff-lead`.

## Driving conventions

- Start from the baseline unless the feature names another precondition.
- Prefer the accessible name. The program search box is a textbox named `프로그램명 검색`.
- Treat commands as literal.
- Browser proof for the seeded program list is `verify-oss-hub drive browse-programs`.
- Signed-in proof starts with `verify-oss-hub session <user-id>` and the printed `oss_session_dev` cookie.
- The ledger proof is `verify-oss-hub drive github-ledger`. It does not use a GitHub token.
- Cleanup may remove the instance. It must not remove `evidence/`.

## Proof and skip reporting

- Save the action and the resulting state.
- UI proof includes a screenshot and the visible text of `main`.
- API proof includes the URL, the status, and the body.
- Database proof includes the SQL text and the returned row.
- A skipped entry point is not verified by a different entry point. Report the command that failed and the unmet precondition.

## Feature entry contract

Each feature file has an H1, one opening paragraph, and these H2 sections in order.

1. `Sub-features`
2. `How to get to it (user POV)`
3. `Driving it with verify-oss-hub`
4. `Gotchas`

## Features

- [Browse programs](./browse-programs.md) covers the public program list, name search, and program detail.
- [Activity ranking](./activity-ranking.md) covers the public ranking page and its empty state on the demo seed.
- [Team management](./team-management.md) covers the student team directory and the staff team list.
- [Team activity](./team-activity.md) covers the weekly activity chart on a team that has a repository.
- [GitHub ledger](./github-ledger.md) covers a synthetic collector run, the copy SQL, and the verify SQL.
