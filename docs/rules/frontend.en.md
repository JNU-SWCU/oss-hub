# Frontend Implementation Rules

[한국어](frontend.md) | **English**

English translation of the [Korean source](frontend.md).
The Korean document remains authoritative.

## Feature-based folders

Organize frontend code by screen or business capability.
Keep a feature's components, hooks, state, types, and tests close to that feature's folder.
Move only UI and utilities shared by multiple features into shared locations.

```text
apps/frontend/
├── app/                       # Routing and page composition
├── features/
│   └── users/
│       ├── components/
│       ├── hooks/
│       ├── types.ts
│       └── api.ts
├── components/                 # UI shared by multiple features
└── lib/
    └── api-client.ts           # The only HTTP client
```

Pages compose features, and code inside a feature must not directly depend on another feature's internal paths.
When sharing is necessary, explicitly extract a shared contract.

## Business boundaries within a feature

Within `programs/`, `catalog`, `authoring`, `applications`, `teams`, `documents`, and `staff-dashboard` each own their APIs, DTOs, and screen models.
Root `program-contract.ts` owns only genuinely shared concepts, while `program-paths.ts` owns only path construction and route ID parsing.
`roles/onboarding` owns signup selection and the user's own access requests; `roles/access-administration` owns user, access-request, independent-authority, and administrator-profile management.
Do not combine membership type and staff/admin permissions into a single role type.

Use the [declared entry modules](../../apps/frontend/eslint-rules/feature-ownership.mjs) between business areas.
This list is a narrow contract for DTOs, APIs, pure policies, and existing UI compositions that are actually shared, not a path for re-exporting entire modules.
If a new consumer needs access, check the module's responsibility and consumers before updating the entry-point list.
ESLint applies the same internal boundaries to alias, relative, type-only, runtime, and statically analyzable dynamic imports, and distinguishes test-owned compositions from production dependency edges.
The prohibition on internal imports is not a reason to duplicate an endpoint or automatically move domain code into `lib`.

`*-screen.tsx` coordinates queries, mutations, navigation, and remote state.
`*-content.tsx` and `*-view.tsx` render supplied props and may have local presentation state.
Separate DTOs from endpoint implementations, and do not let pure models import types from transport modules.
Connect existing response parsers before returning from the API; moving code is not a reason to strengthen required-field, exact-key, or deep-validation contracts.

## Single API client

Always send HTTP requests through `lib/api-client.ts`.
Define the API baseURL in one place only: `/api/v1` in that file.
A feature's `api.ts` defines only endpoint-specific functions and DTO transformations; do not introduce `fetch`, a separate HTTP instance, or another `/api/v1` string.

```ts
// lib/api-client.ts
const baseURL = '/api/v1';
```

If server rendering, authentication headers, or error conversion become necessary, add the baseURL and transport responsibilities to this client.
Do not create bypass clients for individual features.

## Detecting violations

During review, check uses of `fetch(`, `axios`, `ky`, `'/api/v1'`, and `"/api/v1"` under `apps/frontend`.
Treat any use outside `lib/api-client.ts` as a violation of the single-client rule.
When lint or static checks are introduced, automate this same scope in the checking rules.

## Do not hide affordances based on guesses about runtime state

Do not hide UI affordances based on guesses about runtime state.
Surface failures as ProblemDetail errors when the action is attempted (ADR-007).

## Form action alignment

Right-align form submit/cancel button groups (`justify-end`).
Use `justify-between` only when an action that returns to a previous step must be separated to the opposite side, such as Previous/Next in a multistep form.
Dialog/modal footer action groups also use `justify-end`.
Inline card actions, such as accept/reject or edit/delete actions on individual list rows, are not form submission and are outside this rule's scope.
