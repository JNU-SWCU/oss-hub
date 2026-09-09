# @jinsol1190-rgb 저널

작성자 저널이다. 새 항목은 파일 끝에만 붙인다. 규칙은 루트 AGENTS.md §3이 원본이다.

## 2026-08-27 — QA112 시스템 상태 경로 이동

- 상태: review
- Issue: -
- PR: (이 PR)
- blocker: 없음

## 2026-08-28 — QA115 프로그램 안내 접이식 전환

- 상태: review
- Issue: -
- PR: (이 PR)
- blocker: 없음
- 결과: 공용 Collapsible primitive를 추가하고 교직원 프로그램 상세의 `프로그램 안내`를 기본 접힘으로 바꿨다. 섹션 순서와 마일스톤 내부, 안내 문구, 편집·API·schema·권한 경계는 변경하지 않았다.
- 검증: 합성 STAFF fixture로 1000×768·390px 실제 브라우저에서 기본 접힘, 44px 터치 높이, Tab·Enter·Space, ARIA 연결, 새로고침·프로그램 이동 초기화, 빈 안내 미렌더링, 첫 마일스톤 첫 화면 노출을 확인했다. 집중 테스트·typecheck·lint·public-safe와 독립 code·QA·visual·gate review를 통과했다.
- 공개 안전성: 제3자 캡처와 실데이터를 포함하지 않았고 공개 PR에는 합성 검증 결과만 요약한다.

## 2026-08-29 — QA116 프로그램 좌측 패널 마감 일정 표시

- 상태: review
- Issue: -
- PR: [#1057](https://github.com/JNU-SWCU/oss-hub/pull/1057)
- blocker: 없음
- 결과: 프로그램 개요 응답을 남은 마감 목록 계약으로 넓히고, 좌측 패널에 가장 가까운 마감의 4칸 카운트다운·서울 기준 절대 시각·남은 마감 목록·종료 안내를 추가했다. 랭킹 단일 카운트다운과 900px 미만 동작은 유지했다.
- 검증: 프런트 집중 99개, 백엔드 집중 15개, 양쪽 typecheck, 변경 파일 lint·Prettier를 통과했다. 합성 STAFF·STUDENT fixture와 실제 Chromium으로 1280·1000·900·899·768·390px, 종료 안내·마감 롤오버·랭킹 제어군을 확인했다.
- 공개 안전성: GitHub `public-safe`와 `commitlint`가 통과했고 제3자 캡처·실데이터·개인정보를 포함하지 않았다. Windows 로컬 public-safe timeout과 full pre-push 포맷 훅의 기존 repo-wide 경고는 PR에 기록했으며 GitHub `ci`를 최종 기준으로 삼는다.
## 2026-08-29 — QA108 랜딩 푸터 개인정보 안내 공개 연결

- 상태: review
- Issue: #1052
- PR: pending
- blocker: 없음
- 결과: 랜딩 푸터의 `개인정보 수집·이용` 링크를 현행 공개 정책 문서로 연결했다. 로그인 사용자의 `/consent` 동의 흐름과 정책 문구·버전은 변경하지 않았다.
- 검증: 집중 테스트 17/17, Linux 전체 테스트 306파일·3042건, typecheck·lint, Linux Docker builder, 익명 Chrome 포인터·키보드 2/2, public-safe를 통과했다.
- 환경 참고: Windows 전체 테스트의 확장자 없는 `pnpm` 실행·음수 프로세스 그룹 신호 제약과 native build의 standalone symlink `EPERM`은 환경 잔여로 원문 증거에 남겼고, 대응 Linux 검증은 통과했다.
- 공개 안전성: 익명·합성 상태만 사용했으며 병합·배포는 수행하지 않는다. 배포 환경 재확인은 병합·배포 후 남은 운영 확인이다.

## 2026-09-03 — QA116 최신 main 반영과 리뷰 후속 조치

- 상태: review
- Issue: [#1051](https://github.com/JNU-SWCU/oss-hub/issues/1051)
- PR: [#1057](https://github.com/JNU-SWCU/oss-hub/pull/1057)
- blocker: PR 본문에 실제 Before/After 캡처를 GitHub 웹 편집기로 첨부해야 한다.
- 결과: 최신 `main`을 병합하고 잘못된 마감 시각 오류를 좌측 마감 블록 안에 격리했다. 마감 정보를 현재 시각보다 먼저 배치했으며 동일 시각 마감은 `id` 보조 정렬로 순서를 고정했다.
- 검증: 프런트 집중 47개와 백엔드 집중 19개, 양쪽 typecheck·lint, 백엔드 build, 변경 범위 Prettier·public-safe를 통과했다. 합성 STAFF·STUDENT fixture로 다중 마감·종료 상태·랭킹 제어군·900px·899px·390px을 실제 Chrome에서 확인했고 시각 QA 두 경로와 코드·보안 리뷰가 통과했다.
- 공개 안전성: 합성 fixture만 사용했고 시크릿·개인정보·제3자 캡처를 브랜치에 포함하지 않았다. 병합과 배포는 수행하지 않는다.
## 2026-09-03 — Issue #1132 PR 리뷰 반영

- 상태: review
- Issue: #1132
- PR: #1171
- blocker: 없음
- 결과: 신청 제목 제거 뒤 남아 있던 교직원 목록·상세·판정 창의 제목 노출을 없앴다. 팀 생성·참여 코드 합류 뒤 신청서 단계가 다시 팀 단계로 돌아가던 순서를 바로잡았고, 마지막 팀원 탈퇴 시 남은 초대 기록을 팀보다 먼저 정리한다. 사용자 화면의 내부 저장 구조 표현 `1인 팀`은 `팀 없이 계속`으로 바꿨다.
- 검증: 변경 범위 backend 3/3, frontend 78/78 테스트와 lint·typecheck·prettier를 통과했다. 합성 student/staff local-review fixture로 1280×720·390×844 실제 브라우저에서 팀→신청서 전환, 신청자 목록·상세·승인 창의 제목 미노출, CJK 레이아웃을 확인했다.
- 환경 참고: Windows 전체 frontend에서 무변경 `card-grid.geometry-runtime.test.mjs` 4건이 확장자 없는 `pnpm` 실행과 프로세스 신호 제약으로 재현됐고, production standalone 복사는 symlink `EPERM`으로 멈췄다. 제품 번들 컴파일·타입 검사·정적 페이지 생성은 그 전 단계까지 통과했다.
- 공개 안전성: 합성 fixture만 사용했고 캡처는 브랜치에 커밋하지 않고 PR 첨부로 이전한다.

## 2026-09-08 — QA148 회원가입 전화번호와 관리자 가입 일시

- 상태: review 준비
- Issue: #1131
- PR: pending
- blocker: PR 본문 작성 전 `submit-pr-evidence` 작성자 인터뷰 3답과 GitHub 렌더 첨부 URL이 필요하다.
- 결과: 학생 가입 마지막 단계에 전화번호 10~11자리 필수 입력을 추가하고 설정에서 자기 전화번호를 확인·수정할 수 있게 했다. 전화번호는 `User.phone` 정본으로만 저장하고, 감사 로그에는 `SET`·`REPLACED` 상태만 남긴다. 관리자 사용자 목록과 상세 계약에는 계정 `가입 일시`를 추가했고, 가입 신청 큐의 `요청 시각` 정렬은 분리해 유지했다. 필수 동의가 필요한 온보딩 흐름은 `/consent`로 이동하지 않고 현재 화면의 다이얼로그에서 완료되게 했다.
- 검증: migration/schema, backend phone/audit, admin createdAt, frontend phone/settings/department, consent dialog focused 테스트와 typecheck·lint를 통과했다. 합성 fixture 기반 Chrome에서 `/onboarding/profile`, `/settings`, `/onboarding/role`, `/dashboard/users`, `/dashboard/audit-logs`의 desktop·390px After 캡처와 public-safe PNG metadata 검사를 완료했다.
- 환경 참고: Docker Desktop이 응답하지 않아 migration DB integration 일부는 isolated spec 작성·compile·ledger 검증까지 확인했고, 실제 DB 적용은 후속 전체 integration 환경에서 재확인해야 한다. repository-wide `pnpm format:check`는 기존 전역 포맷 경고가 있어 변경 파일 기준 Prettier와 Prisma format으로 별도 확인했다.
- 공개 안전성: 합성 사용자·합성 번호 생성값만 사용했고 전화번호 원문은 audit metadata, 관리자 DTO, PR evidence 텍스트, 스크린샷에 싣지 않는다. evidence PNG는 브랜치에 커밋하지 않는다.
