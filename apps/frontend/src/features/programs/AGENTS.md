<!-- init:managed id=craft-init-4.0.0-frontend-programs sha256=72df5f8898756a8c39c950847e6f7d530819bb219e004f1cec91a722c7088b04 -->
# Programs feature scope

## Ownership

- Own program catalog, detail, application, team, milestone, staff dashboard, authoring, and editing behavior in `apps/frontend/src/features/programs/`.
- App routes import focused entries in `catalog/`, `applications/`, `authoring/`, `teams/`, `documents/`, and `staff-dashboard/`; keep route decoding in `program-paths.ts`.
- `catalog/components/activity-graph-panel.tsx` and `documents/components/milestone-row.tsx` are program-only compositions, not shared-component candidates by default.

## Public interfaces and API

- Each business module owns its request/response DTOs in `dto.ts` or focused `*-dto.ts` files, its API boundary, and its pure screen models.
- `program-contract.ts` contains only shared program concepts; it must not re-export business DTOs, screens, or APIs.
- `catalog/program-list-options.ts` owns list options; `catalog/program-list-labels.ts` owns their display labels.
- Keep remote boundaries inside their owner. API functions serialize requests and connect response parsers before returning data; callers must not repeat required parsing.
- Cross-module consumers use the focused entries declared by `apps/frontend/eslint-rules/feature-ownership.mjs`; do not add a catch-all barrel or an old-path forwarding module.
- Alias and relative paths follow the same boundary, including type-only imports. Test-owned compositions are separate from production dependencies.
- Use `apiClient` and `ApiError` from `@/lib/api-client`; map endpoint details and problem codes at the feature boundary rather than in shared UI.
- Keep route-id decoding and base program helpers in `program-paths.ts`; named cross-feature program hrefs live in `@/lib/program-route`. Use `applications/program-templates.ts` for categories and template fields instead of recreating them in pages.

## State and flow patterns

- Keep filters, list sorting, validation, lifecycle decisions, deletion decisions, and edit transitions in their matching pure modules: `program-list.ts`, `program-*-flow.ts`, `program-edit-state.ts`, and `program-authoring-*.ts`.
- Form components consume flow results and validation messages; do not duplicate date, team-size, submission, or lifecycle validation inside the rendered form.
- Preserve explicit loading, error, blocked, and ready branches in page modules. Map application and mutation failures from `ApiError.problem.code` in the matching flow or page boundary.
- Keep browser navigation protection split between `use-program-exit-guard.ts` and the injected, testable rules in `program-exit-guard.ts`.
- Backend templates are authoritative when loaded. `applications/program-templates.ts` retains local fields/version fallback only when a successful template response lacks the selected key; request failures keep their explicit failure/404 flow.

## Constraints

- Keep pure-flow and wire-contract tests beside the modules they protect; page tests cover representative rendering and route integration.
- Preserve staff-only and administrator-only distinctions expressed by the existing API and page modules; do not infer authorization from presentation alone.
- Promote a program component only when it has a stable, non-program consumer; otherwise retain its local domain context here.
<!-- /init:managed id=craft-init-4.0.0-frontend-programs -->
