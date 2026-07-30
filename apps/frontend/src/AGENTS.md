<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-20 · Updated: 2026-07-31 (features 하위 문서 라우팅) -->

# apps/frontend/src — 컨테이너

## Purpose

`app/`·`features/`·`components/`·`lib/` 네 계층의 컨테이너다.
의존 방향은 `app → features → lib`이며 `components/`는 공유 UI다.

## Key Files

없음 — 이 디렉터리에는 파일이 없고 4개 하위 디렉터리만 있다.

## Subdirectories

| 경로 | 내용 | 문서 |
| --- | --- | --- |
| `app/` | Next.js App Router 라우트 골격 | [app/AGENTS.md](app/AGENTS.md) |
| `features/` | 기능 단위 폴더(컴포넌트·hooks·상태·타입·테스트 동봉) | [features/AGENTS.md](features/AGENTS.md) — 내부 구조, `auth/` 작성권은 루트 §3 |
| `components/` | 여러 feature가 공유하는 UI | [components/AGENTS.md](components/AGENTS.md) |
| `lib/` | 공유 유틸리티(단일 API 클라이언트 등) | [lib/AGENTS.md](lib/AGENTS.md) |

## For AI Agents

- 새 화면은 `app/` 라우트에서 `features/` 기능을 조합한다.
- feature 내부 로직을 `app/`에 직접 구현하지 않는다.
- `features/*`끼리는 직접 의존하지 않는다 — 공유가 필요하면 `components/`나 `lib/`로 명시적으로 추출한다.

## Dependencies

- [apps/frontend/AGENTS.md](../AGENTS.md)
- [Frontend 구현 규칙](../../../docs/rules/frontend.md)
