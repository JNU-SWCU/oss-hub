<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-30 · Updated: 2026-07-31 (상위 문서 중복 제거, 템플릿 원본 정정) -->

# apps/frontend/src/features/programs — 프로그램 기능

## Purpose

프로그램 목록, 상세, 신청, 팀 구성, 마일스톤, 운영자 생성 및 수정 화면을 함께 소유하는 가장 큰 feature다.
라우트 파일은 `src/app/`에 두고, 이 폴더는 화면 조합과 프로그램 업무 규칙을 제공한다.

## Key Files

| 파일 | 역할 |
| --- | --- |
| `api.ts` | 프로그램, 신청, 팀, 마일스톤 관련 endpoint 호출과 응답 변환 — `listApplicationTemplates`가 `programs/application-templates`에서 신청서 템플릿을 조회한다 |
| `types.ts` | 프로그램 상세, 신청서, 마일스톤, 운영 대시보드 타입 |
| `program-paths.ts` | 프로그램 상세, 신청, 팀 화면의 URL 생성 |
| `program-templates.ts` | 카테고리 라벨·로컬 기본 템플릿과 API 템플릿 필드를 병합하는 `mergeTemplateFieldsFromApi` |
| `program-list.ts` | 목록 상태와 필터 순수 로직 |
| `program-*flow.ts` | 신청, 생성, 팀 구성의 상태 전이와 오류 매핑 |
| `program-edit-*.ts` | 운영자 수정 화면의 상태, 검증, 오류 코드 |
| `form-renderer.tsx` | 신청서 템플릿을 읽기 및 입력 UI로 렌더링 |

## Subdirectories

| 경로 | 내용 |
| --- | --- |
| `components/` | 프로그램 상세에 결합되는 활동 그래프와 마일스톤 행 |

## For AI Agents

- 화면 함수는 로딩, 오류, 차단, 성공 상태를 명시적으로 렌더링한다.
- 신청 흐름은 기간 종료·중복 신청·팀 필요 오류를 `ApiError.problem.code`로 매핑한다.
- `*-flow.ts`, `program-list.ts`, `program-paths.ts`, `program-edit-state.ts`의 순수 로직은 컴포넌트와 분리하고 같은 폴더의 Vitest 단위 테스트를 함께 갱신한다(대상 파일 곁 `*.test.ts`/`*.test.tsx`).
- 생성 및 수정 폼의 날짜·팀 인원 검증은 flow 모듈에 둔다.
- 컴포넌트 안에서 같은 검증을 다시 구현하지 않는다.
- `use-program-exit-guard.ts`는 실제 브라우저 이벤트와 라우터를 순수 `program-exit-guard.ts`에 주입한다.
- 브라우저 전역을 순수 로직에 직접 넣지 않는다.
- 카테고리 변경은 `PROGRAM_CATEGORIES`와 템플릿 정의를 함께 갱신하고, 참여 유형은 `types.ts`의 `ApplicationFormTemplate['participation']` 계약을 따른다.
- 실제 필드 정의·버전은 백엔드가 SSOT이므로 로컬 폴백을 다른 방향으로 확장하지 않는다.
- 새 상태 분기를 추가할 때 먼저 순수 flow 테스트를 추가하고, 화면 테스트에서는 대표 상태의 렌더링과 링크만 확인한다.
- 이 폴더의 `components/`는 공유 UI 경로가 아니라 프로그램 전용 조합이다.
- 더 가까운 문서가 생기기 전까지 이 문서의 규칙을 적용한다.

## Dependencies

- [apps/frontend/src/features/AGENTS.md](../AGENTS.md)
- [apps/frontend/src/lib/AGENTS.md](../../lib/AGENTS.md)
- [apps/frontend/src/components/AGENTS.md](../../components/AGENTS.md)
