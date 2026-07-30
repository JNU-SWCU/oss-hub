<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-30 · Updated: 2026-07-31 (상위 문서와의 중복·volatile 수치 제거) -->

# apps/frontend/src/features — 기능 단위 폴더

## Purpose

화면·업무 기능 단위 폴더 모음이다.
폴더 규약은 [features/README.md](README.md)와 [docs/rules/frontend.md](../../../../docs/rules/frontend.md)가 원본이다.
이 문서는 상위 문서가 다루지 않는 실제 폴더 내부 패턴만 기록한다.

## Key Files

폴더마다 반복되는 파일 역할(전부 필수는 아니다 — 아래 For AI Agents의 판단 기준을 따른다).

| 파일 | 역할 |
| --- | --- |
| `types.ts` | 백엔드 응답 계약을 미러링한 타입 |
| `components/` | `*-screen.tsx`(데이터 로딩) + `*-view.tsx`(표현) |
| `<주제>.ts` | 순수 로직(상태 전이·검증·포맷) — 컴포넌트 밖으로 뺀 테스트 대상 |
| `index.ts` | 선택적 배럴 — 일부 폴더만 두고 있고, 나머지는 `app/`이 깊은 경로를 직접 import한다 |
| `*.test.ts(x)` | Vitest, 대상 파일 곁 |

## Subdirectories

| 경로 | 문서 |
| --- | --- |
| `programs/` | [programs/AGENTS.md](programs/AGENTS.md) — 가장 큰 feature, 별도 규약 있음 |
| `auth/` | @Lumiere001 전속 경로(루트 AGENTS.md §3) — 직접 수정하지 않고 Issue·PR 코멘트로 제안 |
| 그 외 | 이 문서의 규약을 그대로 따른다 |

## For AI Agents

- **Screen / View 분리가 이 레벨의 우세한 패턴이다.** 데이터 로딩 screen과 props 기반 view가 이미 분리된 폴더에서는 그 경계를 유지한다.
- 이전 형태의 view가 직접 로딩하는 예외를 새 화면의 선례로 삼지 않는다.
- 상태 전이·필터·검증은 컴포넌트 밖의 순수 모듈로 두고 인접 단위 테스트로 검증한다.
- DOM 렌더 테스트는 순수 로직 위의 조합만 확인한다.
- 브라우저 API에 붙는 로직은 의존성 주입 가능한 순수 모듈과 실제 `'use client'` 훅으로 나눈다.
- `window`를 직접 참조하는 업무 로직을 컴포넌트 안에 두지 않는다.
- 배럴이 없는 feature에 `index.ts`를 관성으로 추가하지 않는다.
- 이미 배럴이 있는 폴더는 기존 진입점에 export를 추가한다.
- 목 데이터와 테스트 시나리오는 fixture 모듈에 두고 컴포넌트 안에 인라인하지 않는다.
- API 연결 뒤에도 테스트가 소비하는 fixture는 유지하고 런타임 전용 placeholder만 소비자가 없어졌을 때 삭제한다.

## Dependencies

- [apps/frontend/src/AGENTS.md](../AGENTS.md), [apps/frontend/AGENTS.md](../../AGENTS.md) — 의존 방향·단일 API 클라이언트·feature 경계 lint 원본.
- [features/README.md](README.md) — 폴더 규약 원본.
- [docs/rules/frontend.md](../../../../docs/rules/frontend.md) — 의존 방향·단일 API 클라이언트 규칙 원본.
- `lib/api-client.ts`(`apiClient`·`ApiError`), `components/`(공유 UI), `@/components/ui/*`(프리미티브).
