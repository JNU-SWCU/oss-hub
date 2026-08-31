<!-- init:managed id=craft-init-4.0.0-design-sync sha256=5fae1ebcfffa584e270fd58c51d318c02463d45ebdb9e79dac390f75e5b1a1d8 -->
# .design-sync

## Ownership

- `.design-sync/` owns the design-package converter configuration, generated-contract inputs, CSS entry point, and hand-authored component previews for `apps/frontend`.
- `config.json` is the converter configuration source; keep its frontend package, source directory, CSS entry, guideline paths, declaration overrides, and component overrides coherent.
- `conventions.md` owns design-agent class vocabulary and composition conventions; `NOTES.md` owns the build and re-sync procedure.

## Source and generated boundaries

- Commit `config.json`, `emit-types.mjs`, `compile-css.mjs`, `css/ds-entry.css`, `previews/*.tsx`, `conventions.md`, `NOTES.md`, and `tsconfig.dts.json`.
- Do not directly edit or commit `apps/frontend/ds-types/**`, `apps/frontend/index.d.ts`, `apps/frontend/.ds-css/**`, `apps/frontend/node_modules/frontend`, or `ds-bundle/`; regenerate them through the documented process.
- `emit-types.mjs` produces component prop declarations before packaging; keep `config.json` `dtsPropsFor` aligned with any deliberate extraction exception.
- `compile-css.mjs` produces the design CSS before packaging; retain `source(none)` in `css/ds-entry.css` so Tailwind scans only the explicit frontend source boundary.
- Preview source is human-authored input, not disposable build output; preserve its component import and class constraints from `conventions.md`.

## High-risk constraints

- Do not change `config.json` `projectId`, package identity, or source scope incidentally; those select the remote design project and converter surface.
- Preserve the documented build order in `NOTES.md`: self-link, declaration emission, CSS compilation, then package conversion.
- Format previews before rebuild/capture because preview source bytes participate in synchronization hashes.
- Public-safety rules apply to previews and any uploaded bundle input: use only clearly fictional placeholders and never add credentials, host paths, real personal data, or production content.
- Keep frontend design policy in `../docs/design.md` and frontend structural policy in `../docs/rules/frontend.md`; do not duplicate either here.

## Important paths

- `config.json` — converter package and guideline configuration.
- `emit-types.mjs` — `.d.ts` generation entry point.
- `compile-css.mjs` and `css/ds-entry.css` — Tailwind compilation contract.
- `previews/` — committed component preview sources.
- `NOTES.md` — exact re-sync sequence and failure boundaries.
- `conventions.md` — allowed design classes and preview composition rules.
<!-- /init:managed id=craft-init-4.0.0-design-sync -->
