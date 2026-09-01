<!-- init:managed id=init-frontend-src-app sha256=709ea7e9f3010ecef8da24d906fc3871db9e529765a2e7d6dfe8b40fa85dafe6 -->
# `apps/frontend/src/app/` scope

## App Router entry points

- `layout.tsx` is the root layout: it loads `globals.css`, defines Korean document metadata, reads the sidebar cookie, and mounts `AppFrame`.
- `page.tsx` is the public landing-route entry point.
- `globals.css` owns application-wide design tokens and global styles.
- A directory prefixed with `_` is private to routing; `_shell/` is shared route-shell code, not a URL segment.

## Route composition

- Keep `page.tsx` files thin: compose the route's feature component and shell guard rather than implementing feature state here.
- Route-level code uses `features/` for feature ownership, `components/` for shared UI, and `lib/` for shared utilities.
- `dashboard/`, `programs/`, `settings/`, `signup/`, `onboarding/`, `archive/`, `ranking/`, `profile/`, and `my-repos/` are route roots under this directory.
- Dynamic program routes are nested below `programs/[id]/`; dynamic public profiles are below `profile/[userId]/`.

## Shell and session boundaries

- Reuse `_shell/app-frame.tsx` for the shared frame and `_shell/shell-nav.tsx` for its navigation composition.
- `_shell/role-gate.tsx` owns role-based client-side route gating; `_shell/auth-gate.tsx` owns authentication-only gating.
- Use `_shell/role-panel-shell.tsx` for role-gated route composition instead of duplicating gate wiring.
- `_shell/use-session-role.ts` is the route-shell session-state adapter; gated descendants consume the shared snapshot through `_shell/session-role-context.tsx`.
- Do not independently re-read session state below a gate; the shared snapshot keeps access decisions and rendered content consistent.
- `_shell/signup-completion.ts` owns the application-level completion predicate; do not recreate membership/completion checks per route.

## Navigation sources

- Public navigation is defined in `_shell/public-menus.ts`.
- Role-specific menu definitions are in `_shell/role-menus.ts`.
- Contextual sidebar selection and groups are in `_shell/sidebar-menu.ts`.
- Reuse these sources rather than adding duplicate route links to page headers.

## Local constraints

- Shell gates perform client-side redirects; server-side access enforcement is not implemented at this route layer.
- `/logout` remains ungated so a sessionless visitor can see the completion route.
- Public routes include `/`, `/archive`, `/ranking`, and `/profile/[userId]`; do not add role gates to them.
- Session-dependent HTTP access remains behind `src/lib/api-client.ts`, not route-local `fetch` calls.

## Path evidence

- Sidebar cookie parsing: `_shell/sidebar-collapsed.ts`.
- Account slot composition: `_shell/account-slot.tsx`.
- Settings access policy: `settings/settings-access.ts`.
- Dashboard access policy: `dashboard/dashboard-access.ts`.
<!-- /init:managed id=init-frontend-src-app -->
