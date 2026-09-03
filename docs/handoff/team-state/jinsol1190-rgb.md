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

## 2026-08-29 — QA108 랜딩 푸터 개인정보 안내 공개 연결

- 상태: review
- Issue: #1052
- PR: pending
- blocker: 없음
- 결과: 랜딩 푸터의 `개인정보 수집·이용` 링크를 현행 공개 정책 문서로 연결했다. 로그인 사용자의 `/consent` 동의 흐름과 정책 문구·버전은 변경하지 않았다.
- 검증: 집중 테스트 17/17, Linux 전체 테스트 306파일·3042건, typecheck·lint, Linux Docker builder, 익명 Chrome 포인터·키보드 2/2, public-safe를 통과했다.
- 환경 참고: Windows 전체 테스트의 확장자 없는 `pnpm` 실행·음수 프로세스 그룹 신호 제약과 native build의 standalone symlink `EPERM`은 환경 잔여로 원문 증거에 남겼고, 대응 Linux 검증은 통과했다.
- 공개 안전성: 익명·합성 상태만 사용했으며 병합·배포는 수행하지 않는다. 배포 환경 재확인은 병합·배포 후 남은 운영 확인이다.

## 2026-09-03 — Issue #1132 PR 리뷰 반영

- 상태: review
- Issue: #1132
- PR: #1171
- blocker: 없음
- 결과: 신청 제목 제거 뒤 남아 있던 교직원 목록·상세·판정 창의 제목 노출을 없앴다. 팀 생성·참여 코드 합류 뒤 신청서 단계가 다시 팀 단계로 돌아가던 순서를 바로잡았고, 마지막 팀원 탈퇴 시 남은 초대 기록을 팀보다 먼저 정리한다. 사용자 화면의 내부 저장 구조 표현 `1인 팀`은 `팀 없이 계속`으로 바꿨다.
- 검증: 변경 범위 backend 3/3, frontend 78/78 테스트와 lint·typecheck·prettier를 통과했다. 합성 student/staff local-review fixture로 1280×720·390×844 실제 브라우저에서 팀→신청서 전환, 신청자 목록·상세·승인 창의 제목 미노출, CJK 레이아웃을 확인했다.
- 환경 참고: Windows 전체 frontend에서 무변경 `card-grid.geometry-runtime.test.mjs` 4건이 확장자 없는 `pnpm` 실행과 프로세스 신호 제약으로 재현됐고, production standalone 복사는 symlink `EPERM`으로 멈췄다. 제품 번들 컴파일·타입 검사·정적 페이지 생성은 그 전 단계까지 통과했다.
- 공개 안전성: 합성 fixture만 사용했고 캡처는 브랜치에 커밋하지 않고 PR 첨부로 이전한다.

## 2026-09-04 — Issue #1132 병합 후 리뷰 보완

- 상태: review
- Issue: #1132
- PR: pending
- blocker: 작성자 UX 인터뷰 답변 대기
- 결과: 병합 뒤 남은 리뷰 3건을 후속 변경으로 분리했다. 동시 팀 탈퇴를 팀 행 잠금으로 직렬화하고, frontend가 먼저 배포돼 구버전 양식을 받는 동안에는 화면에서 제목을 숨기되 호환 제목을 전송한다. 신청 wizard 안의 중첩 `main`과 중복 페이지 제목도 제거했다.
- 검증: backend 16/16, frontend 44/44 집중 테스트와 양쪽 typecheck·lint·backend build를 통과했다. 합성 student fixture의 동일 URL·viewport에서 Before/After를 다시 촬영했고, After는 desktop·390×844 모두 `main` 1개·`h1` 1개·제목 입력 0개·가로 overflow 0을 확인했다. frontend build는 번들·타입·정적 페이지 26/26 뒤 Windows symlink `EPERM`에서만 멈췄다.
- 공개 안전성: 캡처는 합성 fixture만 사용하고 저장소 밖 임시 경로에 두었으며, 후속 PR에는 GitHub attachment로만 첨부한다.

## 2026-09-04 — Issue #1132 후속 보안·모바일 게이트 반영

- 상태: review
- Issue: #1132
- PR: pending
- blocker: 작성자 UX 인터뷰 답변 대기
- 결과: 팀 탈퇴와 신청 제출이 교차해 기존 팀이 잠금 전에 사라진 경우를 `APP_017`로 처리해 원시 FK 오류를 막았다. 390×844에서 신청서 안내 문장이 의미 단위로 읽히도록 문구도 줄였다.
- 검증: applications·program teams 집중 테스트 50/50, frontend 집중 테스트 44/44, 양쪽 typecheck와 변경 파일 lint를 통과했다. 합성 student fixture에서 모바일 안내 줄바꿈과 `main` 1개·`h1` 1개·가로 overflow 0을 다시 확인했다.
- 공개 안전성: 추가 캡처도 합성 fixture만 사용했고 제품 브랜치에는 포함하지 않는다.

## 2026-09-04 — Issue #1132 멤버십 재검증 보완

- 상태: review
- Issue: #1132
- PR: pending
- blocker: 작성자 UX 인터뷰 답변 대기
- 결과: 신청 트랜잭션이 기존 팀을 잠근 뒤 학생의 현재 프로그램 팀 멤버십을 다시 확인한다. 동시 탈퇴 뒤 팀이 남아도 오래된 팀 ID로 신청하지 않고 `APP_014`로 거절한다.
- 검증: applications·program teams 집중 테스트 51/51, backend typecheck와 변경 파일 lint를 통과했다. 기존 team-invitation/application 잠금 통합 테스트 호출부도 새 잠금 계약에 맞췄다.
- 공개 안전성: 공개 표면에 추가된 실데이터·개인정보·로컬 경로가 없다.
