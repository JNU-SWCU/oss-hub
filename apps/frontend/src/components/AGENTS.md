<!-- init:managed id=craft-init-4.0.0-frontend-components sha256=69207d575978001081c286755744b2e81c5f6d6b1778dff6bd63a017eb1f732b -->
# Shared component scope

## Ownership

- Own reusable visual compositions in `apps/frontend/src/components/` and shadcn-derived primitives in `apps/frontend/src/components/ui/`.
- Keep program-specific composition in `apps/frontend/src/features/programs/`; promote it here only after more than one feature or route needs the same stable interface.
- `app-shell.tsx`, `nav-bar.tsx`, and `detail-panel-layout.tsx` define shell and panel contracts; preserve their slot and navigation prop shapes for route consumers.

## Entry points and exports

- `index.ts` is the primary barrel for shared compositions; preserve established consumer-facing deep type imports until they are deliberately promoted.
- Preserve the existing append-only export arrangement in `index.ts`; add the owned export without reordering unrelated exports.
- Import local UI primitives from `@/components/ui/*` and the class merger from `@/lib/utils`; do not copy a primitive into a composition.
- `data-table.tsx` owns opt-in client pagination when `pageSize` is supplied; callers retain sorting, server pagination, and domain data. `pagination-nav.tsx`, `card-grid.tsx`, and `list-panel.tsx` remain reusable collection interfaces.

## State and interface patterns

- Make shared components props-driven: `DataTableColumn`, `NavItem`, and the exported `*Props` types are the interface boundary.
- Keep route loading, API calls, and feature decisions out of this directory; render supplied loading, empty, error, or action content through the component interface.
- Reuse `status-badge.tsx`, `empty-state.tsx`, `status-message-page.tsx`, `form-section.tsx`, and `page-header.tsx` for their named presentation concerns rather than creating parallel variants.
- `program-countdown.tsx` owns countdown presentation and time helpers; callers supply the domain deadline rather than duplicating countdown calculation.

## Constraints

- Follow the token and primitive contract in `docs/design.md`; use existing semantic classes and `ui/` primitives instead of introducing component-local visual foundations.
- Keep accessibility behavior attached to its shared control: keyboard navigation belongs in `nav-bar.tsx`, table semantics in `data-table.tsx`, and dialog behavior in the relevant `ui/` primitive.
- Place behavior tests beside their component (`*.test.tsx`). Card-grid layout journeys live in `e2e/card-grid-geometry.spec.ts`.
<!-- /init:managed id=craft-init-4.0.0-frontend-components -->
