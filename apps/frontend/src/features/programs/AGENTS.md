<!-- init:managed id=craft-init-4.0.0-frontend-programs sha256=72df5f8898756a8c39c950847e6f7d530819bb219e004f1cec91a722c7088b04 -->
# Programs feature scope

## Ownership

- Own program catalog, detail, application, team, milestone, staff dashboard, authoring, and editing behavior in `apps/frontend/src/features/programs/`.
- App routes import focused feature entries such as `program-list-page.tsx`, `program-detail-page.tsx`, `program-apply-page.tsx`, `program-edit-page.tsx`, and `program-applicants-page.tsx`; keep route decoding in `program-paths.ts`.
- `components/activity-graph-panel.tsx` and `components/milestone-row.tsx` are program-only compositions, not shared-component candidates by default.

## Public interfaces and API

- `types.ts` is the feature contract for program, application, team, milestone, viewer-role, and list state shapes; update its unions and labels with the consuming flow.
- `api.ts` owns broad program, application, and staff-dashboard endpoints. Keep focused remote boundaries in the established `program-*-api.ts`, `milestone-document-*-api.ts`, `student-application-api.ts`, and `team-invitation-api.ts` modules; parse staff-dashboard responses in `staff-dashboard-parser.ts`.
- Use `apiClient` and `ApiError` from `@/lib/api-client`; map endpoint details and problem codes at the feature boundary rather than in shared UI.
- Keep route-id decoding and base program helpers in `program-paths.ts`; named cross-feature program hrefs live in `@/lib/program-route`. Use `program-templates.ts` for categories and template fields instead of recreating them in pages.

## State and flow patterns

- Keep filters, list sorting, validation, lifecycle decisions, deletion decisions, and edit transitions in their matching pure modules: `program-list.ts`, `program-*-flow.ts`, `program-edit-state.ts`, and `program-authoring-*.ts`.
- Form components consume flow results and validation messages; do not duplicate date, team-size, submission, or lifecycle validation inside the rendered form.
- Preserve explicit loading, error, blocked, and ready branches in page modules. Map application and mutation failures from `ApiError.problem.code` in the matching flow or page boundary.
- Keep browser navigation protection split between `use-program-exit-guard.ts` and the injected, testable rules in `program-exit-guard.ts`.
- Backend templates are authoritative when loaded. `program-templates.ts` retains the deliberate local fields/version fallback used after template-list failure; do not expand or silently remove that fallback.

## Constraints

- Keep pure-flow and wire-contract tests beside the modules they protect; page tests cover representative rendering and route integration.
- Preserve staff-only and administrator-only distinctions expressed by the existing API and page modules; do not infer authorization from presentation alone.
- Promote a program component only when it has a stable, non-program consumer; otherwise retain its local domain context here.
<!-- /init:managed id=craft-init-4.0.0-frontend-programs -->
