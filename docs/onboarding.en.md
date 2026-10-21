# Onboarding

[한국어](onboarding.md) | **English**

English translation of the [Korean source](onboarding.md).
The Korean document remains authoritative.

This guide is for teammates joining oss-hub and starting their first ticket.
Follow the steps below to get started without additional questions.

## 0. Prepare your agent (once)

Before starting work, install all 30 craft-skills skills in your agent.
You only need to do this once, not for every ticket.

- **Claude Code**: Clone the repository, then open the project from that folder.
  Accept the one-time marketplace trust prompt to enable all 30 craft-skills skills.
- **Codex**: Run these two commands once to install them globally.

  ```
  codex plugin marketplace add GoBeromsu/craft-skills
  codex plugin add craft-skills@craft-skills
  ```

## 1. Find your ticket on the board

Open the [project board](https://github.com/orgs/JNU-SWCU/projects/1).
Find a ticket card assigned to you.
Open the card to read the ticket body, which contains everything needed for that task.

## 2. Paste the starting prompt into your agent

Paste the following line into your agent, such as Claude Code.
Replace `<number>` with the ticket number you found in step 1.

```
Please work on oss-hub ticket #<number>.
```

The repository includes the manage-qa-tickets skill, so the agent follows the ticket contract—what to do, what not to do (the scope boundary), and acceptance criteria—when you paste this prompt.

If you need credentials, such as test accounts, during the task, find them in the team's Notion workspace.

## 3. Branch → commit → PR → In Review

The agent creates a branch, commits the changes, and opens a PR.
Branch naming, commit format, PR bodies, and security rules are defined in [AGENTS.md](../AGENTS.en.md) and [docs/rules/security.md](rules/security.en.md), not in this document.
Refer to those documents if needed.
Once the PR is open, move the corresponding board card to In Review.

## Sign in with role-specific test accounts

Prepare separate GitHub accounts for the roles you need to check in the UI: student, faculty and staff, and administrator.
Store account credentials (email addresses and passwords) only in the team's secret store, never in the repository, `.env`, or documentation.
Look up each account's numeric `githubId` in the `id` field at `https://api.github.com/users/<login>`.
Add those values to `AUTH_INITIAL_ROLES` in the development `.env` file as comma-separated `githubId:ROLE` entries, then sign in to assign the specified role on the first login.
Seeding STAFF also creates an APPROVED application record to preserve the role-application domain invariant.

> Translation note: the Korean onboarding text refers to `.env` above, while the [local development runbook](rules/local-dev.en.md#configuration-source) defines `.envrc` as the only local configuration source.
> Follow that runbook for the local configuration file; this translation preserves the original wording and makes the discrepancy explicit.

For sign-in to work, **the local callback must be registered in the development GitHub OAuth App.**
The callback is derived from `FRONTEND_URL`, so the local address must match the registered value.
Follow [local-dev](rules/local-dev.en.md) for startup instructions and the port contract.
If an account does not have 2FA, GitHub may also require an email device-verification code when signing in from a new device.
You must have access to that account's mailbox to complete the first login.

## How to read a ticket

The section layout may vary slightly between tickets.
Before starting, read the three sections covering what to do, what not to do (the ticket's scope boundary), and acceptance criteria, and keep your work within that scope.
Use the remaining sections to understand the background.
