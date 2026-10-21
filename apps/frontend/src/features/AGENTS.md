<!-- init:managed id=craft-init-4.0.0-frontend-features sha256=e39c67a591d39f9733c2d123f6a4c5b0f1f0027a5076b8ead778a305eb1885fd -->
# Feature scope

## Ownership

- Each direct child of `apps/frontend/src/features/` owns one product capability, its UI composition, state transitions, API adapters, types, fixtures, and adjacent tests.
- `programs/` has its own `AGENTS.md`; apply that nearer contract to program work.

## Entry points and reuse

- Route modules under `apps/frontend/src/app/` consume feature-facing page, screen, API, type, or path modules such as `programs/catalog/program-list-page.tsx` and `dashboard/index.ts`.
- Do not add an `index.ts` by default. When a feature already has one, expose only its intended public surface there; otherwise retain the established explicit module import pattern.
- Share cross-feature presentation through `@/components` and cross-feature non-visual code through `@/lib`, not by importing another feature's internal files.

## State and API patterns

- Put endpoint-specific request and response mapping in the feature's `api.ts` or an established focused `*-api.ts` module; use `@/lib/api-client` for transport.
- Keep wire contracts in owner-local `dto.ts` or focused `*-dto.ts` modules; pure models import those contracts instead of transport implementations.
- `programs/` separates its business modules internally; `roles/onboarding/` owns signup and staff access requests, while `roles/access-administration/` owns administrative access operations.
- Member kind, independent staff/admin authority, signup selection, and display roles remain distinct concepts.
- Extract filters, validation, URL construction, error mapping, and state transitions into named pure modules; keep client hooks as the browser boundary.
- Use explicit loading, ready, empty, blocked, and failure states in feature screens. Preserve the existing state union or flow-module contract instead of adding ad hoc boolean combinations.
- Keep fixtures reusable and separate from runtime data; do not embed test scenarios inside production components.

## Constraints

- Keep a feature's tests adjacent to the behavior they cover (`*.test.ts` or `*.test.tsx`).
- `*-screen.tsx` coordinates queries, mutations, navigation, and remote state. Existing `*-content.tsx` or `*-view.tsx` modules render supplied props and may retain local display state.
- Reuse existing render functions when separating an older direct-loading view; do not introduce a controller/hook/model/view scaffold for every component.
<!-- /init:managed id=craft-init-4.0.0-frontend-features -->
