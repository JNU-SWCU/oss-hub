[한국어](ranking-snapshot-backfill.md) | **English**

# Ranking snapshot backfill procedure

The rank-over-time chart on `/ranking` reads nothing but the daily rows in the `GithubUserActivitySnapshot` table.
Right after a new deployment only today's snapshots exist, so the chart starts from a single point.
To fill in the monthly points from January, an administrator runs the backfill once.
It applies once per year, and only to 2026 and later.

This is for someone with backend operations access and an `ADMIN` account.

## 1. Apply the migration first

The `20261031000000_add_github_user_activity_snapshot` migration must be applied before the new backend starts.
Hourly collection writes the `GithubUserActivityHistory` upsert and the snapshot row in one transaction, so a missing table fails the whole person sweep.
The deployment pipeline ([Jenkinsfile](../../Jenkinsfile)) runs `prisma migrate deploy` before the backend container starts, so normally there's nothing extra to do.
For a manual deployment, run the migration first and bring the application up afterwards.

## 2. Wait for the first person sweep after deployment

The backfill doesn't recount stars on GitHub. It reuses the star value from each user's latest `SWEEP` snapshot in that year.
So that past months never get pre-deployment values, a user is backfilled only if they already have at least one `SWEEP` snapshot for that year.

The scheduler runs at the top of every hour (`Asia/Seoul`), and the person sweep logs this when it finishes:

```text
collection.scheduler.completed  scope=person
```

Move on once you've seen that log.
If waiting isn't practical, the admin trigger (`POST /api/v1/admin/collection/trigger`) runs the same person sweep, in which case the log prefix is `collection.admin.completed`.

## 3. Run the backfill

Send the admin session cookie together with an `Origin` header.
Requests without the `Origin` header are rejected.

```bash
curl -i -X POST '<backend-base-url>/api/v1/admin/collection/snapshot-backfill' \
  -H 'Origin: <frontend-origin>' \
  -H 'Content-Type: application/json' \
  -b '<admin-session-cookie>' \
  -d '{"year":2026}'
```

A successful call returns `202` with `{"accepted":true,"year":2026}`.
The work itself continues in the background after the response.

| Code  | Meaning                                                                                 | What to do                                                                       |
| ----- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `202` | Accepted                                                                                | Check the completion log in step 4                                               |
| `400` | `year` isn't an integer, is below 2026, or is past the current Seoul year                | Fix `year` in the body                                                           |
| `401` | No session, or it expired                                                               | Sign in again as an administrator                                                |
| `403` | The session isn't an administrator                                                      | Run it with an `ADMIN` account                                                   |
| `409` | No `SWEEP` snapshot exists for that year yet, or collection is paused for a repository cutover | Go back to step 2 and wait for the person sweep, or retry after the cutover ends |

Calling it twice for the same year at once runs it once, and months that are already filled are never rewritten.
That makes re-running safe.

## 4. Check the result

When the run finishes you get this log:

```text
collection.snapshot_backfill.completed
```

Two of its fields matter most:

- `writtenRowCount`: how many snapshot rows were written. Each user gets January through last month.
- `skippedStaleCount`: how many users were skipped for having no `SWEEP` snapshot in that year. If it's above 0, repeat step 3 after the next hourly sweep. Users already filled cost neither a request nor a write.

Failures come in two shapes.
A broken run logs `collection.snapshot_backfill.failed`, while a single failing user logs `collection.snapshot_backfill.user_failed` and the remaining users keep going.
If the GraphQL budget runs low the result ends with `stoppedForBudget` set to `true`, so running it again the next hour picks up the remaining users.

The run shows up in the audit log at `/dashboard/audit-logs` as **스냅샷 백필 실행**.

## 5. Rolling back

If the values came out wrong, delete only the backfilled rows and run it again.
Leave `source = 'SWEEP'` rows alone: those are real measurements written by hourly collection.

```sql
DELETE FROM "GithubUserActivitySnapshot"
WHERE source = 'BACKFILL' AND year = 2026;
```

After the delete, repeat step 3.

## Notes

Backfilled months are stored with `starEstimated` set to `true` and show up under the chart's estimate footnote.
Only the star count is an estimate; commit, PR, issue, and repository counts are the real cumulative values up to that month.
