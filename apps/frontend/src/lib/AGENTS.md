<!-- init:managed id=craft-init-4.0.0-frontend-lib sha256=6d4fafbdb4b4d98810037048d688d6db7c5117ba4b7cbd6731f22801ed11627c -->
# Shared library scope

## Ownership

- Own framework-independent frontend utilities and the application-wide transport boundary in `apps/frontend/src/lib/`.
- `api-client.ts` owns `/api/v1` path construction, request execution, Problem Detail decoding, file downloads, and safe download filenames.
- `internal-path.ts` owns untrusted internal destinations and `program-route.ts` owns named cross-feature program hrefs.

## Public interfaces

- Import `apiPath`, `apiClient`, `apiFileClient`, `ApiError`, and `ProblemDetail` from `api-client.ts` for all frontend API transport and response failures.
- Preserve `ApiError.problem` as the consumer-facing problem-detail boundary; feature modules map its `code` to domain behavior.
- `utils.ts` exports `cn` for class composition. `display-text.ts`, `format-file-size.ts`, `department-cohort.ts`, `departments.ts`, and `signup-completion-notice.ts` provide focused display and input helpers.
- `use-debounced-value.ts` is the local shared hook; retain its hook contract rather than embedding debounce timers in feature screens.

## State and safety patterns

- Build endpoint paths with `apiPath` and call the typed client; do not introduce a second base URL, direct transport wrapper, or caller-level Problem Detail parser.
- Treat outside-controlled destinations as untrusted: pass navigation values through `isInternalPath` and `toInternalPath` before using them as internal targets.
- Do not import test-support or colocated tests from runtime modules; `eslint.config.mjs` owns that resolved-path boundary.
- Keep helpers deterministic where possible, and put browser persistence or timing behind the existing narrow hook/runtime modules.

## Constraints

- Do not import feature or route modules into `lib/`; this directory remains reusable below those layers.
- Keep tests next to the exported behavior, including malformed paths and unexpected API responses. Browser journeys remain in package-level `e2e/**/*.spec.ts`.
- Add a new module only for a shared, stable contract; retain domain-specific formatting and rules in the owning feature.
<!-- /init:managed id=craft-init-4.0.0-frontend-lib -->
