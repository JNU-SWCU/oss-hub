# Frontend Design

[한국어](design.md) | **English**

English translation of the [Korean source](design.md).
The Korean document remains authoritative.

This document is the design contract referenced by the frontend skill gate.
Colors and typography use the tone of sojoong.kr as their basis: navy primary colors, green secondary colors, and dark gray body text.
Tokens follow three tiers—primitive → semantic → component—and their actual definitions live in `apps/frontend/src/app/globals.css`.
Primitive components are generated with the shadcn CLI (`radix-nova` style, based on radix-ui) and owned inside the repository (`apps/frontend/src/components/ui/`).

This document owns the contracts for tokens, primitives, shared compositions, states, feedback, dialogs, and test data.
Screen-level decisions are collected in “Screen decision records” at the end.

## How to read this document

Engineers and agents should first look up the task index and rule IDs; designers should then read the tokens and screen decision records.
There are three principles: record each fact in one place, make states and feedback explicit through kinds, and keep no rule without a detection signal.
Report findings in the form `file:line - finding`.
Cite the 2026-09-03 static audit as the evidence, without linking an external research document.
Reproduce the audit's counts within the repository.
Check local toast state with `grep -rl 'toastMessage' apps/frontend/src/features --include='*.ts*' | grep -v test`, local Skeletons with `grep -rln 'animate-pulse' apps/frontend/src --include='*.tsx' | grep -v test | grep -v components/ui/skeleton.tsx` (only `system-status-view.tsx`, which draws real-time status dots, should remain), direct radix dialog imports with `grep -rlE "from 'radix-ui'" apps/frontend/src/features | xargs grep -lE 'Dialog'`, and className strings longer than 120 characters with `grep -rlE 'className="[^"]{121,}"' apps/frontend/src --include='*.tsx'`.

### Task → section

| Task | Section |
| --- | --- |
| Choose a component | Layers and ownership; Component cards |
| Render state | State system |
| Show feedback | Feedback and notifications |
| Forms and dialogs | Forms; Dialogs |
| Check accessibility | Accessibility |
| Test data | Test data |
| Find the rationale for a screen | Screen decision records |

### R-ID → owner and enforcement

Each rule has one owning document.
All rules are enforced through review, with no automated checks yet.
Automated checks enforce R-08a, R-08b, and R-38 through `apps/frontend/eslint-rules/design-system.mjs` (#1310); the other entries point to follow-up PRs that will resolve current debt.

| Rule | Owner | Follow-up PR to resolve current debt |
| --- | --- | --- |
| R-01, R-02 | `apps/frontend/src/components/AGENTS.md` | None—maintained through review |
| R-04 | This document | Composition API PR |
| R-06 | This document | Follow-up dialog shell design—see the R-06 row in Accepted debt for current status |
| R-08a, R-08b, R-38 | This document | None—enforced by lint. Existing violations are suppressed in `apps/frontend/eslint-suppressions.json` and reduced through follow-up PRs by folder |
| R-09, R-10 | This document | Four-state branch tests for each screen—see the R-10 row in Accepted debt for current status |
| R-17 | This document | None—maintained through review. Check local implementations with the detection expressions at the top (#1347) |
| R-11, R-12 | This document | Alert kind PR |
| R-13, R-14 | This document | Notification PR |
| R-18, R-19, R-22 | This document | None—maintained through review |
| R-20 | This document | Runtime/test boundary lint |
| R-03, R-05, R-07, R-15, R-16, R-21, R-24, R-25 | This document | None—maintained through review |
| R-26 ~ R-33 | This document (Screen decision records → Student team formation, application, and invitation interactions) | None—maintained through review |
| R-34 | This document | None—maintained through review |
| R-35, R-36, R-37 | This document | None—maintained through review |
| R-39 | This document | None—`grep -rn "font-family" apps/frontend/src` must return 0 matches |
| R-40 | This document | None—no lint rule. Counting `variant="default"` misses Buttons with no explicit variant and mistakes mutually exclusive branches separated by ternaries or early returns for a single row, producing many false positives |

## Implementation stack

The following maps dependencies added to `package.json` to this document.

- `tailwindcss` / `@tailwindcss/postcss` / `postcss`—Tailwind v4 CSS-first configuration. Uses `@theme inline`, with no JS configuration file.
- `shadcn`—primitive generation CLI. Ownership transfers to repository code immediately after generation; there is no subsequent runtime dependency on this package itself.
- `radix-ui`—headless library providing accessible primitive behavior (focus traps, ARIA, keyboard navigation).
- `class-variance-authority`—manages class combinations for component variants (colors, sizes, etc.).
- `clsx` + `tailwind-merge`—the `cn()` helper merges classes and resolves conflicts.
- `lucide-react`—icon set.
- `tw-animate-css`—animation utility classes.

## Layers and ownership

Ownership follows `apps/frontend/src/components/ui/*` atoms → `apps/frontend/src/components/*` molecules and organisms → `apps/frontend/src/features/**` domain integration → `apps/frontend/src/app/**` pages.
R-01 and R-02 are index entries here, with their normative text appearing only once in their owning document; this document owns R-05.
**R-01** Criteria for promotion to shared components—the source is the Ownership section of `apps/frontend/src/components/AGENTS.md`.
**R-02** Keep domain-specific components in feature folders—the source is the same section of the same document.
**R-05** Feature code should prefer imports from the `@/components` barrel and import `@/components/ui/*` directly only when no corresponding composition exists.

## Tokens

### Colors

There are three tiers.

1. Primitive—raw color ramps without semantic meaning, such as `--palette-navy-*`, `--palette-green-*`, and `--palette-gray-*`.
2. Semantic—role tokens, such as `--primary`, `--background`, and `--destructive`, plus the domain status color group `--status-*`.
3. Component—Tailwind utility mapping. The `@theme inline` block exposes semantic tokens as `--color-*`, producing classes such as `bg-primary`.

| Role | Semantic token | Referenced palette | Basis |
| --- | --- | --- | --- |
| Primary color | `--primary` | `--palette-navy-600` (`#003399`) | sojoong.kr primary color |
| Secondary color | `--accent` | `--palette-green-600` (`#007a34`) | The sojoong.kr secondary anchor is `green-500` (`#00923f`), but its 4.05:1 contrast against white foreground fails AA, so it was moved one step darker (5.48:1). Non-text use (`--chart-2`) keeps the anchor |
| Body text | `--foreground` | `--palette-gray-700` (`#444444`) | sojoong.kr body text color |
| Danger/error | `--destructive` | Light `--palette-red-600` (`#c02626`) · dark `--palette-red-300` (`#e98686`) | Supporting status ramp. References different steps for different surfaces—see contrast below |
| Inverted surface (hero) | `--hero-*` | Navy ramp (including `--palette-navy-950`) | Dark surfaces such as the CTA at the bottom of the landing page. Does not invert in `.dark`. The first landing screen (the cosmos journey) uses its own `--cosmos-*` |
| Error on an inverted surface (hero) | `--hero-danger` | `--palette-red-100` (`#f3c6c6`) | Approximately 10.9:1 contrast against navy-900 (passes AA). The `[data-surface='inverted']` scope overrides `--destructive` with this token and `--card` with 8% white glass, so `Alert variant="destructive"` is used unchanged within it (the signup stage and consent dialog). Dark surfaces outside that scope (the login error Alert on the landing journey's first panel) use this token directly |

The `--status-*` semantic group (recruiting/closed/pending/approved/rejected) is consumed by `statusBadgeVariants` in `apps/frontend/src/components/status-badge.tsx`.
Both light (`:root`) and dark (`.dark`) variants are defined.

#### Complete status badge contrast check

All 10 combinations (5 states × light/dark) were calculated, and **only pending failed in both modes**.
Since the amber ramp had no darker step, `--palette-amber-800` (`#805814`) was added to resolve it.

| Status | Light | Dark |
| --- | --- | --- |
| Recruiting | navy-700 / navy-50—11.30:1 | navy-100 / navy-800—passes |
| Closed | gray-600 / gray-100—5.76:1 | gray-200 / gray-700—7.17:1 |
| Pending | **amber-800** / amber-50—5.74:1 (previously amber-700, 3.99:1) | amber-50 / **amber-800**—5.74:1 (previously amber-700, 3.99:1) |
| Approved | green-700 / green-50—6.87:1 | green-100 / green-800—8.23:1 |
| Rejected | red-700 / red-50—6.10:1 | red-50 / red-700—6.10:1 |

The pending foreground (`--status-pending-fg`) is used **as standalone text outside badges as well** (`text-status-pending-fg`).
In that case the background is white or a card, so checking only the badge pair misses it: amber-700 also failed on white at 4.39:1, whereas amber-800 reaches 6.32:1.

#### Contrast rules (#282)

Even semantic tokens with the same meaning **will necessarily miss AA on one surface if they reference the same palette step on both light and dark surfaces**.
`--destructive` was one example.

| Surface | Reference | Background | Contrast | Result |
| --- | --- | --- | --- | --- |
| Light (`:root`)—page background | `--palette-red-600` | `#ffffff` | 5.92:1 | Passes AA |
| Light—muted surface | `--palette-red-600` | `#f7f7f7` | 5.53:1 | Passes AA |
| Dark (`.dark`)—page background | `--palette-red-300` | `#1a1a1a` | 6.81:1 | Passes AA |
| Dark—card surface | `--palette-red-300` | `#2b2b2b` | 5.54:1 | Passes AA |
| (Previous) shared by both | `--palette-red-500` | Respective backgrounds | 4.38:1 / 3.98:1 | **Both fail** |

`--destructive` is used directly as a text color (`text-destructive`), and the table above gives the results for that use.
The Button's `destructive` variant **does not use this token as an opaque background with white foreground**: its background is a translucent tint of the same token (`bg-destructive/10`, hover `/20`), and its foreground is the separate `--destructive-on-tint` token (light `red-700` · dark `red-50`).
The tint is alpha-composited with the surface below, so the table above cannot determine its result; `button-contrast.test.ts` reproduces alpha compositing to lock down the contrast of the actual combinations (minimum 4.82:1).

#### Two checking rules

1. Check 4.5:1 **against both light and dark backgrounds separately**. Checking only one and using the same palette step for both causes this defect to recur.
2. **Check the surfaces placed on the page as well as the page background.** The same text appears on `--background`, `--muted`, and `--card`, and the combination with the lowest contrast determines the result. In dark mode, the card (`gray-800`) is lighter than the page background (`gray-900`), making the card less favorable. The intermediate value `#e26a6a` passed on the page background at 5.39:1 but failed on the card at 4.38:1, demonstrating why this rule is needed.

### Typography

Use one self-hosted variable `Pretendard` font (wght 45–920) through `next/font/local`.
The same font handles Latin characters and numbers, with no separate Latin font: the previously used `Geist` lacked Korean glyphs, so Korean text fell back to the operating system's default font.
The font file is 2 MB, so use `preload: false` + `display: 'swap'` to avoid blocking the first screen.
Text first appears in a system Korean font and switches when the download finishes.
Use the six font-size steps (`--step-*`) in `globals.css` through the `text-page`–`text-table` utilities.

**R-39** Declare the body font only through `next/font/local` in `apps/frontend/src/app/layout.tsx`, with the CSS variable name fixed to `--font-sans`.
Do not write font family names directly in code or CSS, and do not put font variables in `:root`: token export (`export-design-tokens.mjs`) reads only `:root` and silently includes font values classified as colors.

| Step | Utility | Size | Line height | Letter spacing | Used for |
| --- | --- | --- | --- | --- | --- |
| page | `text-page` | 40px | 50px (125%) | -2.5% | Page titles (`PageHeader`) |
| section | `text-section` | 24px | 30px (125%) | -2.5% | Section titles (`SectionHeading`) |
| body | `text-body` | 16px | 150% (inherited) | 0 | Body text |
| small | `text-small` | 13px | 150% (inherited) | 0 | Supporting text |
| badge | `text-badge` | 0.75rem (12px) | 16px (133.3%) | 0 | Status badges (`StatusBadge`) |
| table | `text-table` | 0.875rem (14px) | 20px (142.9%) | 0 | Table body (`Table`—inherited by cells), sidebar menus |

The scale covers more than the heading/body hierarchy.
The sizes of recurring parts, such as badges and table cells shared across screens, are also steps; consequently, the names correspond one-to-one with six Figma text styles (`text/page`–`text/table`) (#1344).
Only the badge and table steps use rem.
The `text-xs` and `text-sm` sizes they replaced used rem, letting badge/table text grow when users increased their browser's default font size; using px would make table headers (`text-xs`) larger than cell text only for those users.
Do not add arbitrary sizes (`text-[15px]`, `font-size: 15px` in CSS modules); use step names: `text-page`–`text-table` for Tailwind classes, and `var(--step-*)` for CSS modules and inline styles.
Sizes between steps moved to the smaller step, and sizes that could only move up moved up (#1344, Donggyu's decision): sidebar/drawer menus and landing buttons/step names 15→14px, landing statistic numbers 30→24px, ranking countdown 22→24px, and 11px (audit log action badges, landing step numbers/statistic notes) → 12px.
Program substeps moved 14→13px (`text-small`) to preserve their 1px difference from menu items.
Three arbitrary sizes remain: the landing title that grows with viewport width (`clamp()`), inline code fragments in audit log sentences that must scale with surrounding text (`0.85em`), and activity/insight chart axis text (`fontSize: 12`).
The chart axis has a fixed 44px width; moving it to the rem-based `--step-badge` would clip the first digit of four-digit numbers for users who increased their browser font size.
Static documents outside the app (`public/policies/*.css`) cannot read step tokens and are out of scope.
Tailwind's default sizes (`text-xs`, `text-sm`, `text-lg`, `text-xl`, etc.) are not arbitrary sizes, so they were not migrated in this change and remain on many screens.
`text-xs` and `text-sm` have the same values as `text-badge` and `text-table`.

Code is the source of truth for line height and letter spacing.
The two heading steps have `leading-tight` and `tracking-tight` directly in `PageHeader` and `SectionHeading`; body and supporting text inherit the document's default line height.
Only the badge and table steps have companion line-height tokens (`--text-badge--line-height`, `--text-table--line-height`), using the same values as the `text-xs`/`text-sm` they replaced, expressed as ratios (`calc(16 / 12)`, `calc(20 / 14)`) rather than px.
With px, descendants that change only font size inside a table cell (`text-small`, etc.) would inherit the unchanged 20px and change row height.
Table headers are outside the scale.
`TableHead` directly carries `text-xs` (12px/16px) and `tracking-wide` (2.5%).
The Figma text styles are written by the plugin (`apps/frontend/figma-plugin`) using the values in this table.
If values differ, code is correct.

Choose date formatting according to where it appears.
Sentences and input confirmations use `YYYY년 M월 D일 (요일) HH:mm` (year, month, day, weekday, time).
Date ranges in narrow spaces such as milestone cards use one line, `YY.MM.DD – YY.MM.DD HH:mm` (start date, deadline date and time, Seoul time, with an en dash in the middle): “26.08.05 – 26.08.06 01:58”.

**R-37** A single-line date range in a narrow space must use only `formatSeoulShortRange` from `program-detail-format.ts`; callers must not recreate the format or convert long date formats on other screens to this format.

### Spacing and sizing

Use the default Tailwind v4 spacing scale unchanged.
Do not add new spacing tokens at this stage.

### Shadows and corners

Extend the semantic `--radius` (0.625rem) to `--radius-sm` through `--radius-4xl` at the component tier.
Use Tailwind's default `shadow-sm`/`shadow`/`shadow-md` utilities unchanged, with no separate elevation tokens at this stage.

## Figma synchronization

`apps/frontend/src/app/globals.css` is the single source of truth for tokens.
Figma reads a copy of it.
**R-36** Change token values and names only in `globals.css`, then regenerate `docs/design-tokens/tokens.json` with `pnpm --filter frontend tokens:export`.
Do not edit the generated file manually; the unit test (`src/lib/design-tokens.test.ts`) catches generated files that differ from the source.

| Set | Source | Contents |
| --- | --- | --- |
| `primitive` | `--palette-*` in `:root` | Color ramps, addressed by paths such as `palette.navy.600` |
| `dimension` | `--space-*`, `--measure-*`, and `--step-*` in `:root` | Spacing scale, fixed dimensions, font-size steps (`fontSize.page`, etc.) |
| `light` | Semantic tokens in `:root` | Role tokens with alias values such as `{palette.navy.600}` |
| `dark` | `.dark` | Dark-mode overrides |

Not exported: `@theme inline` (Tailwind utility name mapping—code only), `@media`, and `[data-surface]` inverted-surface scopes.
Calculated values such as `color-mix` and `rgb(var(…))` remain CSS strings, with `description` noting that they require manual configuration: Figma cannot evaluate these expressions.

To read them in Figma, connect GitHub (`docs/design-tokens/tokens.json`, branch main) in the Tokens Studio plugin → Settings → Sync providers, or download the file and use Load from file.
The two themes in `$themes` are Light and Dark.
Font families are not exported: they are declared only in `layout.tsx` (R-39), and Figma uses a locally installed Pretendard directly.

PR gate: in the `- 디자인 규격:` line of the PR body's “정리” section, list the shared components/tokens used by the PR and the specification source (a component card name in this document or a Figma component link).
These fixed Korean markers mean “Design specification” and “Cleanup” and must remain unchanged.
R12 in `scripts/check-pr-body.sh` rejects empty lines, placeholders, and exceptions without reasons (#1309).

## Primitives

The six types from Button through Table were generated with `npx shadcn@latest add` (`radix-nova` style).
Files, including Collapsible, live in `apps/frontend/src/components/ui/`; repository code takes ownership immediately after generation/addition.

### Button

`button.tsx` is the basis for every action trigger (submit, navigate, supporting actions), with cva managing variants (default/outline/secondary/ghost/destructive/link/toggle) and sizes.
`toggle` is a pressed surface that means “selected” within a filter row.
Buttons express this with `aria-pressed`, while address-based filter links use `aria-current="page"`; both receive the same fill.
Use `FilterChip` for chip groups (R-34); features select this variant directly only for address-based filter links (year links in faculty/staff insights).
`variant="bare" size="content"` is exclusively for **clickable surfaces that do not look like buttons**, such as table cells, calendar dates, menu rows, and row/card selectors whose dimensions come from their outer grid or content.
The caller owns the surface (background, text color, hover, pressed indication), spacing, alignment, and wrapping; the primitive provides only an accessible name, disabled behavior, and focus indication.
The 44px rule applies to finger-operated controls, so these surfaces are not subject to it.
Icon-only buttons use `variant="ghost" size="icon"` (a 44px square), with both `aria-label` and a tooltip.
Do not recreate a raw `inline-flex size-11 …` `<button>` in a feature (R-27, AP-17).

### Input

`input.tsx` is the base primitive for text input, with built-in `aria-invalid` state styling that connects directly to the form validation pattern.

### Form Field

`field.tsx` (and its dependencies `label.tsx`, `separator.tsx`) is the primitive corresponding to FormField in the specification.
The current shadcn registry offers the form-library-independent `Field` family as its latest entry instead of the legacy `form.tsx` tied to react-hook-form.
`FieldLabel`/`FieldDescription`/`FieldError` structure labels, descriptions, and errors; since this project does not yet mandate a particular form library, `Field` fulfills the FormField requirements as-is.

### Card

`card.tsx` is the surface primitive for grouping content.
It serves as a cell in the CardGrid pattern below.

### Alert

`alert.tsx` is the surface primitive for error/information messages.
It underlies the loading, empty, and error state patterns below.

### Table

`table.tsx` is the table primitive.
Features use `DataTable` rather than assembling this primitive directly (R-07).
The column representing a row becomes `<th scope="row">` through `DataTableColumn.rowHeader`.
The document collection matrix is the only directly assembled exception recorded in Accepted debt; chart tables intended only for screen readers (`sr-only`) remain semantic `<table>` elements using neither the primitive nor DataTable.

### Collapsible

`collapsible.tsx` exposes radix-ui's Root/Trigger/Content accessibility behavior through repository-owned `Collapsible`/`CollapsibleTrigger`/`CollapsibleContent` components.
The wrapper itself imposes no visual styles; consumers combine only existing semantic tokens and the Tailwind component utilities exposing them.
Open-state styling uses each `data-slot` and Radix's `data-state`.

**R-24** `apps/frontend/src/components/ui/*` contains shadcn-generated code owned by the repository.
Applying semantic tokens, adding `data-slot`, and improving accessibility are allowed; DOM changes that alter public slots/roles and the insertion of domain branches are prohibited.
**R-25** Create new visual variations by adding `cva` variants to the owning primitive, name variants by meaning (kind/size), and do not create variations through consumer `className` overrides.
**R-34** Pressed buttons that filter a list or select one item within a group (status filters, review-decision selections, step navigation) must use `FilterChipGroup`/`FilterChip`.
Do not put raw `<button>` elements with `aria-pressed` in feature code; the Button's `toggle` variant is the single pressed appearance.
An action button that immediately opens a confirmation dialog is not a chip and follows R-31.
“Review-decision selection” above means selecting an option and saving separately; if clicking immediately starts a write, the chip's “pressed” state becomes ambiguous between the current server value and the just-selected value.

**R-40** A screen has at most one primary action.
Supporting actions in the same action row use `outline`; weaker supporting actions and icon buttons use `ghost`.
**Do not paint pressed/selected states in the primary-action color** (R-34): if an already-selected item is strongest on the screen, the action that needs clicking is obscured.
Use destructive actions (`destructive`) only as the confirm button in a confirmation dialog or alone in a “danger zone”; do not place them beside the primary action in an ordinary action row.
Dialog footers place cancel first and confirm second.

## Composition contract

**R-03** Express visual/state differences through `cva` variants in the owning component.
Create a new component only when DOM semantics or required slots differ, and convert visual-branch boolean props to variants when a component has more than three.
**R-04** Every shared composition exports named `*Props`, accepts `className`, and has a stable root `data-slot`.
**R-06** Feature code uses the shared dialog shell rather than directly importing Dialog/AlertDialog from `radix-ui`.
**R-07** Feature page shells use `PageBody`, top-level section headings use `SectionHeading`, and tables use `DataTable`.
If a required slot is missing, extend the component rather than bypassing it.
**R-08a—length**: single-line `className` strings over 120 characters are prohibited in JSX/TSX class literals under `apps/frontend/src/{components,features,app}/**`.
**R-08b—color**: all TS/TSX under `apps/frontend/src/{components,features,app}/**`, including color constant arrays, data objects, and inline `style` values, must use semantic tokens instead of hex color literals or direct `--palette-*` references.
The only exceptions are the token owner `apps/frontend/src/app/globals.css`, the isolated document `apps/frontend/public/policies/policy-document.css`, and the canvas-only theme constants `apps/frontend/src/features/landing/cosmos/cosmos-theme.ts`.
General CSS files and component CSS are outside this rule's scope.
**R-38** `apps/frontend/src/{components,features,app}/**` uses the `Button` primitive rather than raw `<button>` elements (for icons only, `variant="ghost" size="icon"` with `aria-label` and a tooltip).
The only exception is the primitive owner, `apps/frontend/src/components/ui/**`.
`pnpm --filter frontend lint` enforces R-08a, R-08b, and R-38.
Existing violations are suppressed by file/rule in `apps/frontend/eslint-suppressions.json`; after fixing a suppressed violation, reduce the list with `pnpm --filter frontend lint:prune`—the list may only shrink.

### Layout skeleton vocabulary

The following names describe layout skeletons (structure); their corresponding components already exist in `apps/frontend/src/components/`.
If a new skeleton is needed, extend an existing composition rather than building a bypass implementation.

- **AppShell** → viewport-shell. The overall skeleton with fixed header/navigation and a body filling the viewport.
- **CardGrid** → grid-repetition (card-grid). A list skeleton with repeated identical cards in a grid.
- **DetailPanelLayout** → split-sidebar. A two-pane skeleton with list on the left/details on the right (or the reverse).
- **StatusMessagePage** → viewport-shell/cover. A single-message skeleton covering the whole viewport, for login errors, empty states, etc.

## State system

Failure surfaces use `FailureState` from `components/failure-state.tsx`.
Loading surfaces use `Skeleton` from `components/ui/skeleton.tsx` and shared layout components; do not add new local definitions.
**R-09** Collection views render four mutually exclusive states—loading, empty, error, and ready—and lock all four branches down with tests.
**R-10** Retryable fetch failures use only the shared failure surface and expose a retry action; `EmptyState` and bare destructive text are prohibited in error states.
**R-17** Loading surfaces use the shared Skeleton with `aria-busy`, an accessible label, and `motion-reduce` handling; do not define new feature-local Skeletons.
Functions that compose the shared `Skeleton` into a screen layout (`DashboardSkeleton`, etc.) are not local definitions: the prohibited implementation draws `animate-pulse` directly.

Do not stop at describing the state.
Provide at least one suitable next action—such as `다시 시도` (Retry), `목록으로 이동` (Go to list), `일정으로 이동` (Go to schedule), or `제출 항목 추가` (Add a submission item)—so visitors can continue their intended task.
When access is denied, state the required permission and an alternative screen they can visit.

## Status vocabulary (glossary)

Use the same wording and badge color for the same status on every screen.
**R-35** Define status labels and StatusBadge variants only in `apps/frontend/src/lib/status-vocabulary/`, and import them from features.
Do not add `Record<…Status, string>` label constants or variant ternary branches inside features; if a second name seems necessary for the same status, update this table.
**R-41** Write status labels as **status nouns**.
Do not mix forms among options in one control or among neighboring controls: use the same kind of words, such as `허용 · 비허용` (Granted · Not granted) and `활성 · 비활성` (Active · Inactive).
Predicative forms such as `-됨`/`-함` describe events rather than states, so do not use them as names of selectable values; buttons handle actions (verbs).
History lists showing past events as events are outside this rule.

| Domain | Value | Label | Badge | Meaning |
| --- | --- | --- | --- | --- |
| Submission (document) | NOT_SUBMITTED | 미제출 (Not submitted) | closed | Nothing has been submitted yet |
| Submission (document) | SUBMITTED | 검토 대기 (Awaiting review) | recruiting | Submitted; it is faculty/staff's turn to review |
| Submission (document) | APPROVED | 승인 (Approved) | approved | Review complete; passed |
| Submission (document) | CHANGES_REQUESTED | 보완 요청 (Changes requested) | pending | Must revise and resubmit (a student task) |
| Submission (document) | REJECTED | 반려 (Rejected) | rejected | Review complete; resubmission unavailable. The review **button** is named “최종 반려” (Final rejection) to convey that it prevents resubmission |
| Role | STUDENT · STAFF · ADMIN · null | 학생 · 교직원 · 관리자 · 미지정 (Student · Faculty and staff · Administrator · Unassigned) | closed · pending · approved · closed | Unassigned means no value, not failure |
| Membership type | STUDENT · STAFF · null | 학생 · 교직원 · 미지정 (Student · Faculty and staff · Unassigned) | None | The classification selection in administrator member details. Do not infer type from access flags or the displayed role |
| Account status | ACTIVE · DEACTIVATED | 활성 · 비활성 (Active · Inactive) | approved · closed | |
| Access | GRANTED · NONE | 허용 · 비허용 (Granted · Not granted) | None | Whether the account currently has faculty/staff or administrator access. “비허용” is neutral wording that fits both accounts never granted access and accounts whose access was revoked. Do not add a badge—the account-status badge in the header already conveys the same fact (#1365) |
| Application | SUBMITTED · APPROVED · REJECTED | 검토 대기 · 승인 · 반려 (Awaiting review · Approved · Rejected) | pending · approved · rejected | The source is still `features/programs/application-presentation.ts` (decision #869). To be migrated later |

Administrator member details select membership type instead of the presence/absence of faculty/staff access.
Changing to faculty/staff grants faculty/staff access; changing to student revokes it, without changing administrator access or account status.
Save membership type and access permissions together in one transaction after confirmation.
Open the confirmation popup immediately when the dropdown changes; do not provide a separate apply-membership-type button.
Automatically reuse the saved student ID and department, asking for input in the popup only when values required for a switch to student are missing.
A type change does not delete an existing student ID; the faculty/staff ID is managed as a separate optional field.
Routine changes to the faculty/staff ID belong in the user's own settings profile; do not add a separate edit-profile button in the administrator access-change area.
Switching to student requires an actual student ID and department; block type changes for accounts with incomplete profiles or pending requests and show the reason.

Decision of 2026-09-19 (#1295): use the vocabulary from the faculty/staff document review screen throughout student screens.
Previously, “제출 전·제출됨·보완 필요·최종 반려” (Before submission · Submitted · Changes needed · Final rejection) in program details/checklists and “검토 중·승인 완료·수정 요청” (Under review · Approval complete · Revision requested) on the dashboard named the same states differently; student screens also colored changes-requested badges red.
Author roles in board comments (where ADMIN is folded into faculty/staff) and review decision buttons (`features/reviews`) are outside this table's scope.

## Feedback and notifications

| Type | Trigger/scope | Allowed kinds | Owning primitive | Placement | role / aria-live | Focus behavior | Dismissal/persistence | Required action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| field | Field-level validation failure | error | FieldError | Immediately below the control | `role="alert"` | Move focus to the first error | Persists until corrected | None—the focus moved to the first invalid field is the next action. No summary at the top of the form (R-16) |
| inline | Result in the working area | success·info·warning·error | Alert | Within that area | Dynamic error=`role="alert"`; other dynamic updates=`role="status"`+`aria-live="polite"`; static initial render=no live region | No focus movement | Until leaving the screen | For errors, a next-action link (R-15) |
| page | Failure/permission blocking the whole screen | error·warning | `FailureState` | Top of the body | Only dynamic errors arising during interaction use `role="alert"`; initial/static warnings, access notices, and information have no live region; dynamic non-errors=`role="status"`/`aria-live="polite"` | Focus the first action | Persistent | Retry or an alternative route |
| toast | One-time result spanning screens | success·info | Global notification primitive (not implemented → R-13 row in Accepted debt) | Fixed in the viewport | `role="status"`+`aria-live="polite"` | No focus movement | Auto-dismissal allowed; critical messages prohibited (R-14) | None |
| dialog | Request for an irreversible decision | warning·error | `DialogShell` (role=dialog window); for the alertdialog variant for irreversible decisions, see the R-06 row in Accepted debt | Modal | `role="alertdialog"` | Focus trap + return | Until the user decides | Confirm/cancel pair |

| Kind | role | aria-live | Auto-dismissal | Owning component |
| --- | --- | --- | --- | --- |
| dynamic error | `role="alert"` | assertive | Prohibited | FieldError or failure surface |
| dynamic non-error | `role="status"` | polite | Allowed only for toasts | Alert or notification primitive |
| static initial content | None | None | Not applicable | Heading + body |

**R-11** Feedback explicitly specifies one kind: `success`, `info`, `warning`, or `error`.
**R-12** Use `role="alert"` only for dynamic errors arising during interaction; dynamic non-error updates use `role="status"` or `aria-live="polite"`, and static headings/initially rendered content have no live region.
**R-13** Send one-time messages spanning screens through a single global notification primitive.
Local `toastMessage` banners are prohibited.
Not implemented yet—see the R-13 row in Accepted debt.
**R-14** Critical messages do not disappear on a timer.
**R-15** Error messages include the next action.
Use field feedback for field validation failures.
Use inline or page feedback for results in the working area.
Use toast for noncritical one-time results spanning screens.
Use dialog for blocking decisions.
Never use a toast alone for an error.

## Forms

The standard pattern is `Field` + `FieldLabel` + `FieldDescription` + `FieldError`.
`FieldError` renders errors with `role="alert"` to notify screen readers immediately.

**R-16** On form validation failure, show `FieldError` beside each field and move focus to the first error.
Do not put an error summary (a list or count) at the top of the form: most forms have few enough fields to see at a glance, and each invalid field already has a red border and message, so a summary repeats the same information (PM decision).
Even in forms longer than one screen (program creation/editing), focus the first invalid field and scroll it to the center instead of adding a summary; the other errors remain beside their fields with red borders and messages.
**Errors remain alongside `FieldDescription` rather than replacing it**: format guidance such as “숫자 6자리” (6 digits) is most needed when an input is wrong; removing it then takes away the user's way to check it again.
The control's `aria-describedby` appends the error ID to the help ID (`` `${helpId}${err ? ` ${errId}` : ''}` ``).
With only `aria-invalid`, a screen reader says “invalid” without explaining why.
Decision of 2026-09-25 (PM, review #1416): no top summary.
This replaces both earlier instructions—a summary only for long forms (#1401), and a count summary for two or more errors (#1406).
The problem measured in #1406, “the first error is offscreen when only a lower field is invalid,” is already solved by `scrollIntoView({ block: 'center' })` on the first invalid field immediately after submission (in all 10 measurements, the first error was visible after automatic scrolling).
With no summary, users scroll down and find the remaining errors in their respective fields; that is the cost accepted by this decision.

Prevent duplicate submissions while submitting and expose the button's busy state.
Follow `docs/rules/frontend.md` for button alignment.

## Dialogs

The shared shell is `DialogShell` in `apps/frontend/src/components/dialog-shell.tsx`.
It has a title, description, vertically flowing body, and action row; it owns `open` (true by default), `busy` (cannot close during a request), `size` (md/lg), and `returnFocusRef` (returns focus after closing), with either `onSave` (cancel/save) or `footer` for the bottom row.
It follows **R-06**; remaining direct radix imports and `div role="dialog"` in features are tracked for resolution in the R-06 row of Accepted debt.

## Accessibility

Because primitives are based on radix-ui, focus traps, keyboard navigation, and ARIA roles are provided by default.
`Field`/`FieldLabel` do not automatically create `htmlFor`/`id` connections; consumers must connect label and control IDs themselves and lock that down with tests.
The palette anchors for primary (`--primary`) and danger (`--destructive`) colors were chosen darker or more saturated than sojoong.kr's original colors to ensure sufficient contrast against white backgrounds.

Accessibility checks include focus visibility, keyboard reachability, the live-region principles in the feedback/notification table, the contrast rules section, and the items to lock down with tests.

## Test data

This is about how to write tests, not how to manage fixtures.
**R-18** Each test keeps the minimum data needed for its assertions in a readable form.
Builders are optional and used only when multiple tests repeatedly create the same entity.
**R-19** Decide sharing by lifetime, not a file-count threshold.
Promote data to `apps/frontend/test-support/` only when multiple tests use the same inputs over the same lifetime; do not grow a catalog of complete responses, and reserve `*.fixture.ts` for Playwright extensions.
**R-20** Runtime modules do not import test data.
Reject resolvable runtime→test dependencies without exception.
**R-21** `satisfies` checks only TypeScript shape.
It proves neither persistence behavior nor wire compatibility of independently deployed systems; contract tests and actual responses provide that evidence.
**R-22** There is no maximum line count for inline data.
The oracle must be independent of the assertion; split or narrow it if it is hard to read.

## Antipatterns (flag these)

Source: static audit of 2026-09-03.

| AP | Antipattern | Detection signal | Replacement rule |
| --- | --- | --- | --- |
| AP-01 | Disguising failure as empty state | `<EmptyState` inside a `state.kind === 'failed'` or `status === 'error'` branch | R-10 (supporting R-09) |
| AP-02 | Bare error text | `<p role="alert"` outside `components/`, or a standalone `text-destructive` paragraph | R-10 (supporting R-15) |
| AP-03 | Local imitation of toast | `toastMessage`/`setToast` state, a green `role="status"` box | R-13 |
| AP-04 | `role="alert"` without urgency | `role="alert"` on static headings/initial render content, assertive announcements for success Alerts | R-12 |
| AP-05 | Two tones without semantic meaning | `variant="destructive"` for warnings and `default` for success | R-11 |
| AP-06 | Duplicated local Skeleton | `animate-pulse` blocks in feature files (not layout functions named `function *Skeleton` that compose the shared `Skeleton`) | R-17 |
| AP-07 | Reimplemented page shell | `<main` or `text-xl`/`text-2xl` headings in `features/**` | R-07 |
| AP-08 | Raw table | `<table` or direct `@/components/ui/table` imports in `features/**`—resolved by #1297 on 2026-09-19; the remaining 3 locations are recorded exceptions in Accepted debt | R-07 (supporting R-05) |
| AP-09 | Direct Radix dialog assembly | `radix-ui` Dialog/AlertDialog imports or `div role="dialog"` in `features/**` | R-06 |
| AP-10 | Domain component promoted to shared | In `components/` but consumed by only one feature | R-02 (supporting R-01) |
| AP-11 | Missing API contract | A composition lacks any of named `*Props`, `className`, or root `data-slot` | R-04 |
| AP-12 | Long class literal/hex | Single-line `className` over 120 characters, `#` hex, `--palette-*` | R-08a·R-08b |
| AP-13 | Shared catalog unrelated to assertions | Growing a shared module of complete responses/scenarios not used by multiple tests | R-18·R-19 |
| AP-14 | Treating `satisfies` as wire/persistence proof | Recording deployed API or DB behavior as passing based only on DTO `satisfies` | R-21 |
| AP-15 | Runtime import of test data | A runtime module in `apps/frontend/src/**` has a resolvable dependency on a test-only module | R-20 |
| AP-16 | Raw toggle button | `<button` with `aria-pressed` in `features/**`, filter chip classes differing by screen | R-34 |
| AP-17 | Raw icon button | `<button` in `features/**` contains only an icon with classes such as `size-11`/`inline-flex … rounded-control`, or `title` substitutes for a tooltip—6 locations resolved by #1297 on 2026-09-19 | R-27 + Button `size="icon"` |
| AP-18 | Duplicate status labels | `Record<…Status, string>` label constants or StatusBadge variant ternaries in `features/**` | R-35 |
| AP-19 | Options with mixed parts of speech | Predicative `-됨`/`-함` forms mixed with status nouns in the same set of labels in `lib/status-vocabulary/**`, `<option>`, or `FilterChip` | R-41 |

## Accepted debt (2026-09-03)

This table contains only violations identified in the static audit of 2026-09-03.
It does not mean violations absent from the table are allowed.
When new ones are found, add a row and open a follow-up PR.

| Recorded | Violation | Rule | Resolution path |
| --- | --- | --- | --- |
| 2026-09-03 | Fetch failures on some screens still render as `EmptyState` | R-10 | Resolved 2026-09-21—migrated 7 duplicated implementations (#1346) and 9 locations drawing failures as empty boxes (#1355) to the shared `FailureState` (`components/failure-state.tsx`). Locking down the four state branches in per-screen tests (R-09) remains |
| 2026-09-03 | No global notification primitive; local `toastMessage` state in 6 files | R-13 | Notification PR |
| 2026-09-03 | `apps/frontend/src/components/ui/alert.tsx` has only two variants and always uses `role="alert"` | R-11 | Alert kind PR |
| 2026-09-03 | `role="alert"` on static headings—`apps/frontend/src/app/_shell/access-denied.tsx` 18-24, `apps/frontend/src/app/_shell/login-required-notice.tsx` 19-25 | R-12 | Alert kind PR |
| 2026-09-03 | No shared dialog shell → adding `DialogShell` on 2026-09-18 (#1296) migrated 5 program creation/editing/team dialogs; on 2026-09-21, 6 dialogs asking about irreversible actions migrated to `kind="alert"` (#1351). Remaining: direct radix imports in 7 files (6 feature files + 1 `components/program-cover.tsx`) and 4 plain `div role="dialog"` implementations—the shell cannot express their trigger-opened structure, fullscreen lightbox, two-column grid, or direction-changing panel | R-06 | Decide the dialog shell design first, then a follow-up PR |
| 2026-09-03 | CardGrid, PageBody, ListPanel/ListRow, and StatusBadge do not export named `*Props`; PaginationNav, RepositoryPublishCard, and ProgramCountdown roots do not accept `className` | R-04 | Composition API PR |
| 2026-09-03 | Signup typography helpers lack `className` and `data-slot` | R-04 | Composition API PR |
| 2026-09-03 | The root of `apps/frontend/src/components/form-section.tsx` has only the primitive's `data-slot="field-set"`, without its own slot | R-04 | Composition API PR |
| 2026-09-03 | `apps/frontend/src/components/program-card.tsx` remains shared despite having only one consumer | R-02 | PR moving it down into the feature |
| 2026-09-03 | className strings over 120 characters in 43 files and hex constants/inline styles—`apps/frontend/src/features/activity-timeline/components/activity-chart.tsx` 26-29, `apps/frontend/src/features/landing/components/landing-journey.tsx` 401-414 | R-08a·R-08b | Lint introduced 2026-09-19 (#1310). Remaining violations are in `apps/frontend/eslint-suppressions.json`—className suppressions reached 0 with #1328 on 2026-09-21, and hex suppressions in screen code also reached 0 after 2 files switched to tokens. Only 41 hex suppressions across 25 test files remain; run `lint:prune` after fixing them |
| 2026-09-19 | 36 raw `<button>` occurrences across 24 files (including 14 test files)—`app/_shell` navigation, login buttons, access-management tables, schedule editor, calendar, document collection, `program-cover`, `nav-bar` | R-38 | Screen code resolved 2026-09-21—five non-button-shaped locations migrated to `variant="bare" size="content"` (#1328); four icon-button locations and `program-cover` migrated to standard variants. Only 12 test files remain suppressed |
| 2026-09-03 | 9 fixture files, 1,022 LOC in `apps/frontend/src/features/**` | R-18·R-19 at the time | Current rules require minimal inline data and lifetime-based sharing. The filename ban was abolished; only unused catalogs are reduced |
| 2026-09-03 | The local-review harness consumes a feature fixture from `apps/frontend/test-support/local-review/fixture-response.ts` | R-20 | No exception. Boundary lint rejects runtime→test dependencies. This row records the coupling at that time; resolution requires removing it from runtime |
| 2026-09-19 | 2 chart `sr-only` `<table>` elements for screen readers only—ActivityPanel in `apps/frontend/src/features/staff-insights/insights-panels.tsx`, and `apps/frontend/src/features/staff-insights/participation-panel.tsx` | R-07 | Confirmed exception. DataTable draws a focusable scrolling region and empty-state row, which do not suit invisible screen-reader-only tables. Keep semantic `<table>` |
| 2026-09-24 | No form has a count summary at the top even with multiple errors—clearing every required value in program creation (`programs/new`, basic-information step) and program editing shows 4 errors each; board post creation/editing shows 2 each (title/body), only beside fields | R-16 | Resolved 2026-09-25—the rule changed, so this is no longer a violation. The decision is to omit the top summary (R-16, PM decision). Alongside this decision, first-error focus was added to three forms found lacking it in the same investigation (settings, the administrator's profile-edit card, and the add-milestone dialog in program creation) |
| 2026-09-19 | Document collection matrix—`apps/frontend/src/features/programs/milestone-document-collection-view.tsx` directly composes `ui/table` | R-07 | DataTable's columns/data model cannot express sticky team columns, `colSpan` review rows, or row expansion. Migrate when DataTable gains a row-expansion slot |
| 2026-09-23 | Even read-only table rows change background on hover—the default `hover:bg-muted/50` on `TableRow` at `apps/frontend/src/components/ui/table.tsx` 97 applies to every row, including headers and empty states | R-31 | Confirmed exception (#1368). The computed value over white is `oklab(0.976 0 0 / 0.5)` = rgb(251, 251, 251), just 4 out of 255 levels away from white, so the misleading “clickable” signal is barely visible; it remains as an aid to following rows across wide tables. List rows are different—#1352 removed default hover from `ListRow`, and callers add it only when the whole row is clickable. `DataTable` distinguishes clickable table rows with `cursor-pointer` |

## Component cards

### AppShell

Use when: arranging the header/footer together with the app frame.
Don't use when: the content is a standalone card; use Card instead.
Slots·Props: `header`, `footer`, and div props from AppShellProps.
States: header and footer are optional.
Do·Don't: adjust only spacing through root className; do not recreate the page shell.

### NavBar

Use when: providing global or work-screen navigation.
Don't use when: these are secondary tabs within one screen; use that feature's navigation instead.
Slots·Props: `items`, `brand`, `actions`, `menuResetKey`, and `sidebarDrawerOpen`/`onToggleSidebarDrawer`/`sidebarDrawerId` from NavBarProps.
States: `<details>` owns the collapsed menu; the caller marks the current item on the link.
Accessibility: the drawer toggle has `aria-expanded`/`aria-controls`, and Escape closes the collapsed menu.
Do·Don't: declare destinations with NavItem rather than making an arbitrary collection of links.

### PageHeader

Use when: displaying a page title with supporting description/actions.
Don't use when: the title is within a section; use SectionHeading instead.
Slots·Props: title, description, and actions from PageHeaderProps.
States: description and actions are optional.
Accessibility: select h1/h2 through `titleAs`.
Do·Don't: do not reimplement page titles in each feature.

### PageBody

Use when: a feature page needs the standard body width and spacing.
Don't use when: this is standalone modal content; use the dialog body instead.
Slots·Props: not exported—see Accepted debt (R-04).
Do·Don't: follow R-07.

### SectionHeading

Use when: displaying a top-level section title with description/actions.
Don't use when: this is a page title; use PageHeader instead.
Slots·Props: title, meta, and action from SectionHeadingProps.
States: meta and action are optional.
Do·Don't: do not assemble text-xl headings directly.

### StatusMessagePage

Use when: displaying a full-page status message.
Don't use when: R-10 applies.
Slots·Props: icon, title, description, action, header, and footer from StatusMessagePageProps.
States: icon, description, action, header, and footer are optional.
Accessibility: specify a title and action.
Do·Don't: follow R-10.

### DetailPanelLayout

Use when: placing a detail body beside a supporting panel.
Don't use when: this is a single-column list; use PageBody instead.
Slots·Props: primary, secondary, and `stacked` from DetailPanelLayoutProps.
States: select vertical stacking with `stacked`.
Do·Don't: do not duplicate the grid structure in each feature.

### CardGrid

Use when: displaying a list of homogeneous cards in a responsive grid.
Don't use when: this is row-based data; use DataTable instead.
Slots·Props: not exported—see Accepted debt (R-04).
States: the consumer controls the number of children.
Accessibility: distinguish card titles from links.
Do·Don't: do not replace it with an arbitrary grid className.

### DialogShell

Use when: opening a window over a screen to edit values or obtain a decision, with title, description, body (a top-to-bottom form), and action row together.
Don't use when: use Alert for a one-line notice, the failure surface for a failure blocking the entire screen, and the alertdialog variant (follow-up) to confirm an irreversible decision.
Slots·Props: title, description, children, size (md/lg), busy, returnFocusRef, open, onCancel from DialogShellProps, plus either onSave+confirmLabel or footer.
States: open; busy (cannot close, buttons disabled); closed (focus returns).
Escape, outside click, and cancel all converge on onCancel.
Do·Don't: do not assemble radix Dialog directly in feature code (R-06).
The cancel label is always “취소” (Cancel) (#1247).

### EmptyState

Use when: explaining the cause of a normal empty state and the next action.
Don't use when: R-10 applies.
Slots·Props: icon, title, description, and action from EmptyStateProps.
States: icon, description, and action are optional.
Accessibility: give the action a specific name.
Do·Don't: follow R-10.

### FilterChip

Use when: placing pressed buttons that filter a list or select one item within a group (status filters, review-decision selection, step navigation); place `FilterChip` inside `FilterChipGroup`.
Don't use when: use StatusBadge for read-only status, a link for navigation to another screen, and the card itself for selecting a card.
Slots·Props: aria-label and className from FilterChipGroupProps; pressed and Button props from FilterChipProps.
The group must have either an `aria-label` string or `aria-labelledby` pointing to a visible heading; the type enforces this union.
States: pressed (aria-pressed), hover, focus-visible, disabled.
Move between chips with Left/Right arrows, Home, and End.
Do·Don't: chips are rounded pills but retain h-control (44px) and a border.
Do not turn them into StatusBadge-like surfaces with h-tag height, a leading dot, or no border (R-31, R-34).

### FormSection

Use when: grouping related inputs in a fieldset.
Don't use when: this is a single control; use Field instead.
Slots·Props: title, description, and fieldset props from FormSectionProps.
States: description is optional.
Accessibility: title supplies the group name through a legend.
Do·Don't: do not imitate form-group semantics with a div.

### PaginationNav

Use when: providing navigation by page number.
Don't use when: this is infinite scrolling; use that feature's load-more instead.
Slots·Props: page, totalPages, onPageChange, and required `ariaLabel` from PaginationNavProps.
States: render nothing when `totalPages <= 1`; disable previous/next on the first/last page.
Accessibility: `ariaLabel` becomes this pagination's accessible name.
Do·Don't: do not duplicate page state separately.

### ProgramCard

Use when: displaying a program summary, status, and schedule as a card.
Don't use when: this is a detail editing screen; use DetailPanelLayout instead.
Slots·Props: title, status, badgeText, optional `category`, `period`, `note`, `noteIcon`, `href`, and div props from ProgramCardProps.
States: opens whenever `href` exists, regardless of status.
Accessibility: make the href destination clear.
Do·Don't: move it into the feature when resolving the shared-promotion debt.

### RepositoryPublishCard

Use when: displaying repository publication status and a publish action.
Don't use when: this is a general program summary; use ProgramCard instead.
Slots·Props: repository, isPublishing, errorMessage, and onPublish from RepositoryPublishCardProps.
States: six states—unlinked (`repository` null), public, publishable, blocked (`blockedReasons`), publishing, and error.
Accessibility: explain busy state and blocking/error reasons in text.
Do·Don't: do not allow duplicate actions while publishing.

### DataTable + RowActions—group

Use when: displaying row data with row-specific actions.
Also wrap icon-action groups attached to one item, such as edit/delete in a card header, in RowActions.
Don't use when: this is a card-style summary; use CardGrid instead.
Slots·Props: columns, data, and rowKey from DataTableProps; the column representing a row becomes `<th scope="row">` through `rowHeader`.
RowActions is a right-aligned action slot whose icon buttons use `Button variant="ghost" size="icon"` + Tooltip + a row-specific `aria-label` (R-27).
States: this component owns loading/empty/ready; the caller renders error through a failure surface.
Accessibility: provide `caption` and `scrollRegionLabel`.
If the card title already shows the table name, use `hideCaption` so only assistive technology reads the caption.
Do·Don't: follow R-07.
Add `cursor-pointer` only when the whole row is clickable; nonclickable rows retain the default `TableRow` hover background (Accepted debt, 2026-09-23 row).

### ListPanel + ListRow—group

Use when: building a selectable list and its rows.
Don't use when: data needs aligned columns; use DataTable instead.
Slots·Props: not exported—see Accepted debt (R-04).
States: the consumer supplies selected/unselected states.
Accessibility: specify each row's name and selection state.
Do·Don't: do not duplicate list grids in each feature.

### StatusBadge (+ statusBadgeVariants)—group

Use when: visually displaying a short status kind.
Don't use when: this is feedback requiring a next action; use Alert instead.
Slots·Props: not exported—see Accepted debt (R-04).
States: five variants—`recruiting`, `closed`, `pending`, `approved`, `rejected`.
There are two sizes, default and `lg`; use `lg` only when the badge stands alone as the block's main information (such as in the middle of a card).
Statuses attached to other information in lists/tables/rows use the default size; as of 2026-09-24, no screen uses `lg`.
Accessibility: label text conveys the status rather than color alone.
Do·Don't: map domain statuses to the five variants; callers must not create new color combinations.
Take labels and variants from the maps in `lib/status-vocabulary` (R-35, Status vocabulary).

### ProgramCountdown (+ remainingUntil · formatClock · formatCountdownDate)—group

Use when: displaying time remaining until the next deadline and its date.
Don't use when: this is a record of a past event; use a static date instead.
Slots·Props: nextMilestoneLabel, dueAt, and optional `now`/`untilLabel` from ProgramCountdownProps.
States: three states—placeholder before mount, active countdown, and past deadline (fixed at zero).
Do·Don't: do not render negative time remaining.

### Signup typography helpers—SignupEyebrow · SignupLede · SignupTitle · signupPrimaryClassName—group

Use when: the signup screen needs its prescribed title, introduction, and primary-action typography.
Don't use when: this is general page typography; use PageHeader and SectionHeading instead.
Slots·Props: not exported—see Accepted debt (R-04).
Accessibility: use SignupTitle as the page's single title.
Do·Don't: do not copy helper classes to create new typography.

## Screen decision records

### People-centered schedule and submission forms

- In basic information for program creation/editing, place the cover-image input after the program name.
  `기존 공지로 빠르게 시작하기` (Quick start from an existing announcement) is a supporting action beside the basic-information heading; it moves below the heading on narrow screens.
  Handle the announcement URL, loading, and item selection in the existing dialog, and do not change the in-progress values before applying the selected content.
  Below the cover-image label, use a full-width dashed area with icon, upload heading, allowed formats/size, and select button arranged top to bottom.
  After selection, show the entire image in that same area, followed by the filename or announcement source and replace/remove actions; do not repeat the same preview beside the page title.
  Use existing Field, Button, ProgramCover, and semantic tokens, retaining JPG/PNG, the 5 MB limit, and save timing.
- For application/operation schedules in program creation, show one calendar first, then one row each for the application and operation periods.
  Select a row, then click its start and end dates in order on the calendar; to enter dates and times together, use only the single schedule-entry modal for that row.
  Each row offers a reset action, without splitting date and time entry into separate modes.
  Show applications in blue, operations in green, and milestones in orange; draw continuous periods as bars spanning week boundaries rather than separate chips for each date.
- The milestone calendar disables dates outside the operation period.
  Clicking start and end dates in sequence immediately draws the range on the calendar while preserving the operation period's boundary times, then opens the add-milestone modal.
  The modal handles period, name, announcement, and attachments together; the add button below the calendar reuses the same modal.
  Restate the selected date/time as a Korean sentence in the format `YYYY년 M월 D일 (요일) HH:mm`.
- Date errors do not automatically change values.
  Near the field, explain the two conflicting times, why saving is unavailable, and which input needs correction.
- A milestone is a stage with a name, schedule, and guidance.
  Do not create submission items by default for a new milestone; create one student submission target for each announcement, form, or reference file attached by faculty/staff.
  The target name starts from the filename and can be edited by faculty/staff; required/optional is set per file, and the `FILE/TEXT` choice is not exposed.
- Reorder milestone attachments with the drag handle before each item.
  Besides mouse/touch, users must be able to pick up the handle with a keyboard, move with arrow keys, and drop or cancel.
  Announce the current and dropped positions to screen readers in Korean, and disable position-transition animation under reduced motion.
  Save the entire order once only after a drop finishes; on failure, keep the last server-confirmed order and provide a retry action at that item.
- Students can submit content only, a file only, or both on one submission screen.
  Block submission if both are empty or the selected file's size/extension errors remain unresolved; show `내용이나 파일을 하나 이상 추가해 주세요.` (Add content or a file) and `둘 다 추가해도 됩니다.` (You can add both) as separate sentences.
  ZIP content preflight is guidance; a preflight rejection or failed preflight request must not disable the submit button.
  During actual submission, the server repeats the same check and makes the final allow/reject decision.
- Before file selection, each upload area states the allowed formats and maximum size in one line and uses the same list in `accept`.
  Student submissions use `PDF, HWP, ZIP · 최대 5 MB` (maximum 5 MB); faculty/staff form uploads (program details/milestone editing) also accept image forms and use `PDF, HWP, JPG, PNG, ZIP · 최대 5 MB`.
  Both use the same sentence structure but derive format lists from their own policies; sharing one sentence would make the other area incorrect when one policy changes.
  Read the numbers and format list directly from `fileUpload` in the document-list or milestone-edit response.
  For files exceeding the limit or outside allowed formats, keep only the name and rejection reason, not the actual File.
  The file input remains usable; users can immediately choose another file or clear only the error with `파일 없이 계속` (Continue without a file).
  Both recovery actions preserve the written content and do not auto-submit.
  Show the presence of any existing attachment even during an error, and explain that it will be absent from the latest submission if no new file is provided.
  Also show the filename that will be omitted in the single existing confirmation dialog for final resubmission after the deadline; do not add another confirmation dialog for pre-deadline edits.
  Use only `MB` as the unit label (the actual limit is 5 MiB).
  The server's rejection message uses the same wording.
- On program document status and milestone collection screens, expand the ZIP scope selector with a download icon and collapse it with a close icon.
  Provide an accessible name and tooltip appropriate to each state, keeping visible text on the actual download button.
  Select the whole program/milestone/team and folders grouped by team/document, then download immediately after a summary explaining that only current submission text/files are included, with previous history excluded.
  When opened from a milestone, initially select that milestone, retaining the existing collection table's per-item ZIP and grouping controls.
  List search/filtering and download scope are independent; do not estimate file counts or exclusions without a preview API.
  On download failure, preserve selections and retry through the same action without a separate reconfirmation popup.
- Creation and editing use the same terms and information order.
  Step navigation in program creation is `계속` (Continue), which does not save to the server; create all content only after `프로그램 만들기` (Create program) in final review and the confirmation modal.
  Do not use wording such as draft save or autosave that suggests the written content persists on the server or in the browser before creation.
  Screens that immediately update the server, such as existing program editing, use the outcome-specific `저장` (Save).

### Student team formation, application, and invitation interactions

This is the interaction contract for the screens where students form teams, invite teammates, and apply to programs.
Use standard terms only: contextual action, progressive disclosure, visual hierarchy, semantic affordance, and single-page form.
This section applies only to student application screens and does not change the step-navigation decision for program creation by faculty/staff.

**R-26—contextual action**: the entry point for inviting teammates belongs inside the team roster.
Invitation input uses one shared search modal, reused by the list and application screens.
Do not put an invitation toggle or an open/close-invitation-form switch in `PageHeader`: an action far from its target list loses the context of what the invitation is for.
This rule governs trigger placement, not where the modal is implemented: opening through a portal or owning open state in a parent controller/screen state still satisfies it if the trigger is in the roster.
Detection signal: invitation triggers outside the roster—invitation buttons and invitation-toggle state in `PageHeader` or the top page-action area.

**R-27—progressive disclosure**: collapse secondary row actions (role change, invitation cancellation, removal, etc.) into icon buttons or row menus, with tooltips.
Accessible names must be unique per row (`{이름} 초대 취소`, “Cancel {name}'s invitation,” not just `초대 취소`, “Cancel invitation”).
Do not remove the confirmation dialog for an irreversible action simply because its trigger is collapsed (the dialog row in the feedback/notification table).
Detection signal: the same accessible name repeated across rows, icon-only buttons lacking `aria-label`/tooltips, or destructive row actions executed immediately without confirmation.

**R-28—single-page form and final confirmation**: handle profile confirmation, team formation, repository linking, and consent together on one application screen, ending with one application confirmation.
Do not mix arbitrary step wizards, refresh requirements, or destructive controls such as team deletion into the in-progress form.
Primary action buttons such as submit/confirm/cancel keep visible text; this is not a general ban on text buttons.
Detection signal: step-index state on the application screen, a team-delete button inside the application form, or a `window.location.reload` call.

**R-29—pending invitations**: show sent invitations in the same roster with `초대 대기` (Invitation pending), without a separate list.
A pending invitation appears only once as a pending roster row and must not duplicate the same person as an accepted member row; distinguish pending invitees visually from accepted members and exclude them from member/capacity counts.
Write timing is as follows: entering/rendering the screen or entering search text does not trigger a team-creation write.
Create a draft team only on explicit invitation entry by the user (the roster invitation trigger, because the current team-scoped search requires a draft) or final application confirmation.
Sending an invitation actually sends it at that moment rather than waiting for application confirmation; the one false promise would be `모든 쓰기는 최종 확인까지 미뤄진다` (All writes are postponed until final confirmation).
Detection signal: a second list component containing `초대 대기` entries, pending invitations included in accepted-member counts, or team-creation requests from render/search-change effects.

**R-30—compact lists**: render teammates, invitations, and submission items as dense rows in `DataTable` or `ListPanel`+`ListRow`, not repeated cards per item.
Detection signal: `CardGrid` around a roster/invitation list, or a repeated `Card` per item.

**R-31—separate state, action, and navigation**: show status as text or `StatusBadge`, without making it look like a button.
UI actions that do something within the current screen—opening a dialog, expanding a row, applying a filter—are `button` actions as well as server writes.
Only navigation to another screen uses a real link rather than a local handler styled as a button.
Detection signal: `disabled` buttons containing status strings, or buttons whose `onClick` only calls `router.push`.

**R-32—meaningful numbers and redundant sentences**: keep a number on a screen only when a label can explain what it counts; otherwise remove it.
Do not add introductory sentences that restate a heading or list count.
Safety guidance, next actions in error messages (R-15), and consent wording are not redundant and must not be replaced with silence.
Detection signal: large unlabeled numbers or introductory paragraphs repeating the immediately preceding heading/count.

**R-33—verification evidence**: report a screen changing these patterns as ready only after recording source-based pre-review evidence (`file:line - finding`).
After review, check keyboard reachability and mobile-width behavior on the actual rendered screen.
Before submitting a PR, complete UX review of the changed user flow, fix the discovered issues, and reverify the same flow.
Passing tests or source review cannot substitute for UX review of the actual screen.
Follow `skills/submit-pr-evidence/SKILL.md` for review evidence and public-attachment procedures.

### Program editing—milestone editing layer

- The title includes the target name, `{마일스톤명} 수정` (Edit {milestone name}), and fields are fixed to milestone name, start date/time, deadline date/time, and submission guidance.
  While the layer is open, exclude the background program-editing screen from interaction and scrolling; only the body scrolls, with the `취소`/`저장` (Cancel/Save) action footer fixed at the bottom.
- At `sm` and above, show a centered card; below `sm`, use full width and fullscreen `100dvh`.
  Do not create horizontal overflow at any width.
- Show a discard-changes confirmation on close requests only when current values differ from initial values; if all values are restored exactly to their initial values, treat the form as clean and close immediately.
  While confirmation is open, the top confirmation layer takes priority for the focus trap and `Escape`; one `Escape` closes only the confirmation, without cascading into closing the edit layer underneath.
- Successful saving applies the change and closes the layer; discarding changes drops unsaved values and closes the layer.
  After final closure, both the save and discard paths return focus to the `수정` (Edit) button that opened the layer.

`ProgramEditMilestoneDialog` owns layer structure, closing, and final focus return; `ProgramEditMilestoneForm` owns fields and the fixed action footer; `isMilestoneFormDirty`/`hasUnsavedMilestoneEdit` own dirty detection against initial values and screen-leaving state.

### Loading, empty, and error states

The standard error/empty-message pattern is `Alert` + `AlertTitle` + `AlertDescription`.
Dedicated loading-state components (Skeletons, etc.) are outside this stage's scope and will be added in B-6 if needed.

Do not stop at describing the state.
Provide at least one suitable next action—such as `다시 시도` (Retry), `목록으로 이동` (Go to list), `일정으로 이동` (Go to schedule), or `제출 항목 추가` (Add a submission item)—so visitors can continue their intended task.
When access is denied, state the required permission and an alternative screen they can visit.

### Landing cosmos scroll journey

The first screen of the landing page (`/`) is a journey through a cosmos drawn on a single canvas, traversed by scrolling.
There are no different landings based on visit count or login state: every visitor sees the same journey, with only one primary CTA button varying by session.

| File | Responsibility |
| --- | --- |
| `features/landing/components/landing-journey.tsx` | Stage and five-panel DOM, scroll progress calculation, render loop |
| `features/landing/components/landing-journey.module.css` | Stage height, panel placement, scrim, legend, progress indicator, reduced motion |
| `features/landing/cosmos/cosmos-graph.ts` | Presentation graph generation and 3D force-directed layout |
| `features/landing/cosmos/cosmos-camera.ts` | Five-part camera choreography and panel-range constants |
| `features/landing/cosmos/cosmos-renderer.ts` | Canvas 2D rendering—sky, stars, aurora, nebulae, relationship lines, celestial bodies, bloom, labels, speed lines |
| `features/landing/cosmos/cosmos-theme.ts` | Canvas-only color constants (`DAWN_THEME`) and interpolation helpers |
| `features/landing/cosmos/cosmos-quality.ts` | Quality governor reducing resolution when the frame budget is exceeded |

#### Stage structure

- The journey container (`.journey`) is `560vh` high with a `--cosmos-void` background.
  Its stage (`.stage`) fills `100svh` with `position: sticky; top: 0`.
  Scroll distance directly determines scene progress.
- Progress is `-journey.getBoundingClientRect().top / (journey.offsetHeight - window.innerHeight)` clamped to 0–1.
  It only reads native scrolling, without intercepting scroll or changing inertia.
- The displayed value follows target progress each frame with `+= (목표 - 현재) * 0.09` (target minus current), snapping to the target when the difference is below `0.0002`.
  When scrolling stops, the camera soon stops too.
- Stage layers are ordered canvas → vignette (z 2) → scrim (3) → panels (4) → legend/progress indicator/SCROLL hint (5) → skip link (8).
- The top header is a standard white bar on every screen (`app/_shell/shell-nav.tsx`).
  Only on the landing page, it floats with `fixed inset-x-0 top-0 z-40`, keeping the menu visible throughout the 560vh journey.
  The signup body's cosmos inversion (`data-surface="inverted"`) applies only to the body scope: on cosmos-background routes (`COSMOS_GROUND_PATHS`), AppFrame applies it to the entire body (`#main-content`), and `SignupStage` also applies it itself.
  This is because the authentication/onboarding gates (AuthGate/OnboardingGate) render “확인 중…” (Checking…) and error text directly in the body outside the stage before it is mounted or when it fails (#1436).
  There is no script hiding the header or changing its surface with scroll.

#### Five scenes

Panel order/ranges correspond one-to-one with camera ranges (`PANEL_RANGES`, `cosmos-camera.ts`).

| Order | Progress range | Eyebrow | Title | Panel contents |
| --- | --- | --- | --- | --- |
| 1 | 0.00–0.16 | Chonnam National University Software-Centered University Project Group | Bring scattered information together (`h1`) | One service paragraph, login-error/logout-notice slots, primary CTA + `프로그램 둘러보기` (Browse programs) |
| 2 | 0.20–0.38 | Programs | Every activity / is organized by program | Three figures for public programs, public repositories, and public contributors, with a source badge |
| 3 | 0.44–0.60 | Flow | From application to publication, / one flow | `STEP 1 신청·팀 구성` (Application/team formation) → `STEP 2 저장소 연결` (Link a repository) → `STEP 3 제출·검토` (Submission/review) → `STEP 4 공개 아카이브` (Public archive) |
| 4 | 0.66–0.82 | My activity | Your participation history / stays in one place | What appears in the dashboard and its visibility (viewable only by the team/faculty and staff; publication approved after review) |
| 5 | 0.88–1.01 | None | Get started / in OSS Hub now | Primary CTA + outlined `프로그램 둘러보기` (Browse programs) button |

- Panels fade over `0.05` before and after their ranges.
  Only when opacity exceeds `0.6` do they get `pointer-events: auto` and have `inert`/`aria-hidden` removed.
  Above `0.5`, the progress tick becomes active.
- The only animated panel properties are `opacity` and `translateY` (22px → 0).
  Layout properties are not animated.

#### What the canvas draws

| Layer | Content |
| --- | --- |
| Sky | A top-to-bottom three-stop vertical gradient: `#000000 → #03040a → #070a15` |
| Background stars | 3 layers (depth 0.18 / 0.42 / 0.75, with 460 / 230 / 95 stars). Each has different parallax; fixed star brightness prevents flickering |
| Aurora | 4 curtains, each drawn with 26 thick, blurred rays and composited with `screen`. Fades as the camera enters a nebula |
| Nebulae | One radial-gradient layer per program star. Only the program being approached is bright; the rest merely suggest their presence |
| Relationship lines | Three types: student↔program, repository↔student, student↔student. The focused program's lines appear in sequence with progress, with light particles traveling along some |
| Stellar body = program | Corona + cross-shaped diffraction spike + white core |
| Star = student | Thin halo + core. Fixed size without twinkling; the protagonist is always slightly larger |
| Planet = repository | A radial gradient biased toward its program star creates spherical shading, topped with a reflected highlight and shallow atmospheric rim |
| Bloom | Only bright cores are drawn separately into a 1/3-resolution buffer, then overlaid with `blur(7px)`. Cheaper than fullscreen postprocessing and does not blur text |
| Speed lines | 80 rays extending toward screen edges only when scrolling fast. Zero below the speed threshold |

The graph itself is created once on mount: 6 programs, 108 students, 152 repositories, and 26 student-to-student links, using seeded random values so each load has the same layout.
The layout runs a 3D force-directed simulation (link attraction, node repulsion, degree-proportional gravity) for 240 iterations, then freezes, with the y-axis compressed into a disk.
There is no continuous simulation, per-frame solving cost, or jitter.

Each frame draws in this order: `하늘 → 배경 별 → 오로라 → 성운 → 관계선 → 천체 → 블룸 합성 → 라벨 → 속도선` (sky → background stars → aurora → nebulae → relationship lines → celestial bodies → bloom composite → labels → speed lines).

Above 900px width, the graph center is at 64% of the screen width (54% in the final scene), with no labels inside the leftmost 40%.
This keeps them clear of the left panel copy.
At 900px or below, the center is in the middle of the screen.

#### Five camera segments

| Progress | Camera | Corresponding panel |
| --- | --- | --- |
| 0.00–0.14 | Entire graph from a distance, zoom 1.0 | 1 |
| 0.14–0.42 | Approaches the focused program's nebula, zoom 2.9 | 2 |
| 0.42–0.62 | Inside the nebula, zoom 4.4 | 3 |
| 0.62–0.80 | Focuses on the protagonist student and their repositories, zoom 6.8. Other nodes/relationship lines dim | 4 |
| 0.86–1.00 | Retreats to the whole graph again, zoom 1.18 | 5 |

The view angle rotates very slowly in proportion to both progress and time (`time * 0.000075 + progress * 1.15`).
This is the minimum motion needed to keep the screen from becoming completely still when scrolling stops.

#### Canvas labels are example data

Names such as `@example-user`, `@example-134`, and `team-nova/api-server` on the screen **are not real users, teams, or repositories**.
They are strings generated for the presentation; `예시 구성` (Example composition) at the right end of the legend explains this.

- Student nodes are numbered from `@example-100`; the protagonist is `@example-user`; repositories use `team-{단어}/{단어}` (word combinations) (`cosmos-graph.ts`).
- Only the program-star names are an exception.
  When the public response arrives, program names replace them from the beginning without recomputing layout.
  Before arrival, or when there are too few names, project-group program type names fill the gaps (`오픈소스 해커톤`, Open-source hackathon; `OSS 기여 챌린지`, OSS contribution challenge; etc.).
- The second panel's figures are counted from the public graph.
  Use `—` instead of a number for zero, and distinguish the source badges `공개 아카이브 기준` (Based on the public archive), `예시 데이터 기준` (Based on example data), `공개 집계 준비 중` (Public aggregation being prepared), and `일부 집계` (Partial aggregation).
  Do not fill missing values with 0.
- Do not create a new public API just for the landing page.
  It reads only the three existing public responses (`programs`, `repositories/public`, `repositories/:id/public`) (`features/landing/api.ts`); personal activity stays behind the permission-checked dashboard.

#### The public graph arrives in two stages

The public list (`GET /projects`) has no contributors.
Contributors appear only in details (`GET /projects/:id`), and the backend has no public endpoint returning contributors across multiple projects at once (`PublicProjectsController` has only list and single-detail endpoints).
Consequently, request count cannot be reduced; what was reduced is waiting time.

| Stage | Input | Screen |
| --- | --- | --- |
| Stage 1 `base` | One list response | Program/repository nodes appear immediately. Contributors are still 0, shown as `—` |
| Stage 2 `complete` | Detail responses (concurrent requests) | Adds contributor nodes |

Previously, the example graph stayed until every detail arrived.
Now round trips before the real public graph appears have dropped from 2 to 1 (`streamLandingGraph` in `features/landing/api.ts`).

#### Do not present partial aggregates as exact counts

Detail requests can fail in two ways, which are handled separately.

| Failure | What happened | Handling |
| --- | --- | --- |
| Transport failure | The request itself failed | Only that project's contributors are omitted. The graph retains a `partial` marker |
| Contract violation | A response arrived, but its format differs from the contract | Fail the entire second stage and stay on the first-stage graph |

Do not swallow both failures in one `catch`.
Silently skipping a contract-breaking response would display a reduced contributor count as an exact figure `공개 아카이브 기준` (Based on the public archive).
Do not show an incorrect count as though it were correct.

Transport failure is different.
Discarding the list too would revert to an example graph despite having all the real public list data, so contain the failure to that project's contributors.
Instead, propagate the fact that the aggregate is reduced to the screen (`LandingGraphCompleteness`).
When `partial`, the second panel leaves the contributor figure as `—` and changes the badge to `일부 집계` (Partial aggregation).
Program/repository counts come from the one list response and remain exact, so leave them unchanged.

If the list itself fails, there is no graph to build.
Throw as before, letting the caller fall back to the example graph.

#### Supporting elements

| Element | Position and behavior |
| --- | --- |
| Skip link | Top left of the stage. Usually pushed upward; drops into view only on keyboard focus. `로그인·프로그램 정보로 건너뛰기` (Skip to login/program information) → `#landing-entry` below the journey |
| Progress indicator | 5 vertical ticks at bottom left. The active tick lengthens, brightens, and gets `aria-current="step"` |
| Legend | Pill at bottom right. Student/repository/program dots and names, ending with `예시 구성` (Example composition) |
| SCROLL hint | Bottom center. Fully disappears at progress 0.08. Accompanied only by one static, nonblinking line |
| Notification slot | Inside the first panel. Login failure is an Alert colored `--hero-danger`. The `role="status"` box for the old logout-notice URL remains only for compatibility. Normal logout returns to the logged-out home without a separate completion screen |

#### Journey accessibility

- The canvas is a decorative layer with `aria-hidden="true"`.
  There are no DOM nodes for manipulating the relationship graph; the real text in the five panels conveys all content.
- Each panel is a `section` with `aria-labelledby`; the first panel's `h1` is the only one in the entire document.
- Invisible panels have `inert` + `aria-hidden="true"` + `pointer-events: none`, so keyboard tabs cannot enter them.
- In addition to the journey-specific skip link, the layout separately has a global `본문으로 건너뛰기` (Skip to main content) link to `#main-content`.
- Progress ticks each have screen-reader text `1단계`…`5단계` (Step 1…Step 5); the list is labeled `소개 진행 상태` (Introduction progress).
- Although the legend is `aria-hidden`, the same student/repository/program distinctions remain as text in panel body sentences.
  No information is distinguished only by color.

#### Reduced motion

With `prefers-reduced-motion: reduce`, the container receives `data-motion="reduce"` and applies the following.

- Remove `560vh` and sticky positioning.
  Stage height becomes auto; the five panels stack in document flow, all opaque and without transforms.
- Do not start the render loop at all.
  Draw the canvas once at progress 0, redrawing only on resize.
  There is no camera movement, speed-line effect, or time-based rotation.
- Hide the progress indicator and SCROLL hint.
  Move the legend into document flow.
  Keep the skip link and every CTA.
- Add top spacing to the first panel so the fixed header does not obscure it.

#### Responsive behavior

| Condition | Adjustment |
| --- | --- |
| Width 900px or below | Replace the diagonal scrim with a top-to-bottom vertical scrim. Center the graph and remove the left label-exclusion zone. Use a 33ms frame budget (16.7ms above this width) |
| Width 820px or below | Hide the legend and progress indicator |
| Height 520px or below (landscape phone) | Move the panel's vertical center down 28px to keep the eyebrow out from behind the fixed header; reduce headings/spacing (statistic numbers retain their one `--step-section` size), and hide the SCROLL hint. Panel composition and order remain unchanged |

Panel horizontal insets are `clamp(16px, 6vw, 96px)`, with a maximum width of 720px.
Headings use `clamp(24px, 5.4vw, 62px)` (h1) and `clamp(22px, 3.6vw, 42px)` (h2); body text uses `clamp(15px, 1.3vw, 18px)`, line-height 1.75, and a maximum 40em; Korean line breaking uses `word-break: keep-all`.
Buttons use the existing Button primitive and retain a minimum 44px touch target.

#### Performance

- Canvas scale is `min(devicePixelRatio × 품질계수, 2)` (quality factor).
  The quality factor has three levels, 1 → 0.75 → 0.5; if the p95 of a 12-frame sample exceeds the budget, step down one level after that single window.
  Promotion uses an asymmetric threshold: step up only after three consecutive windows (36 frames) with p95 at or below 70% of budget.
  The boundary belongs to recovery: a window at exactly 70% counts as having headroom.
  Any intervening window above 70% resets the streak to 0.
  Headroom and consecutive-window conditions alone do not prevent oscillation: on devices where frame cost varies with the quality factor, genuine headroom at the lower level may disappear after promotion, causing repeated rises and falls.
  Therefore, if the **first window** immediately after promotion exceeds the budget, test that level once more; only after **two consecutive** such failures record it as this device's limit and stop attempting to exceed it for the rest of the session.
  One first-window failure is insufficient evidence because promotion resizes the canvas and bloom buffer, mixing transition cost into that window; a GC pause could also happen then.
  The p95 of 12 samples is their maximum, so one slow frame fails the entire window.
  If the first window is within budget, consider that level validated; later pauses, however numerous, do not accumulate as limit evidence.
  Clear the failure record **as soon as the next target level changes**: both when dropping farther for reasons unrelated to promotion (the next target is the lower level) and when a promotion passes its first window (the next target is the higher level).
  Otherwise, one slip at each of two different levels would be added together, banning a level that failed only once.
  Always move one level at a time.
- Stop the `requestAnimationFrame` loop when the stage leaves the viewport or the tab becomes inactive (IntersectionObserver + `visibilitychange`).
- Scroll/resize listeners update progress only; drawing happens in one loop.
  The scroll listener is passive.
- On unmount, release all loops/listeners/observers and clear the bloom buffer and projection arrays.
- The force-directed layout runs once on mount, then freezes.
  Do not compare node pairs again each frame.
- The starfield on the four signup-flow screens (`app/_shell/signup-starfield.tsx`) does not reuse this canvas.
  With no moving camera, it is fixed as one static SVG (3 seeded layers, `preserveAspectRatio="xMidYMid slice"`); without a render loop, it is outside this quality governor's scope.

#### Color tokens

The `--cosmos-*` semantic tokens in `globals.css` color only the DOM layers (panels, legend, progress indicator, buttons).
Colors inside the canvas come from the RGB constant set (`DAWN_THEME`) in `cosmos-theme.ts`.
The full policy document (`public/policies/policy-document.css`) is a third copy: it is a separate document inside a `sandbox=""` iframe and cannot inherit these variables, so it redeclares the same palette values as literals.
**Since these three locations are separate, inspect all three when changing cosmos colors.**

| Semantic token | Reference | Consumer |
| --- | --- | --- |
| `--cosmos-void` | `#00133a` (outside the ramp; must match `sky[0]`) | Journey-container background, signup-flow background |
| `--cosmos-copy` | `--palette-white` | Default heading/body color, active progress tick, links/outlined buttons |
| `--cosmos-muted` | `--palette-navy-200` | Eyebrow, body text, legend, inactive ticks, SCROLL hint |
| `--cosmos-repository` | `--palette-green-300` | STEP numbers in the flow panel |
| `--cosmos-edge` | `--palette-navy-300` | Statistic item labels |
| `--cosmos-border` | white 12% | Borders for eyebrows, outlined buttons, source badges, legend, and skip link |
| `--cosmos-danger` | `--palette-red-300` | Warning text on dark backgrounds (refusal guidance on the consent screen). Cannot use `--destructive`, because the inverted scope overrides it with `--hero-danger` |
| `--cosmos-near` | `--palette-navy-950` | Surface background for the full-policy popup on narrow screens |
| `--cosmos-student` | `--palette-navy-200` | Defined only—the legend's student dot uses an inline color matched to the canvas theme |
| `--cosmos-scrim-strong` · `--cosmos-scrim-soft` | black 95% · 48% | Defined only—the scrim currently uses literals with the same values in the CSS module |

The light area below the journey and the bottom CTA continue to use the existing `--hero-*` inverted-surface tokens.

#### Primary CTA by session

The journey is identical regardless of session; only the primary buttons on the first and final panels change (`app/_shell/landing-entry-action.tsx`).
Do not redirect visitors to their role home simply for visiting home.
If login began from a protected screen, return once to the validated original path after signup completion.

| Session state | Primary button | Destination |
| --- | --- | --- |
| Checking | `세션 확인 중` (Checking session; disabled, `aria-busy="true"`) | — |
| Anonymous | `로그인` (Log in)—after login failure, `로그인 다시 시도` (Retry login) | `/signup` |
| Logged in, role unconfirmed | `로그인` (Log in)—the **same** button as logged out | `/signup` |
| Student | `내 대시보드` (My dashboard) | `/dashboard` (body: student dashboard) |
| Faculty/staff | `운영 대시보드` (Operations dashboard) | `/dashboard` (body: operations dashboard) |
| Administrator access only | `사용자 목록` (User list) | `/dashboard/users` |
| Lookup failure | `로그인` (Log in)—keep the **same** button as logged out | `/signup` |

Anonymous and role-unconfirmed sessions share a destination because **two entry points must still have one destination**.
To users, both simply mean “enter”; `/signup` determines the resumption point, so there is no separate `가입 계속하기` (Continue signup) branch (`features/auth/signup-entry-link.ts`).

Removing the button on lookup failure would leave no entry point on the first screen: the hero's primary button disappears and none remains in the header (`features/auth/session-view.ts` folds failure into `null`), leaving only “프로그램 둘러보기” (Browse programs).
The only recovery route, the `SessionError` banner, is 5,400px down the document.
The unknown role prevents linking to a role home, but entry itself is independent of session, so reuse the logged-out button to keep the two entry points from splitting into separate destinations.
Keeping only the same button as logged out would imply “you have been logged out,” so beneath it explain both the failure and that the user has not been logged out, in the same tone as `SessionError`.
Because `--muted-foreground` is hard to see on dark surfaces, this paragraph changes color according to `inverted`.
The nav continues to hide the link on lookup failure (`role-home-link.tsx`): it appears at the top of every screen and has no space to explain the failure, so a button alone would cause the same misunderstanding.

Role-specific labels derive from the first item in the role menu (`role-menus.ts` → `role-home-link.tsx`); the two values cannot diverge.
On dark surfaces, invert the button to white background/navy text (`inverted`); in the light area below the journey, use the default button.

#### After the journey

The journey continues into a light work layout on the same page (`app/page.tsx`).
The order is (error/retry on session lookup failure) → `#current-programs` (currently recruiting programs) → participation process → bottom CTA → footer.
Retain the arrangement in which visitors see the introduction first and scroll to reach programs.
This area follows the same primitive/token contracts as other screens and does not inherit the cosmos presentation.
Do not extend this order with benefit cards or role-introduction cards.

### Access-permission guidance

When users enter a screen they cannot access, show guidance instead of silently sending them back (`app/_shell/access-denied.tsx`).
A silent redirect makes users wonder why a different screen is open and repeat the same attempt.

| Session state | Behavior |
| --- | --- |
| Checking | `확인 중…` (Checking…) (`role="status"`) |
| Anonymous | Show `로그인이 필요합니다` (Login required), with login/home buttons |
| Role unconfirmed | Go to the onboarding route appropriate to the request status |
| Has a role but lacks permission | Stay in place and show access-permission guidance |
| Lookup failure | Do not redirect anywhere; show error/retry |

The guidance is a section whose title is connected with `aria-labelledby`, containing `접근 권한이 없습니다` (You do not have access), a one-sentence explanation, and one `내 화면으로 돌아가기` (Return to my screen) button (outlined, `min-h-11`).
The caller specifies the return destination.
This is persistent guidance replacing an entire screen, so do not use `role="alert"`, which reads as an urgent warning.

### Login, account switching, and logout

The primary action at `/signup` is `GitHub으로 계속하기` (Continue with GitHub).
Put the supporting action for choosing another account and the GitHub signup link on the same entry screen; place manual GitHub logout instructions inside account-switching help.
After successful service logout, go to the logged-out home (`/`) without asking users to choose another guidance option.
On failure, retain the current screen/session and show the error.
The old `/logout` address also redirects home.

Post-login return applies only to the internal path the user selected.
Do not restore query strings, hashes, or in-progress input, and do not store external addresses or authentication/signup-processing routes.
Return information is single-use for 10 minutes and is cleared on logout.

### Role selection screen

`features/roles/components/role-selection-screen.tsx`.
The central rule is that the screen must not shift when a selection changes.

| Rule | Method |
| --- | --- |
| Reserve space for guidance | Always render the role-specific next-step guidance slot as a `min-h-20` grid. Before selection, show a dashed placeholder with the same box dimensions as Alert (corners, spacing, font size). The submit button below does not move when guidance appears |
| Fix the form width | `w-[min(100vw-2rem,40rem)]`. With `items-center` on the parent, content-driven width previously expanded sideways when guidance appeared. The fixed width aligns its sides with the step indicator above |
| Match card heights | Put both cards in an `items-stretch` grid with `h-full`. Both must have a one-line bottom summary (`승인 없이 바로 시작합니다`, Start immediately without approval / `관리자 승인이 필요합니다`, Administrator approval required) |
| Indicate selection with shapes | Selection markers are a filled check circle and an empty circle of the same size. Do not rely on ring color alone, and do not shift the cell when state changes |
| Fit within one screen | Use `min-h-[calc(100dvh-9rem)]`, subtracting the height of the shared shell and onboarding step indicator above. **Rejection guidance is an exception—see below** |

#### Exception to “fit within one screen”—rejection guidance (#673)

Users whose faculty/staff requests were rejected arrive on this screen (#535), with the rejection and reason above the cards.
That box pushes the `선택 완료` (Complete selection) button below the fold on narrow screens.
**This is knowingly accepted; do not revert it based on the table above.**

| 375×812 | Button bottom | Within viewport | Document height |
| --- | --- | --- | --- |
| No notice | 732px | Yes | 812 (0 scrolling) |
| With notice | 929px | **No** | 993 |

At 1440×900, the positions are 739.3px → 819px, both within the viewport (document 900, scrolling 0).
Only narrow screens incur the cost.

There are three reasons.
① “Fit within one screen” was written for **an initial signup flow with nothing to read**, whereas a rejected user's first task is **reading why**, not choosing: choosing again without knowing the reason risks another rejection for the same reason.
② Keeping the button in the viewport would require guidance no taller than 85px, but a heading + two lines of reason + spacing already total 92px; as long as the reason is shown inline, no arrangement works at 375.
③ Collapsing the reason would fit the height but partially recreate the defect #673 is addressing (“the reason does not reach the user”).

The cost was reduced instead: combining two explanatory sentences into one reduced the box from 222px to 202px, and reason length/line count are capped (`clampRejectionReason`).
The horizontal card arrangement remains **unchanged independently of this exception**: stacking cards vertically would make first-time users without a notice scroll too.
Measurements and the reasons not to revert are in the `ClosedRoleRequestAlert` comment in `role-selection-screen.tsx`.

The radio is an `sr-only` peer, and the whole label is clickable.
The card receives a focus ring through `focus-within`; the submit button uses `min-h-11 w-full` for a 44px touch target.

### Work-screen navigation

**Shared top `NavBar` (`ShellNav`) + section-context left panel.**
Selecting a section at the top makes the left panel show **only that section's peer filters**, not a cumulative menu.

| Item | Decision |
| --- | --- |
| Background | Keep pure white |
| Top Nav | Programs · Public archive · Rankings. After signup, **Dashboard** (`/dashboard`, fixed label). The entry URL is shared regardless of role; only body/left menu differ by session `User.role` (DB, `/auth/me`). Do not add the item for nonmembers |
| Left side panel | **Contextual**—programs `?status=`, archive `?year=`, rankings `?year=`, dashboard role menu (student: repositories/activity; faculty/staff: operations dashboard/student activity/signup requests; administrator: faculty/staff group [operations/student activity/signup requests] + user list/audit/system). The single entry URL is `/dashboard`, and the ADMIN body is also the operations dashboard. Filters are flat peers, with no nested tree. Show count badges even at 0. Do not put a creation waypoint in the side panel. In the programs section, offer a list `PageHeader` CTA to faculty/staff and administrators with completed profiles; retain screen-specific CTAs on the operations dashboard |
| Mobile (&lt;900px) | Hide the left panel; provide the same filters as body chips |
| Layout | Below a full-width Nav, `[side \| body]` (≥900px). No panel on landing/signup |
| Surface tone | The top Nav is a standard white bar on every screen. Put `data-surface="inverted"` only on the signup body—the cosmos-background route's `#main-content` (AppFrame, including authentication/onboarding gate text outside the stage) and signup stage (`SignupStage`)—and two consent-dialog locations: the inner panel of the consent-required dialog (which also appears on the white `/onboarding/pending` screen) and the entire full-policy dialog. This scope overrides background, foreground, muted(-foreground), accent(-foreground), border, card(-foreground), ring, and destructive(-on-tint). It does not override `--popover` or `--primary`: the open department-select list and navy text on the white primary button rely on `:root` values |
| Settings | Account dropdown. Do not put the same waypoint CTA as the sidebar in the body PageHeader |
| Accent color | Keep navy, but use it for only one primary action per screen |

Body aesthetics such as card styling and table density continue in each screen's decisions.

Accounts with both student membership type and faculty/staff access (`hasStaffAccess`) distinguish personal (`/dashboard/personal`) and operations (`/dashboard`) screens in the menu.
Students without faculty/staff access see the personal screen at the existing `/dashboard`, regardless of administrator access.
For accounts with multiple permissions, summarize them as `권한 N개` (N permissions) in headers below 900px, with the full permissions available in the account menu and accessible name.

#### Program-scoped left panel

Program details (`/programs/:id` and descendants) use a **program-scoped left panel** instead of the section facet panel.
Dimensions (width, collapsed width, row height, etc.) follow the existing repository implementation; this document specifies **only structure and state-labeling conventions**.

An account with student membership type participating in an approved team in this program defaults to student views on the program overview, documents, and team screens even if it also has faculty/staff or administrator access.
Explicitly selecting `운영 도구로 전환` (Switch to operations tools) opens the operations view after checking existing operations permissions, and navigation within the scope preserves `view=operations`.
The user can return with `학생 화면으로 전환` (Switch to student view).
View selection adds no permissions; existing views remain for nonparticipating faculty/staff and operators whose membership type is not student.
Another operator handles approval, change requests, and rejection of the account's own team's documents, and the server also rejects self-review.

| Item | Decision |
| --- | --- |
| 3 groups | ① Program overview · Participating teams · Applicants (**faculty/staff and administrators only**) ② Documents (role-specific parent) + milestone children at depth 1 ③ Board |
| Applicants | Faculty/staff and administrators only. `/programs/:id/applicants` is the program-application approval/rejection entry point. Participating teams provides status viewing only, so put review entry points here and in the overview CTA |
| g2 parent label | Faculty/staff and administrators: `서류 현황` (Document status). Students: `내 제출물` (My submissions) |
| Milestone children | Add only milestones with documents at depth 1. Otherwise keep only the parent item |
| Item display | Icon + label + count badge (fractions/free-form values allowed; show 0 too) |
| current | Marker and `aria-current="page"` on the exactly matching depth-0 item. No current marker on milestone children at depth 1 |
| Brand row | Replace the list-facet brand with a `‹ 프로그램 목록` (Program list) back link + program-name eyebrow. Destination is `/programs` regardless of role |
| Collapse/deadlines | Show the collapse toggle and deadline area **only while expanded**. Do not render the deadline area before the overview response arrives or when it fails (`remainingMilestones === undefined`). If the overview arrives with no remaining deadlines, put one line in the same location: `마감 일정이 종료되었습니다.` (All deadlines have passed) |
| Participant-only groups | ② and ③ are participant-only screens. **Do not render** those groups for a student confirmed not to participate; do not replace them with disabled locked items. Keep them while participation is still unknown |
| The two groups have different access conditions | ② (My submissions) requires an approved application. ③ (Board) also opens with **administrator access** (`board-access.guard.ts`). Thus, for an account with student membership type and administrator access that has not applied, ② disappears and ③ remains; combining both under one condition would remove the route to an accessible screen |

`ProgramScopeSidebar` renders the panel; `programScopeSidebarGroups()` assembles the groups.
The list root (`/programs`) retains the existing status-facet panel; only `/programs/:id/*` switches to this scoped panel.

The deadline area is a status summary specific to the program-scoped panel.
When at least one deadline remains, show the nearest deadline's name first, followed by four day/hour/minute/second cells and its absolute Seoul time (`YYYY.MM.DD (요일) HH:mm`).
The following list includes only remaining deadlines in the form `이름 — YYYY.MM.DD HH:mm` (Name—date/time).
Truncate long names, keeping the separator/date/time unwrapped and unclipped.
Keep the current time as supporting information as before, but prioritize the deadline name, remaining time, and absolute time in the visual hierarchy.

This contract is separate from the rankings left panel's single `다음 수집까지` (Until next collection) countdown.
Rankings retain the existing single-deadline mode, wording, and visibility conditions, without a list of remaining deadlines or end notice.
Below 900px, the desktop left panel remains hidden as before; do not add a mobile-only deadline card.
Use the daker.ai reference screen only for structural comparison; in the public repository and PRs, keep only its URL without copying images, colors, or copy.

#### Per-document milestone collection summary

`/programs/:id/milestones/:id/documents` shows a per-document summary above the existing team×document table.
Submitted/not-submitted totals and quick-filter counts in the summary use all approved teams regardless of the current page or filters, using the server's `documentTotals`.
Show document and submission-status selections through the pressed states of `FilterChipGroup`/`FilterChip`, alongside text showing the selected document name and whether it is required or optional.
A missing submission for the selected document does not change required-document submission status; distinguish “submitted” in the summary from review approval.
Apply the selected document's submission status together with the existing quick filter, resetting to the first page when conditions change.
Retain the team×document table, inline review, history, downloads, and pagination; “모든 서류 보기” (View all documents) restores the full table.
On narrow screens, wrap document names and figures in summary rows; only the existing table scrolls horizontally.

#### Document status table

This is the information structure of the faculty/staff and administrator document-status matrix.

**QA49 change**—previously, cells collapsed to three states, `제출함` / `지각` / `미제출` (Submitted / Late / Not submitted), merging approved, changes requested, and rejected into `제출함` and hiding the actual review state.
The screen must answer both “Was it submitted?” and “What is the latest decision?”, so cells now distinguish the latest review status directly.

| Category | Convention |
| --- | --- |
| 6 cell states | `미제출` / `검토 대기` / `지각 제출` / `승인` / `보완 요청` / `반려` (Not submitted / Awaiting review / Late submission / Approved / Changes requested / Rejected) |
| Blank cell | A cell without a value means `미제출` (Not submitted) |
| 4 statistics | Document cells · Empty cells · Teams that have submitted nothing · Late submissions |
| 3 quick filters | All · Teams with empty cells · Teams that have submitted nothing. Milestone tabs are separate |
| Row entry | Enter the corresponding submission review screen from the row |

**Label mapping**—the code source is `MATRIX_CELL_DISPLAY_LABELS` and `isLateSubmission()` in `apps/frontend/src/features/submissions/matrix.ts`.
Screen labels reflect the persisted status enum but do not directly use code strings (such as `제출 전`, Before submission).

| Code (`MatrixCellStatus` / review decision) | Display |
| --- | --- |
| `NOT_SUBMITTED` | `미제출` (Not submitted; same as a blank cell) |
| `SUBMITTED` (submitted before the deadline) | `검토 대기` (Awaiting review) |
| `SUBMITTED` + `isLateSubmission(cell, milestone) === true` | `지각 제출` (Late submission) |
| `APPROVED` | `승인` (Approved) |
| `CHANGES_REQUESTED` | `보완 요청` (Changes requested) |
| `REJECTED` | `반려` (Rejected) |

Lateness applies only to pre-review (`SUBMITTED`) cells.
`isLateSubmission()` is true when `submittedAt > milestone.dueAt`; already reviewed approved/changes-requested/rejected cells display only the decision, without adding lateness again.
To check submission time, enter through “열어 보기” (Open) in the row.
The student screen's `내 제출물` (My submissions) presents the same submission data from a personal perspective and need not duplicate the faculty/staff matrix's display.

#### Board

This specifies only the information structure of the program-scoped board; grid/card dimensions belong to screen implementation.

| Item | Decision |
| --- | --- |
| List | Show announcements and questions together in **one list** |
| Body/comments | Opening a post expands comments in the same place |
| Role tag | Add the author's role tag to comments |

#### Participating teams

This defines the visibility scope of participating teams within a program.

| Item | Decision |
| --- | --- |
| Public | Make only team composition and member count public |
| Team leader | Identify the team leader |
| Repository | Team repositories are private (do not expose them on this screen) |

### Missing-address and render-failure screens

The service directly handles the two cases where the route tree cannot provide a screen (#1103).
`app/not-found.tsx` handles every address absent from the route tree; `app/error.tsx` handles routes throwing during rendering; both use the single `RouteNotice` structure from `app/_shell/route-notice.tsx`.
Without these files, the framework's default English screens appear inside the `<html lang="ko">` shell.

| Item | Decision |
| --- | --- |
| Structure | Use the same dimensions as the three comparable full-screen notices (`access-denied.tsx`, `login-required-notice.tsx`, `session-error.tsx`): centered `min-h-[50svh]`, `text-lg font-semibold` heading, one `max-w-md break-keep text-sm text-muted-foreground` paragraph, `min-h-11` buttons |
| Illustration | None. All three notices above use text only, and 40 of 53 `EmptyState` locations have no icon (complete check on 2026-09-04); an illustration here alone would be inconsistent |
| Missing-address destinations | Two: `프로그램 목록으로` (Go to program list) (`/programs`, primary action) and `이전 화면` (Previous screen) (`router.back()`). Do not use `/dashboard`: its body varies by role, so it would push someone who merely followed a wrong address into their role screen |
| Render-failure destinations | `다시 시도` (Retry; Next's `reset`, primary action) and `프로그램 목록으로` (Go to program list). Provide both parts of R-10's “retry or an alternative route” |
| Numbers | Do not display `404` or an error digest prominently as a title; leave them only as one `text-xs text-muted-foreground` line below the body. They are clues for developers/support, not students |
| Accent color | Only one primary action uses `default` (navy); the rest use `outline`. Do not introduce new colors |
| Live region | None. R-12 permits `role="alert"` only for dynamic errors during interaction; these are initial render contents of the route |
| Exception messages | Do not put `error.message` on the screen. Production builds have Next strip it, leaving only the digest; development builds expose internal implementation details in English |

Scope is limited to these two cases; loading screens (`loading.tsx`) and errors thrown by the root layout itself (`global-error.tsx`) are outside this decision.

Addresses such as `/programs/:id`, where **the route exists but data is missing**, do not reach these screens.
Each screen already handles those with its own wording (`프로그램을 찾을 수 없습니다`, Program not found, in `ProgramDetailFailureState`).
