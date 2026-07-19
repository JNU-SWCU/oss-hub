<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-20 -->

# apps/ — 컨테이너

## Purpose

`backend/`(NestJS API)와 `frontend/`(Next.js 앱) 두 워크스페이스 패키지의 컨테이너 디렉터리다. 이 디렉터리 자체에는 코드가 없다 — 각 앱의 실제 규칙은 하위 `AGENTS.md`가 원본이다.

## Key Files

없음 — 이 디렉터리에는 파일이 없고 두 앱 디렉터리만 있다.

## Subdirectories

| 경로 | 내용 | 문서 |
| --- | --- | --- |
| `backend/` | NestJS 백엔드 API | [apps/backend/AGENTS.md](backend/AGENTS.md) |
| `frontend/` | Next.js 프런트엔드 | [apps/frontend/AGENTS.md](frontend/AGENTS.md) |

## For AI Agents

- 이 레벨에서 직접 할 작업은 없다 — `backend/` 또는 `frontend/` 하위 `AGENTS.md`로 이동해 작업한다.
- 두 앱은 pnpm workspace로 묶여 있다. 루트에서 `pnpm -r <script>`를 실행하면 두 앱에 동시 적용된다(`package.json` 참조).

## Dependencies

- [루트 AGENTS.md](../AGENTS.md) — 세션 부트스트랩·작성권·커밋 규칙 원본.
