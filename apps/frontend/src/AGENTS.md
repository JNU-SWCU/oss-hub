<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-20 -->

# apps/frontend/src — 컨테이너

## Purpose

`app/`(라우팅)·`features/`(기능 단위)·`components/`(공유 UI)·`lib/`(공유 유틸리티) 4개 계층의 컨테이너. 의존 방향은 `app → features → lib` 단방향이며, `components/`는 어느 계층에서든 참조 가능한 공유 UI다.

## Key Files

없음 — 이 디렉터리에는 파일이 없고 4개 하위 디렉터리만 있다.

## Subdirectories

| 경로 | 내용 | 문서 |
| --- | --- | --- |
| `app/` | Next.js App Router 라우트 골격 | [app/AGENTS.md](app/AGENTS.md) |
| `features/` | 기능 단위 폴더(컴포넌트·hooks·상태·타입·테스트 동봉) | [features/README.md](features/README.md) — 폴더 규약. `features/auth/`는 @Lumiere001 전속(루트 AGENTS.md §3) |
| `components/` | 여러 feature가 공유하는 UI | [components/AGENTS.md](components/AGENTS.md) |
| `lib/` | 공유 유틸리티(단일 API 클라이언트 등) | [lib/AGENTS.md](lib/AGENTS.md) |

## For AI Agents

- 새 화면은 `app/`에 라우트를 만들고 `features/`의 기능을 조합하는 방식으로 작성한다. `features/` 내부 로직을 `app/`에 직접 구현하지 않는다.
- `features/*`끼리는 직접 의존하지 않는다 — 공유가 필요하면 `components/`나 `lib/`로 명시적으로 추출한다.

## Dependencies

- [apps/frontend/AGENTS.md](../AGENTS.md)
- [Frontend 구현 규칙](../../../docs/rules/frontend.md)
