<!-- init:managed id=init-frontend-src sha256=b579773304537a6f8fac8850655970d8fd21d5333dfd8a271094b11b3a7e0189 -->
# `apps/frontend/src/` scope

## Layer map

| Path | Local role |
| --- | --- |
| `app/` | Next.js App Router route composition |
| `features/` | Feature-owned UI, state, hooks, types, and colocated tests |
| `components/` | UI shared by multiple features or routes |
| `lib/` | Shared lower-level utilities and browser API boundary |

## Placement and ownership

- Route files under `app/` compose feature code; keep feature implementation in its owning `features/<name>/` directory.
- Move UI to `components/` only after multiple features or routes share a stable interface.
- Move non-UI code to `lib/` only when no feature owns the behavior.
- Do not reach into another feature's internals; extract an explicit shared contract at the appropriate lower layer.
- `app/AGENTS.md`, `features/AGENTS.md`, `components/AGENTS.md`, and `lib/AGENTS.md` define the nearer rules for their subtrees.

## Entry and test evidence

- App Router root layout: `app/layout.tsx`.
- Shared component exports: `components/index.ts`.
- Browser transport boundary: `lib/api-client.ts`.
- Feature directories include `features/auth/`, `features/programs/`, `features/submissions/`, `features/dashboard/`, `features/roles/`, and `features/ranking/`.
- Keep behavior tests beside the owning source as `*.test.ts` or `*.test.tsx`; browser journeys remain under package-level `e2e/`.
- TypeScript alias and compiler settings are declared in `../tsconfig.json`.
<!-- /init:managed id=init-frontend-src -->
