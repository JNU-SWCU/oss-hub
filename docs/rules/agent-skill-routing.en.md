# Agent Skill Routing

[한국어](agent-skill-routing.md) | **English**

English translation of the [Korean source](agent-skill-routing.md).
The Korean document remains authoritative.

This document is authoritative for which skill to use for each kind of oss-hub work.
Skills contain procedures, not this repository's rules; [AGENTS.md](../../AGENTS.en.md) and its linked documents always own the rules.
Choose the task type first.
Open a skill in the table only when performing work on that surface.
Information queries, planning, and reporting alone do not require plugin installation/updates or interviews.

| Task type | Skill to open | Do not do |
| --- | --- | --- |
| Read-only analysis or explanation | None; read only this document and [AGENTS.md](../../AGENTS.en.md) | Update craft, install hooks, query open PRs, or interview |
| Planning or document drafting without implementation | Only the applicable row in the table | Implementation skills, craft updates, execution lanes |
| Code or configuration implementation | The table's principle-frontend/principle-backend/design/principle-testing/db/api/cicd/principle-programming/refactor/debug/research/init | Read every irrelevant skill; hooks/open PRs follow [AGENTS.md Development Commands](../../AGENTS.en.md#development-commands) |
| Inspect a running screen | craft `browser` | Replace Playwright regression or substitute another tool for the user's explicitly named browser tool |
| Execute release QA | `run-release-qa` | Prepare environments before declaring scope; install tools, start services, or run suites in report-only mode |
| Publish QA tickets | `manage-qa-tickets` | Write GitHub Issues without publication approval |
| Submit a PR | `submit-pr-evidence` | Submit without applicable evidence; create an implementation Issue merely because the work has no ticket |
| PR/Issue comments | `write-github-comment` | Other skills' implementation/QA lanes |

## The work-surface table is authoritative

| Work surface | Skill | Location | Repository contracts to follow alongside it |
| --- | --- | --- | --- |
| Write/publish QA tickets | `manage-qa-tickets` | repo `skills/manage-qa-tickets` | The skill owns its procedure |
| Ticket execution and pre-PR evidence | `submit-pr-evidence` | repo `skills/submit-pr-evidence` | [frontend-capture.md](../../skills/submit-pr-evidence/references/frontend-capture.en.md) owns frontend Before/After captures, [backend-diagram.md](../../skills/submit-pr-evidence/references/backend-diagram.en.md) backend logic diagrams, and [readability.md](../../skills/submit-pr-evidence/references/readability.en.md) readability |
| PR/Issue comments, review replies, and UX suggestions | `write-github-comment` | repo `skills/write-github-comment` | The skill owns the four comment templates (finding, reply, UX suggestion, progress); follow [readability.md](../../skills/submit-pr-evidence/references/readability.en.md) |
| Create/update role-specific user handbooks | `build-oss-hub-handbook` | repo `skills/build-oss-hub-handbook` | Its `references/quality-checklist.md` owns handbook quality criteria |
| Release-candidate QA | `run-release-qa` | repo `skills/run-release-qa` | The skill owns release judgments; [qa-scenarios.md](../../skills/run-release-qa/references/qa-scenarios.en.md) owns scenarios. Select report-only/reverification/delta/full scope before preparing environments |
| Frontend implementation | craft `principle-frontend` | External plugin | [frontend.md](frontend.en.md) owns feature-folder boundaries and the single API client |
| Backend implementation | craft `principle-backend` | External plugin | [ADR-003](../decisions/ADR-003-backend-architecture.en.md) and `apps/backend/src/AGENTS.md` own layering boundaries |
| Screen design decisions and tokens | craft `design` | External plugin | [docs/design.md](../design.en.md) owns color, typography, three-tier tokens, component ownership, composition/state/feedback/dialog/test-data contracts |
| Test-suite structure | craft `principle-testing` | External plugin | [ci-path-verification.md](ci-path-verification.en.md) owns verification commands by path |
| Schema/query/migration decisions | craft `db` | External plugin | [data-modeling.md](data-modeling.en.md) owns table additions, naming, and projection; [AGENTS.md Code Conventions](../../AGENTS.en.md#code-conventions--common-patterns) owns migration serialization |
| Public HTTP API contracts | craft `api` | External plugin | [ADR-004](../decisions/ADR-004-REST-API-규격.en.md) owns REST specifications; [ADR-008](../decisions/ADR-008-api-response-field-ownership.en.md) owns response-field ownership |
| CI/deployment pipeline changes | craft `cicd` | External plugin | [ADR-002](../decisions/ADR-002-CI-CD-파이프라인.en.md) owns deployment contracts; [ci-path-verification.md](ci-path-verification.en.md) owns path-specific checks; `deploy/**` and `scripts/check-jenkinsfile*.sh` are ADR-005 deployment-contract paths |
| Operate running screens and collect evidence | craft `browser` | External plugin | The user's explicitly named browser tool takes precedence. Otherwise follow the installed craft `browser` routing; do not freeze its default here. It does not replace the Playwright regression contract. [qa-dom-capture](../../skills/manage-qa-tickets/agents/qa-dom-capture.md) owns element-level ticket capture |
| Shared TypeScript implementation discipline | craft `principle-programming` | External plugin | The frontend/API rows above own those boundaries; `apps/*/eslint.config.mjs` and `apps/backend/eslint-rules/` enforce lint contracts |
| Behavior-preserving cleanup | craft `refactor` | External plugin | [ADR-003](../decisions/ADR-003-backend-architecture.en.md) and `apps/backend/eslint-rules/` enforce layering boundaries |
| Diagnose failures | craft `debug` | External plugin | `scripts/diagnose-collection.sh` owns the read-only collection-stoppage diagnosis procedure |
| Research and technical-choice rationale | craft `research` | External plugin | Do not store research outputs in the repository; record only decisions in [ADRs](../decisions/README.en.md) |
| Update/check stale AGENTS.md maps | craft `init` | External plugin | [AGENTS.md Code Conventions](../../AGENTS.en.md#code-conventions--common-patterns) owns this repository's AGENTS.md hierarchy and authorship |

Load craft-skills through each runtime's native plugin marketplace, without vendoring, copying, or a setup script.
The four names above were verified in craft-skills 0.31.0 installation metadata: `principle-frontend` 4.1.1, `principle-backend` 4.1.0, `principle-testing` 3.2.1, and `principle-programming` 3.2.2.
This corrects the names of four existing work surfaces; it adds neither routing scope nor repository policy.
Check the latest version only in the first code/configuration implementation session of the local calendar day.
Do not refresh the marketplace in later implementation sessions on the same day or in tasks without implementation.
Information queries, planning, and reporting do not refresh the marketplace.
Claude Code applies marketplace `autoUpdate` and plugin enablement in `.claude/settings.json` at startup; Codex applies the `INSTALLED_BY_DEFAULT` project policy in `.agents/plugins/marketplace.json`.
GJC updates its marketplace and project registry with `(gjc plugin marketplace add GoBeromsu/craft-skills || gjc plugin marketplace update craft-skills) && gjc plugin install craft-skills@craft-skills --scope project --force`.
Before implementing, publishing, executing, submitting, or commenting on a surface, find its row above, read its current `SKILL.md`, and apply the procedure.
Skill contracts change by version; if the runtime-loaded skill differs from this table, update this document in the same change.
Installed craft skills absent from this table (`ml`, `gpu`, `vmware`, `tailscale`, `obsidian`, `distil`, `defuddle`, `ast-grep`, `skillify`, `agents`, `write-prd`, `write-report`) have not yet been needed for repository work; they are not prohibited.
When a real need arises, read the skill's `SKILL.md` and add a row.
Prepopulating unused routes embeds unverified instructions in the document.

## Skill naming rules

Repository skill names use `<verb>-<object>` kebab-case.
Use only lowercase letters, digits, and hyphens, with a maximum of 64 characters.
Define a skill name in exactly one location, `skills/<name>/`; the directory name, `SKILL.md` frontmatter `name`, every runtime symlink name, and `agents/openai.yaml` must use the same string.
`metadata.version` follows SemVer; add a line to `CHANGELOG.md` whenever behavior changes.
A rename requires a major version bump and changes to all four naming surfaces in the same commit.
Runtime directories (`.codex/skills`, `.claude/skills`, `.cursor/skills`) contain only symlinks, never actual skill files.

| Skill | Role | Version source |
| --- | --- | --- |
| `run-release-qa` | Release-candidate QA | `metadata.version` in `skills/run-release-qa/SKILL.md` plus `CHANGELOG.md` |
| `manage-qa-tickets` | QA ticket drafting/publication | `metadata.version` in `skills/manage-qa-tickets/SKILL.md` plus `CHANGELOG.md` |
| `submit-pr-evidence` | Mandatory pre-submission evidence gate | `metadata.version` in `skills/submit-pr-evidence/SKILL.md` plus `CHANGELOG.md` |
| `build-oss-hub-handbook` | Role-specific user handbooks | `metadata.version` in `skills/build-oss-hub-handbook/SKILL.md` plus `CHANGELOG.md` |
| `write-github-comment` | PR/Issue finding, reply, suggestion, and progress templates | `metadata.version` in `skills/write-github-comment/SKILL.md` plus `CHANGELOG.md` |

## Load repository skills

Claude Code loads `.claude/skills/<name>` symlinks; the `manage-qa-tickets` QA lanes also have `.claude/agents/qa-*.md` symlinks.
Its PreToolUse hook in `.claude/settings.json` additionally intercepts `gh pr create` and enforces the PR-body contract with `scripts/check-pr-body.sh --hook`.
Other runtimes lack this automatic enforcement and rely on the gate in AGENTS.md.
Codex loads `.codex/skills/<name>` symlinks and `agents/openai.yaml`.
Cursor loads `.cursor/skills/<name>` symlinks.
GJC loads `.gjc/skills/<name>` symlinks as loose project skills; use `gjc skills discover --source project` to confirm that all five appear as candidates.
Do not use a GJC plugin bundle (`plugin.yaml`, `gajae-plugin.json`), which cannot register new top-level skills.
Only `.gjc/skills/` is committed under `.gjc/`; the rest is gitignored.
Check symlinks with `git ls-files -s .codex .claude .cursor .gjc | grep 120000`, and check for dangling links with `find -L .claude .codex .cursor .gjc -type l` (expected: no output).
When adding a skill, add its directory under `skills/` and all four runtime symlinks (`.codex`, `.claude`, `.cursor`, `.gjc`) in the same commit.

## Repository rules take precedence over skills

A skill does not know this repository.
If its instructions conflict with AGENTS.md, `docs/rules/`, or `docs/decisions/`, follow the repository documents and describe the conflict in the PR body.
The five repository skills are always present through symlinks; installation status is not grounds to skip them, and work on an applicable surface is incomplete without using its skill.
If a craft skill is not installed, read the repository rules for that surface directly and proceed, stating in the PR body that the skill was unavailable.

Do not delegate the following four surfaces to skills.

- Commit/branch/PR flow: [AGENTS.md Code Conventions](../../AGENTS.en.md#code-conventions--common-patterns) and [pr-scope.md](pr-scope.en.md) are authoritative. Do not substitute craft `git` conventions.
- Document placement: [docs/AGENTS.md Canonical stores](../AGENTS.md#canonical-stores) is authoritative. Do not overlay the craft `document` ontology.
- Public-safety decisions: the deny-list in [security.md](security.en.md) and `scripts/check-public-safe.sh` are authoritative. Do not substitute craft `security` scope.
- Hook/lint enforcement: `.githooks/` and `commitlint.config.cjs` already enforce this repository's rules, owned by [AGENTS.md Development Commands](../../AGENTS.en.md#development-commands) and [AGENTS.md Code Conventions](../../AGENTS.en.md#code-conventions--common-patterns). Do not add another layer through craft `guardrails`.

## Known contract differences

| Skill requirement | Repository decision | Follow |
| --- | --- | --- |
| craft `design` uses one `DESIGN.md` at the ownership root and keeps its own template headings | [docs/design.md](../design.en.md) owns design contracts, including primitive-component ownership | The repository: update `docs/design.md`, without creating a new `DESIGN.md` |
| craft `init` creates/updates the AGENTS.md hierarchy itself | Authorized authors update AGENTS.md and nested AGENTS.md; [AGENTS.md Code Conventions](../../AGENTS.en.md#code-conventions--common-patterns) owns owner-exclusive paths | The repository: treat init output as a proposal, without transferring authorship rights |
| craft `research` creates `docs/research/<slug>.md` and cited source material for each investigation | `docs/decisions/` ADRs are the canonical store for technical/operational decisions | The repository: commit only decisions and their rationale in ADRs, not research outputs |

## Results of applying craft `init`

`init` 4.0.0 (craft-skills 0.13.0) does not scaffold documents: its description says "Do not scaffold documentation, author document content" and routes document work to `document`.
This repository therefore applies only its AGENTS.md map lifecycle, not document scaffolding.

A fresh inventory with the latest `init` found that the existing root and 25 child documents already covered code entry/configuration boundaries; no new AGENTS placements were added.
The root remains a human-managed canonical guide using the requested `Repository Guidelines` structure.
Under the user's approval for full init coverage, each of the 25 child documents was consolidated into one hash-checked managed region.
Canonical architects investigated core source, tests/QA, configs/build/deploy, and scripts/docs in parallel, followed by independent review and correction passes for frontend/backend/domain/shared-operation clusters.
There is no `CLAUDE.md` adapter; each runtime loads `AGENTS.md` directly.

---

This document extends [docs/AGENTS.md Canonical stores](../AGENTS.md#canonical-stores) to skill surfaces without restating the rules themselves.
