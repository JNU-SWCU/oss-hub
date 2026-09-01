# Changelog

- 2026-09-01 — v1.0.0: PR 제출 전 실행 절차가 `manage-qa-tickets/references/execution-workflow.md`에 갇혀 있어 티켓 없이 이미 구현된 변경을 PR로 낼 때도 그 스킬 전체를 거쳐야 했고, backend 로직 변경은 frontend와 달리 어떤 증거도 요구받지 않았다 → 계약 파싱·구현·완료 조건 실증·PR 흐름을 `submit-pr-evidence`로 독립시키고, 기존 frontend Before/After 캡처 게이트 옆에 backend 로직 변경용 mermaid·DOT 흐름 다이어그램 게이트를 새로 추가했다. Provenance: 2026-09-01 운영자 요청 — PR 제출 전 스킬을 독립시키고 backend 로직 변경에 mermaid/DOT 다이어그램을 요구할 것.
