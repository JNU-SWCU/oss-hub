# Security Rules

[한국어](security.md) | **English**

English translation of the [Korean source](security.md).
The Korean document remains authoritative.

## Core principle: this repository is PUBLIC

oss-hub is a public repository.
Everything is visible worldwide: not only code, but also Issue bodies, PR titles, bodies and comments, commit messages and author/committer identities, CI (Actions) logs, and attached screenshots.

**Treat information as leaked the moment it is uploaded.
Deletion is not retrieval.**
Even if it is removed with a force-push, assume it has already been copied into forks, caches, notification emails, and crawlers.
The only effective defense is therefore before uploading.

## public-safe deny-list

Do not upload any of the following eight categories to any repository surface: code, Issues, PRs, commit messages, CI logs, or screenshots.

| #   | Prohibited content                                                                                         | Use instead                                                                                                     |
| --- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1   | Real names, including team members' names                                                                  | GitHub IDs only (@GoBeromsu, @Lumiere001, @<designer-1>, @<designer-2>)                                         |
| 2   | References to professors, project offices, or external stakeholders                                        | Role-neutral wording ("external dependency", "data provider")                                                   |
| 3   | Student IDs, contact email addresses, or phone numbers                                                     | Do not include them. Communicate outside the repository. The Git commit identity email exception below applies. |
| 4   | Dates, scale, or locations of unannounced events                                                           | Only after an official announcement, and only to the extent announced                                           |
| 5   | Budget, contract, or settlement information                                                                | Do not include it                                                                                               |
| 6   | Real data values or screenshots displaying real data                                                       | Synthetic fixtures; see the import procedure below                                                              |
| 7   | Quotations from Notion document bodies                                                                     | Decision ID indexes only; see the reference rules below                                                         |
| 8   | Notes that collect credentials (`credentials.md`, `secrets.yaml`, `creds.txt`, etc.) and private key files | Keep them only in a secret store. Record variable names, not values, in `.env.example`.                         |

## Public strict-read exception

A public endpoint may read private tables only through an owner-approved, dedicated public query repository boundary.
This exception applies only to read-only paths that produce public responses; it does not grant Prisma access to controllers or ordinary services.
The repository must not accept queries assembled from request input, and must use explicit `select` projections and only permitted public DTO fields.
The service applies the public field allowlist and eligibility rules, and returns the same 404 for private and nonexistent targets.
Arbitrary joins between private tables, wildcard `include`, fetching entire rows for later redaction, and fetching forbidden fields remain prohibited.
Do not use this exception without selector and integration review evidence and an owner receipt for the exact head commit.
Even permitted data must exclude student IDs, departments, contact information, role/account status, answers/rejection, submission content/review/file, provisioning errors, raw GitHub payload/code/diff/message/email/body, credentials, and generation/control metadata.
Do not include real names in public responses.

### Ranking display names

`GET /ranking` is public to everyone.
The fields displayed depend on `viewerClass`.

Public viewers (anonymous users, STUDENT, and non-ACTIVE sessions) see only `githubLogin`, `department`, and public metrics.
Real names and `studentId` are not returned.
The permission granted on 2026-08-03 to expose real names is revoked for public surfaces: without a consent withdrawal endpoint ([#554](https://github.com/JNU-SWCU/oss-hub/issues/554)), public real-name exposure cannot be undone.
GitHub login does not present the same issue because it is an identifier the user has already chosen publicly.
`department` may be public (owner decision, 2026-08-19).

ACTIVE STAFF/ADMIN sessions (`viewerClass` staff) additionally see real names alongside the same public fields.
Staff CSV exports may include real names.
Do not include `studentId` or `githubId` in CSV exports.

Do not include actual real names in Issue or PR screenshots: the staff exception on product screens does not apply to public repository surfaces.

All registered users are included in the display.
Do not make inclusion conditional on having contributions (PM decision, 2026-08-11); users with no contributions are displayed with 0.
The aggregation scope covers all JNU-SWCU Org repositories, regardless of visibility, and activity in public repositories on students' personal accounts.
Because every registered user is included immediately and unconditionally, the risk of irreversible exposure described above, caused by the absence of a consent withdrawal endpoint (#554), applies to every registered user without exception.

The rule that labeled unregistered org contributors as "unregistered" is also removed: contributions from unregistered users are filtered out during ingestion, so no rows exist for them.

The remaining prohibited categories, including student IDs and contact information, remain prohibited in rankings.

### Git commit identity email exception

- A contributor's commit author/committer identity email, chosen through their own Git configuration, is permitted.
- A GitHub noreply address is recommended but not required.
- This exception does not authorize entering or publishing another person's email address on their behalf.
- If an identity was not chosen by its owner, or disclosure of a third party's email is suspected, follow the leak incident procedure below.
- Noreply addresses used to identify automation accounts and synthetic examples using RFC 2606 reserved domains are not treated as contact email addresses.
- Directly recording contact email addresses in tracked files, Issue/PR bodies, comments, commit messages, CI logs, or screenshots remains prohibited.
- `scripts/check-public-safe.sh` blocks file paths whose presence alone constitutes a leak (actual environment values, private keys, local databases, dumps, and credential notes) at the filename stage, and scans emails in the committed Git blob contents of changed tracked files (except `scripts/check-public-safe.sh` itself and `pnpm-lock.yaml`) and PR titles/bodies, allowing the noreply and synthetic examples above.
  It does not automatically scan commit messages for email candidates: it scans only student IDs, phone numbers, personal paths, and real names, while the email policy is enforced through review.
  It does not inspect author/committer identity metadata.
  `--text-only` mode (with `ISSUE_TEXT` supplied) applies the same deny-list to Issue titles/bodies and Issue/PR comments.
  CI logs and screenshots are not automatically scanned by this script; the prohibition policy and review govern them.
- Prohibited `.env` family paths, private keys, and local database extensions are blocked case-insensitively.
  The only permitted exception is the exact lowercase filename `.env.example`.
- Filenames controlled by a PR are not printed verbatim in CI logs; only a Git-hash-based `path-id` is shown.
  The same rule applies to filenames containing newlines, control characters, or Actions annotation strings.
- Quoted local-parts, EAI local-parts, and Unicode domains are not supported as automatic-scan exceptions.
  The automatic scan conservatively blocks quoted or non-ASCII email-shaped tokens with a dot-separated domain whose final label has at least two characters, as well as punycode IDN candidates.
  To avoid false positives for GitHub handles, lists of mentions, and shell variables, tokens without dots are not treated as email candidates and are governed by review.
  Before supporting these forms in actual product input, add a separate input validation contract and synthetic fixtures.

When recording blockers, make **the work, not a person, the subject**.

```text
Bad: Blocked because Professor OOO has not provided the data yet
Good: External dependency: awaiting dataset delivery (owner: @Lumiere001, since 2026-07-16)
```

## Secret management

- Only `.env.example` may be committed.
  Include key names and placeholders only, never actual values.
- Keep actual values only in GitHub repository secrets or the deployment environment's secret store.
  Do not transmit them through messaging apps, Notion, or code comments.
- When writing workflows, check that secrets are not echoed into CI logs.
  Do not create steps that dump environment variables for debugging.
- Implemented (#6): run gitleaks and custom regex checks (student IDs, phone numbers, contact emails, and personal machine paths) on every PR in the GitHub Actions `public-safe` job, enforced as a required check.
  The commit identity email exception above applies.
  Do not keep a real-name list in the repository or inject it into `pull_request` CI, so that PR-controlled scripts do not receive repository secrets.
  Real-name checks use `BLOCKED_NAMES` in trusted manual runs and PR review.
- The service's public DNS hostnames (the canonical browser domain and origin subdomain) may appear in tracked configuration and documentation because they are already exposed through public DNS, certificates, and browsers (accepted deviation, 2026-09-02).
  Public IP addresses, instance IDs, and access credentials remain prohibited.
- When deployment configuration changes (environment keys, Compose/secret paths, or deployment procedures), completion requires both (a) adding/updating only key names in `.env.example` on the code side and (b) updating actual values in the authoritative **operations credentials vault**, as part of the same PR's work.
  If a format example is needed, use only schema notation such as `githubId:login:ROLE[:displayName]`; do not fill examples with actual values.

## Importing external data: five steps for synthetic fixtures

**Never import external real data into the repository or an external LLM, whether in its original form or with simple masking.**
Masking does not prevent reidentification, and giving an agent access to the original is itself an import into an external LLM.

Only synthetic data that has passed the following procedure may enter the repository.

1. **Isolate** — Keep the original in an isolated location outside the agent's working tree.
   It must be a location the coding agent cannot read.
2. **Extract the specification** — Use a non-LLM script to extract only the schema specification (field names, types, lengths, and value distributions).
   Do not include actual values in the specification.
3. **Human review** — A person reviews the extracted specification to ensure no actual values or identifying information are mixed in.
4. **Write a generator** — Give only the reviewed specification to the LLM to write a synthetic data generator, using faker or a similar tool.
5. **Cross-scan** — Use a non-LLM script to cross-scan generated data against original values for matches, and import only passing results as fixtures.

## Notion reference rules

Notion is the canonical store for meetings and planning; the repository contains indexes only.

- Permitted: Decision ID + a **rewritten title** (no more than 60 characters) + the owner's GitHub ID
- Prohibited: quotations from Notion bodies, verbatim copies of original titles, and participants' real names

```text
Good: DEC-012 Seed data pipeline sequence agreed (owner: @GoBeromsu)
Bad: [Meeting notes 7/15] "As Professor OOO said, before the August event..." (body quotation)
```

## Leak incident procedure

1. Report the discovery to @Lumiere001 immediately.
   Do not quietly delete it yourself and move on.
2. If it is a secret, rotate the affected key immediately.
   Rotation comes before deletion.
3. If it is personal information, rewrite history and request cache removal from GitHub Support, then determine whether the affected person must be notified.

## gh tokens

Issue GitHub tokens used by agents and scripts as fine-grained PATs.

- Target repository: restrict access to the single oss-hub repository.
- Permissions: read-only is recommended.
  Issue separate tokens with the minimum necessary scope only for automation that needs write access.
- Do not use classic PATs (access to all repositories).

## Violation detection

During PR review, check for the eight deny-list categories, `/Users/` paths, and Korean real-name patterns.
Do not treat an author/committer identity email chosen by a contributor through their own Git configuration as a violation.
Once gitleaks and custom regex lint are in place, CI failures block violations automatically; a merge that bypasses lint must be handled through the leak incident procedure.
