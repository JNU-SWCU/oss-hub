# Mail bridge staging procedure

This additive release keeps legacy delivery active by default. It does not install a new sender or enable jobs mode. The database rejects jobs mode until the later worker and cutover gates replace that constraint.

Use an isolated database with synthetic accounts only for the rehearsal. Never copy production addresses, content or row IDs into a fixture.

1. Apply migrations with the normal isolated integration runner.
2. Read existing program receipts and keep their original opaque IDs, counts and acceptance timestamps.
3. Set the singleton `MailControl` row to `PAUSED` in the isolated database. Every legacy program and deadline admission, including cron and normal CLI claims, checks this row at the database boundary. Existing in-flight outcomes may still complete. Pausing is not proof of process death.
4. Call `psql --set=receipt_id=<synthetic-receipt> --file apps/backend/prisma/mail-bridge-import.sql` twice for each explicit synthetic receipt. Both calls must preserve job and recipient identities and counts. The import is a transaction, never an SMTP call. It cannot run in legacy mode.
5. Completed receipts must reconcile with children; malformed payloads and over-capacity batches fail. Incomplete receipts remain quarantined, with original pending/sending states; they are not eligible for delivery. Do not label an interrupted handoff as definitely sent or definitely failed.
6. Verify the bounded history list and scoped status GET show one receipt, including when only its imported completed representation exists. Compare preserved audit rows, timestamps, daily keys and program deletion fingerprints.
7. Leave existing deadline claim rows in `Notification`. Their exact student and staff keys suppress duplicates in every state. They are not imported as invented jobs or staff successes. The future jobs reservation must check both ledgers before activation.
8. In a rehearsal with no new jobs accepted, restore `LEGACY` and complete a previously reserved batch through the legacy repositories without sending mail. Its original receipt must remain visible and the admin totals must count the terminal delivery once, even before re-import. Pause again and re-import: an unfinished snapshot may advance, but a completed import or a terminal receipt quarantined for contradictory audits must not change. Keep both schemas and old histories.

The later release must prove sender exclusion, real process death, rollback compatibility, prepare-only audience parity, and the seven-day observation window. No operational cutover, legacy transport removal, or live mail is authorized by this procedure.
