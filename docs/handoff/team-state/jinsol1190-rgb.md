# @jinsol1190-rgb 저널

작성자 저널이다. 새 항목은 파일 끝에만 붙인다. 규칙은 루트 AGENTS.md §3이 원본이다.

## 2026-08-28 — QA115 프로그램 안내 접이식 전환
## 2026-08-27 — QA112 시스템 상태 경로 이동

- 상태: review
- Issue: -
- PR: (이 PR)
- blocker: 없음
- 결과: 공용 Collapsible primitive를 추가하고 교직원 프로그램 상세의 `프로그램 안내`를 기본 접힘으로 바꿨다. 섹션 순서와 마일스톤 내부, 안내 문구, 편집·API·schema·권한 경계는 변경하지 않았다.
- 검증: 합성 STAFF fixture로 1000×768·390px 실제 브라우저에서 기본 접힘, 44px 터치 높이, Tab·Enter·Space, ARIA 연결, 새로고침·프로그램 이동 초기화, 빈 안내 미렌더링, 첫 마일스톤 첫 화면 노출을 확인했다. 집중 테스트·typecheck·lint·public-safe와 독립 code·QA·visual·gate review를 통과했다.
- 공개 안전성: 제3자 캡처와 실데이터를 포함하지 않았고 공개 PR에는 합성 검증 결과만 요약한다.
