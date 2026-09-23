# Changelog

- 2026-09-23 — v1.2.0: 제품 QA 발견 목록의 SSOT를 Notion `🐞 QA 요청`으로 읽어, 티켓이 GitHub Issue로만 발급된 뒤에도 릴리스 QA가 옛 행을 원본으로 찾았다 → SSOT를 GitHub Issue(QA 티켓)로 바꾸고 기록 조회·범위 표·체크리스트에서 그 행 읽기를 걷었다. `## 6. Notion에 적을 때`는 티켓 작성이라 이 스킬에서 삭제했다. 승인 없이 Issue·PR을 바꾸지 않는 규칙은 그대로다. Provenance: 2026-09-23 운영자 요청 — 티켓 발급을 Notion 없이 GitHub Issue로만 한다.
- 2026-09-13 — v1.1.0: 범위를 report-only·recheck·delta·full 중 하나로 환경 준비와 레인 A–C보다 먼저 고른다. report-only는 있는 기록만 읽고 없는 출처를 `확인 필요`로 남기며 설치·기동·스위트·시나리오 준비를 하지 않는다. 전수 재실행은 명시 승인이 필요하다. 데이터·Issue·PR·Notion 무단 변이는 그대로 금지한다.
- 2026-09-01 — v1.0.0: 스킬이 `.claude/skills/` 아래에만 실 파일로 존재해 Codex·GJC·Cursor가 로드하지 못했고 시나리오 목록은 실행 계획 문서 경로에 있어 별도 정리 대상에 걸렸다 → `skills/run-release-qa/`를 세 runtime 공용 단일 원본으로 삼아 옮기고 시나리오 목록을 `references/qa-scenarios.md`로 이동했으며 버전을 추가했다. Provenance: 2026-09-01 운영자 요청 — repo 스킬을 세 runtime 공용으로 패키징하고 실행 계획 문서 경로를 제거할 것.
