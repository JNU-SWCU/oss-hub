<!-- init:managed id=craft-init-4.0.0-frontend-lib sha256=a071448fb4c5f5035fd5b487391b0d29ba6ae7b2c205cc47d2168736341488a2 -->
# Shared library scope

## Ownership

- Own framework-independent frontend utilities and the application-wide transport boundary in `apps/frontend/src/lib/`.
- `api-client.ts` owns `/api/v1` path construction, request execution, Problem Detail decoding, file downloads, and safe download filenames.
- `internal-path.ts` owns untrusted internal destinations, `program-route.ts` owns named cross-feature program hrefs, and `local-review-runtime.ts` owns local-review runtime activation checks.

## Public interfaces

- Import `apiPath`, `apiClient`, `apiFileClient`, `ApiError`, and `ProblemDetail` from `api-client.ts` for all frontend API transport and response failures.
- Preserve `ApiError.problem` as the consumer-facing problem-detail boundary; feature modules map its `code` to domain behavior.
- `utils.ts` exports `cn` for class composition. `display-text.ts`, `format-file-size.ts`, `department-cohort.ts`, `departments.ts`, and `signup-completion-notice.ts` provide focused display and input helpers.
- `use-debounced-value.ts` is the local shared hook; retain its hook contract rather than embedding debounce timers in feature screens.

## State and safety patterns

- Build endpoint paths with `apiPath` and call the typed client; do not introduce a second base URL, direct transport wrapper, or caller-level Problem Detail parser.
- Treat outside-controlled destinations as untrusted: pass navigation values through `isInternalPath` and `toInternalPath` before using them as internal targets.
- Keep runtime activation checks in `local-review-runtime.ts`. `local-review-session.ts` only normalizes session bodies; request-persistent fixture state and handler behavior live under `test-support/local-review/`.
- Keep helpers deterministic where possible, and put browser persistence or timing behind the existing narrow hook/runtime modules.

## Constraints

- Do not import feature or route modules into `lib/`; this directory remains reusable below those layers.
- Keep tests next to the exported behavior, including malformed paths, unexpected API responses, and local-review activation edge cases.
- Add a new module only for a shared, stable contract; retain domain-specific formatting and rules in the owning feature.
<!-- /init:managed id=craft-init-4.0.0-frontend-lib -->
