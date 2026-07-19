<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-20 -->

# .github/ — CI·작성권 설정

## Purpose

PR에서 실행되는 워크플로와 코드 소유권(리뷰 강제) 설정. 이 디렉터리 자체가 CODEOWNERS 보호 대상이다 — 검사 로직을 약화시키는 변경도 owner 승인 없이는 병합할 수 없다.

## Key Files

| 파일 | 역할 |
| --- | --- |
| `workflows/ci.yml` | 모든 PR에서 실행되는 4개 job(아래 For AI Agents) |
| `CODEOWNERS` | 루트 AGENTS.md §3(작성권)의 코드화 — 경로별 필수 리뷰어. branch protection에서 "Require review from Code Owners"를 켜야 실제로 강제된다 |
| `pull_request_template.md` | PR 생성 시 기본 본문 템플릿 |

## Subdirectories

없음.

## For AI Agents

- `ci.yml`은 4개 job으로 구성된다. 전부 `pull_request` 트리거이며 paths 필터를 안 쓴다(required check 생성을 항상 보장해 교착을 방지) — 대신 job 내부에서 `dorny/paths-filter`로 변경 경로를 감지해 스텝을 조건부 실행한다.
  1. **`ci`** — 변경 경로 감지 후 frontend(`lint`/`typecheck`/`test`/`build`)·backend(`lint`/`typecheck`/`test:unit`/`test:integration`/`build`)·shell/node 스크립트 문법 검사·nginx/compose/Jenkinsfile/Docker 계약 검사를 조건부 실행. 앱 변경이 있을 때만 `prettier` 포맷 검사(`pnpm format:check`)도 여기서 돈다.
  2. **`team-state-drift`(advisory)** — `docs/handoff/TEAM-STATE.md`·`exec-plan/active/*.md`와 GitHub 실제 상태의 불일치를 보고한다. `continue-on-error: true`라 실패해도 required check을 막지 않는다.
  3. **`commitlint`** — Conventional Commits 검사. paths-filter 없이 항상 실행. **type enum은 `feat`/`fix`/`docs`/`refactor`/`test`/`chore`/`ci` 7종만 허용하고 `style`은 포함하지 않는다**(`commitlint.config.cjs`) — 스타일·포맷팅 전용 변경은 `chore` 또는 `refactor`로 분류한다.
  4. **`public-safe`** — deny-list(`docs/rules/security.md`) 정규식 스캔 + gitleaks 시크릿 스캔. paths-filter 없이 항상 실행. PR 제목·본문은 `${{ }}` 인라인 치환이 아니라 `env` 주입으로 전달한다(script injection 방지) — 새 워크플로 스텝에서 PR-controlled 텍스트를 다룰 때 이 패턴을 따른다.
- 새 워크플로 스텝을 추가할 때 `GITHUB_TOKEN`/secrets를 `pull_request` 트리거 CI에 직접 주입하지 않는다(fork PR이 실행할 수 있음) — `public-safe` job의 주석 참조.
- `CODEOWNERS`는 `.gitignore`와 동일한 패턴 문법이며 아래쪽 줄이 우선한다. GitHub은 자기 PR 자기 승인을 금지하므로 owner 2인 구성(@GoBeromsu·@Lumiere001)이 상호 검토를 자동으로 강제한다.
- `docs/rules/ci-path-verification.md`가 "어떤 변경 경로가 어떤 검증을 실행해야 하는가" 계약의 원본이다 — 새 paths-filter 카테고리를 추가하면 그 문서도 함께 갱신한다.

## Dependencies

- [루트 AGENTS.md §5](../AGENTS.md) — 커밋 규칙 원본(`commitlint.config.cjs`가 코드화).
- [docs/rules/security.md](../docs/rules/security.md) — `public-safe` deny-list 원본.
- [docs/rules/ci-path-verification.md](../docs/rules/ci-path-verification.md) — 경로별 검증 계약 원본.
