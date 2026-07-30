<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-30 · Updated: 2026-07-31 (volatile 서비스 수 제거) -->

# apps/backend/src/programs — 프로그램·마일스톤·팀

## Purpose

프로그램 CRUD, 마일스톤, 팀 구성, 역할별 상세 조회, 활동 타임라인을 담는 가장 큰 모듈이다.
서비스가 책임별로 나뉘어 있으므로 새 기능은 해당 책임의 서비스에 둔다.

## Key Files

| 파일 | 역할 |
| --- | --- |
| `programs.service.ts` | 공개 목록(`list`)·상세(`detail`) — 뷰어 역할(STUDENT/STAFF/ADMIN/익명)별로 다른 필드를 계산 |
| `program-creation.service.ts` | 프로그램 생성(교직원 전용) |
| `program-editor.service.ts` | 프로그램 수정·마일스톤 upsert — 신청자 존재 시 category 잠금 등 편집 불변식 담당 |
| `program-viewer.service.ts` | githubId→뷰어 컨텍스트(role/userId) 변환 — 여러 컨트롤러가 공유 |
| `program-activity.service.ts` | 프로그램 활동 타임라인·학생 대시보드 활동 조회 |
| `student-dashboard.service.ts` | 학생 대시보드 요약 |
| `program-teams.service.ts` | 팀 생성·참여코드 합류·내 팀 조회 |
| `program-template.registry.ts` | `ProgramCategory`→신청 양식 템플릿(v1, 서버가 SSOT) 매핑 — 신청 필드 정의의 유일한 원본 |
| `program-deadline.ts` | D-day 계산 공용 유틸 |
| `program-error-code.enum.ts` / `teams-error-code.enum.ts` | `PRG_*`/`TEAM_*` 코드 레지스트리 — 팀 관련 에러만 별도 prefix로 분리돼 있다 |

## Subdirectories

| 경로 | 내용 |
| --- | --- |
| `dto/` | 프로그램·팀·마일스톤·활동타임라인 요청/응답 DTO |

## For AI Agents

- 서비스 분리 기준: 조회(`programs`/`program-viewer`/`program-activity`/`student-dashboard`)와 쓰기(`program-creation`/`program-editor`/`program-teams`)가 나뉜다 — 새 엔드포인트가 어느 쪽인지 먼저 판단하고 해당 서비스에 추가한다.
- `programs.controller.ts`는 `ApplicationTemplatesController`가 라우팅에서 `programs/:id`보다 먼저 등록돼야 한다(`programs.module.ts` 주석 참조) — static sibling 경로 우선순위 규칙이다.
- 팀형 프로그램 여부는 이 모듈이 `PROGRAM_TEMPLATES`(`program-template.registry.ts`)로 소유한다 — `applications/` 모듈은 `getProgramTemplate()`만 호출하고 규칙을 재구현하지 않는다.
- 에러 코드가 두 enum(`PRG_*`/`TEAM_*`)으로 나뉜 것은 팀 도메인이 별도 실패 유형(정원 초과·참여코드 등)을 갖기 때문이다 — 새 팀 관련 에러는 `TEAM_*`에, 그 외 프로그램·마일스톤 에러는 `PRG_*`에 추가한다.

## Dependencies

- [apps/backend/src/AGENTS.md](../AGENTS.md) — 모듈 경계·에러 코드 규약.
- `auth/`(`AuthModule`).
