<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-30 -->

# .design-sync/ — claude.ai/design 번들 빌드 도구

## Purpose

`apps/frontend`를 디자인 시스템 라이브러리처럼 claude.ai/design에 올리기 위한 변환 도구와 프리뷰 소스를 둔다.
대상 프로젝트 설정은 `config.json`이 소유한다.
빌드·re-sync 절차는 `NOTES.md`, 디자인 클래스 어휘는 `conventions.md`가 원본이다.
이 파일은 커밋 대상과 생성 산출물의 경계만 안내한다.

## Key Files

| 경로 | 역할 |
| --- | --- |
| `config.json` | converter 설정 — `srcDir`, guidelinesGlob, `dtsPropsFor`, `overrides` |
| `emit-types.mjs` | 빌드 전 컴포넌트 prop 계약(`.d.ts`) 생성 |
| `compile-css.mjs` | 빌드 전 필수 — Tailwind v4 정적 컴파일 |
| `css/ds-entry.css` | Tailwind 컴파일 진입점(커밋 대상, `source(none)` 경계 포함) |
| `previews/*.tsx` | 사람이 쓴 프리뷰 소스(커밋 대상, 산출물 아님) |
| `conventions.md` | 디자인 에이전트용 클래스 어휘·조합 관례 원본 |
| `NOTES.md` | 빌드 순서·환경·re-sync 위험·실패 사례 원본 |
| `tsconfig.dts.json` | `.d.ts` emit 전용 tsconfig |

## For AI Agents

- `config.json`·도구 스크립트·`css/ds-entry.css`·`previews/*.tsx`·두 원본 문서는 커밋 대상이다.
- `apps/frontend/node_modules/frontend` self-link, `apps/frontend/ds-types/**`, `apps/frontend/index.d.ts`, `apps/frontend/.ds-css/**`, `ds-bundle/`는 gitignore 대상 생성물이다.
- 생성물을 직접 편집하거나 커밋하지 않고 `NOTES.md`의 순서로 다시 만든다.
- `previews/*.tsx`는 사람이 편집하는 소스이며 포맷·채점 계약은 `NOTES.md`를 따른다.
- 프리뷰에 이름을 쓸 때는 루트 `AGENTS.md` §6 public-safe 경계를 그대로 적용한다 — 가공 인물임이 자명한 플레이스홀더(`홍길동`)만 쓰고 실명형 이름은 쓰지 않는다.
- 프리뷰 클래스와 금지 import는 `conventions.md`와 `NOTES.md`의 현재 계약을 따른다.

## Dependencies

- [루트 AGENTS.md](../AGENTS.md) — public-safe 경계(§6), 작성권(§3)
- [NOTES.md](NOTES.md) — 빌드 순서·환경·re-sync 위험의 원본.
- [conventions.md](conventions.md) — 클래스 어휘·조합 패턴 원본.
- [docs/design.md](../docs/design.md) — 색상·타이포그래피·토큰 계층 계약(`config.json`의 guidelinesGlob)
- [docs/rules/frontend.md](../docs/rules/frontend.md) — frontend 구조 계약(`config.json`의 guidelinesGlob)
