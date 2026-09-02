<!-- init:managed id=init-apps sha256=81f1f30c25029d6ae9a44c30be7754179a9e33ed62b55b36bc1e12e8c9c52f4c -->
# `apps/` scope

## Local shape

- This directory contains only the two workspace applications: `backend/` and `frontend/`.
- It has no package manifest, source entry point, or package-local command.
- `backend/` is the NestJS API workspace; its local guidance is `backend/AGENTS.md`.
- `frontend/` is the Next.js workspace; its local guidance is `frontend/AGENTS.md`.

## Commands

- `apps/` declares no scripts of its own.
- Execute backend commands from the `backend` workspace and frontend commands from the `frontend` workspace.
- Workspace package membership is declared in `pnpm-workspace.yaml`.

## Boundaries

- Work inside either application belongs in that application's subtree, not in `apps/`.
- Cross-application behavior is assembled outside this container; do not place shared runtime code here.
- Entering `backend/` or `frontend/` activates that directory's nearer `AGENTS.md`.

## Path evidence

- Backend package boundary: `apps/backend/package.json`.
- Frontend package boundary: `apps/frontend/package.json`.
- Backend source root: `apps/backend/src/`.
- Frontend source root: `apps/frontend/src/`.
- Workspace membership is declared at the repository root in `pnpm-workspace.yaml`.

## Directory map

| Path | Local role |
| --- | --- |
| `backend/` | API application workspace |
| `frontend/` | Web application workspace |
<!-- /init:managed id=init-apps -->
