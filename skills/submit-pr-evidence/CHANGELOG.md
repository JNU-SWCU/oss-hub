# Changelog

- 2026-09-02 — v1.1.0: PR 본문이 증거는 갖췄어도 "무엇을 고쳤다" 식 구현 언어로 쓰여 리뷰어가 읽기 힘들었다 → `## 증거 게이트`와 `## PR을 연다` 사이에 `## PR 본문 작성 원칙` 절을 추가해 페르소나 언어 요약, 사람이 확인한 행동 중심 검증 서술, 로컬 환경 잡음 배제(단 실행 못 한 검증은 예외), 중첩 불릿·클릭 가능한 파일 링크·정합된 섹션 번호, 미첨부 placeholder 금지를 규정하고 완료 체크리스트에 두 항목을 추가했다. Provenance: PM이 PR #1058 본문을 읽고 가독성 문제를 지적 — 재발 방지를 위해 스킬 규칙으로 명문화 요청.
- 2026-09-01 — v1.0.0: PR 제출 전 실행 절차가 `manage-qa-tickets/references/execution-workflow.md`에 갇혀 있어 티켓 없이 이미 구현된 변경을 PR로 낼 때도 그 스킬 전체를 거쳐야 했고, backend 로직 변경은 frontend와 달리 어떤 증거도 요구받지 않았다 → 계약 파싱·구현·완료 조건 실증·PR 흐름을 `submit-pr-evidence`로 독립시키고, 기존 frontend Before/After 캡처 게이트 옆에 backend 로직 변경용 mermaid·DOT 흐름 다이어그램 게이트를 새로 추가했다. Provenance: 2026-09-01 운영자 요청 — PR 제출 전 스킬을 독립시키고 backend 로직 변경에 mermaid/DOT 다이어그램을 요구할 것.
