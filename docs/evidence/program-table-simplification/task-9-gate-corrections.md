# Todo 9 gate corrections

## A: exact history totals and membership regression coverage

The cutover now requires 25 existing TeamHistory rows and 105 rows after the 73 application events and seven team deletion events are added. Preflight and reconcile enforce the same totals. A clean isolated fixture with 24 or 26 histories passed the old SQL incorrectly (two red cases). The corrected migration passes all eight focused cases and rolls the invalid inputs back without partial schema or data changes.

The previously unrun program-team-membership integration suite was executed. Cleanup now deletes membership before Team. Leader departure requires explicit transfer, even for equal join times or different user-ID order. The current Team ID is asserted directly. Transfer and removal failures are injected into the actual TeamHistory write, and the post-notification decision failure asserts TeamHistory rollback. The two membership/application suites passed 53 tests.

The focused suite also exposed a surviving old-model check in staff removal: the unified Team always existed, so every final preapproval member was rejected. It now checks APPROVED state and retained activity, preserves the deletion snapshot before removing rows, and allows the existing preapproval removal behavior. An approved final member remains protected.

## B: real paginated Team response

The document selector calls the canonical team-management view, reads all pages, and projects only teamId/name. ZIP and change-request callers use this explicit option shape. Regression tests use the actual page JSON envelope through the real adapter rather than mocking the adapter with an array. A 101-team, two-page case covers both document dialogs. The three focused files passed 49 tests after red evidence.

## History and secret checks

The owner approved rewording the preservation checkpoint and force-with-lease updates of the owned branches. Backup refs were created first. All three trees and migration SQL hashes were identical after the message-only rewrite. Two generic-api-key findings were the same static E2E idempotency fixture in two commits, not credentials. Both fixture producer and lookup were changed consistently across the rewritten commits; no allowlist was added. Rewritten history passed commitlint and Gitleaks 8.30.1. Detailed tree and hash proof is in task-9-history-rewrite.json.

## Performance

The owner's final ruling is migration first. The existing p50 samples are informational only, not a merge condition. No further latency measurement, analysis, or optimization is being performed.

## CI backend unit correction

Run 42018739020 failed 20 suites and 66 assertions (362 suites and 6067 tests passed). The failures were stale Application delegates and relation shapes, pre-cutover HTTP paths, both architecture route snapshots, deletion-scope fields, and a backfilled Team fixture with a GitHub ownership marker for a different ID. Each failed suite was rerun against the canonical Team contract without skipping tests. Historical migration assertions now check the unchanged historical SQL instead of expecting retired runtime Prisma models.

The actual route inventory remains 130 routes. Fourteen old method/path pairs were replaced; existing route access levels did not change. The merged Team list remains STAFF/403 and now uses APP_018 for both views. The deployment directory has no old application route, template path, or application-decision notification path. No production behavior or migration SQL was changed by these CI test corrections.
