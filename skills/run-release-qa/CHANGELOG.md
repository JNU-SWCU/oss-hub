# Changelog

- 2026-09-01 — v1.0.0: 스킬이 `.claude/skills/` 아래에만 실 파일로 존재해 Codex·GJC·Cursor가 로드하지 못했고 시나리오 목록은 실행 계획 문서 경로에 있어 별도 정리 대상에 걸렸다 → `skills/run-release-qa/`를 세 runtime 공용 단일 원본으로 삼아 옮기고 시나리오 목록을 `references/qa-scenarios.md`로 이동했으며 버전을 추가했다. Provenance: 2026-09-01 운영자 요청 — repo 스킬을 세 runtime 공용으로 패키징하고 실행 계획 문서 경로를 제거할 것.
