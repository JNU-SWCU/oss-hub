<!-- init:managed id=craft-init-backend-src sha256=0c2da1cad1cb126b5f14e9a5cdf4b43b9bf5342d6a7e97f02545421d4b9af98e -->
# Nest application source

`apps/backend/src/` owns application composition and feature modules; package commands and runtime prerequisites stay in the parent guide.

## Composition and local boundaries

- Preserve `app.module.ts` import-order comments with scheduler or route consequences.
- Each feature keeps its local controller, service, repository, module, DTOs, errors, and adjacent specs together.
- Existing transaction writers and owner-reviewed public query surfaces are deliberate exceptions to the parent exported-provider rule; do not replace them with private repository reach-through.
- Feature failures use a local `ErrorCode` contract and `DomainException`; preserve existing filenames rather than imposing one enum filename pattern.

## Route registration contract

- Express matches same-method routes in registration order.
- Register literal routes such as `/users/me/profile` before parameter routes such as `/users/:id/profile`; treat reserved literals like `me` as collisions, not IDs.
- When adding a controller, inspect sibling controllers with the same method/prefix and preserve static-before-parameter ordering in the feature module.
- `users/users.module.ts` and `programs/programs.module.ts` contain incident-backed ordering comments; do not remove them as cosmetic text.

## Scope map and tests

- Nearer guides cover `applications/`, `audit-log/`, `github/`, `notifications/`, `programs/`, `roles/`, `submission-reviews/`, and `submissions/`.
- `auth/` owns authentication; `users/` owns account administration; `milestone-documents/` owns milestone-document APIs.
- `runtime-config/` exposes `RUNTIME_CONFIG`; `prisma/` owns injected client lifecycle; `common/` owns cross-feature infrastructure contracts.
- Unit specs are adjacent `*.spec.ts` files.
- `*.integration.spec.ts` must run only through the parent package's isolated integration command.
- A new provider is not live until its module exports/imports and `app.module.ts` composition make the dependency explicit.
<!-- /init:managed id=craft-init-backend-src -->
