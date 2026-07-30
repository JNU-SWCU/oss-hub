<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-20 · Updated: 2026-07-31 (ISSUE_TEMPLATE 라우팅 추가) -->

# .github/ — CI·작성권 설정

## Purpose

PR에서 실행되는 워크플로와 high-risk 후보 경로를 설정한다.
이 디렉터리의 검사·병합 정책 변경은 ADR-005에 따라 high risk로 판정한다.

## Key Files

| 파일 | 역할 |
| --- | --- |
| `workflows/ci.yml` | PR·Issue 표면의 CI 및 public-safe 검사를 정의한다 |
| `workflows/deploy.yml` | 공개 full Release를 parameterless Jenkins trigger로 전달한다 |
| `workflows/merge-policy.yml` | default branch 기준 merge-policy check run을 발행한다 |
| `CODEOWNERS` | ADR-005의 high-risk 검토 후보 경로 라우팅. 경로 일치만으로 high risk가 확정되지는 않는다 |
| `pull_request_template.md` | PR 생성 시 기본 본문 템플릿 |
| `ISSUE_TEMPLATE/work-ticket.md` | 화면 1개 단위 작업 티켓 템플릿과 발행·할당 운영 관례 |

## Subdirectories

| 경로 | 내용 |
| --- | --- |
| `workflows/` | CI, 배포 trigger, 병합 정책 workflow. 각 workflow가 실행 경계의 원본이다 |
| `ISSUE_TEMPLATE/` | Issue 발행 템플릿. `work-ticket.md`가 유일한 템플릿이다 |

## For AI Agents

- `ci.yml`은 PR용 job 4개와 Issue 표면 스캔 job 1개로 구성된다.
- `ci`·`team-state-drift`·`commitlint`·`public-safe`는 `pull_request`에서 실행된다.
- `public-safe-issue`는 `issues`·`issue_comment`에서만 실행된다.
- workflow-level paths 필터는 쓰지 않으며 `ci` job 내부의 `dorny/paths-filter`가 변경 경로별 스텝만 조건부 실행한다.
  1. **`ci`** — 변경 경로에 따라 앱 품질 검사와 shell·node·nginx·compose·Jenkins·Docker 계약 검사를 실행한다.
     앱 변경이 있을 때만 `pnpm format:check`도 실행한다.
  2. **`team-state-drift`(advisory)** — 문서와 GitHub 실제 상태의 불일치를 보고한다.
     `continue-on-error: true`이므로 required check을 막지 않는다.
  3. **`commitlint`** — paths-filter 없이 Conventional Commits를 검사한다.
     허용 type은 루트 AGENTS.md §5와 `commitlint.config.cjs`가 원본이다.
  4. **`public-safe`** — deny-list와 gitleaks로 PR 커밋·제목·본문을 검사한다.
     PR-controlled 텍스트는 `${{ }}` 인라인 치환 대신 `env`로 전달한다.
  5. **`public-safe-issue`** — Issue 본문·댓글을 deny-list로 검사하는 공개 표면 탐지 job
- 새 워크플로 스텝을 추가할 때 `GITHUB_TOKEN`/secrets를 `pull_request` 트리거 CI에 직접 주입하지 않는다(fork PR이 실행할 수 있음) — `public-safe` job의 주석 참조.
- `CODEOWNERS`는 GitHub의 별도 패턴 제한을 따르며, 여러 규칙이 일치하면 아래쪽 규칙이 우선한다.
- 이 파일은 high-risk 후보를 찾는 데 사용하고 최종 판정은 ADR-005를 따른다.
- `docs/rules/ci-path-verification.md`가 "어떤 변경 경로가 어떤 검증을 실행해야 하는가" 계약의 원본이다 — 새 paths-filter 카테고리를 추가하면 그 문서도 함께 갱신한다.
- `.github/workflows/deploy.yml`은 얇은 HTTPS trigger만 담당한다.
- 실제 checkout·build·migration·smoke·rollback은 Jenkins와 `docs/deploy/` 계약이 담당한다.
- `.github/workflows/merge-policy.yml`은 PR head 코드를 실행하지 않고 default branch의 판정기와 metadata만 사용한다.
- required check 이름과 신뢰 경계를 임의로 바꾸지 않는다.
- `ISSUE_TEMPLATE/work-ticket.md`로 만든 Issue를 "oss-hub 티켓 #<번호> 진행해줘" 형태로 지시받으면 `.claude/skills/tickets/SKILL.md`를 따른다.
  이 템플릿은 화면 1개 단위 기능 명세만 담고, 공통 규칙은 재서술하지 않는다.
  발행·할당 주체 표기는 운영 관례이며 템플릿 자체가 GitHub 권한을 강제하지 않는다.

## Dependencies

- [루트 AGENTS.md §5](../AGENTS.md) — 커밋 규칙 원본(`commitlint.config.cjs`가 코드화).
- [docs/rules/security.md](../docs/rules/security.md) — `public-safe` deny-list 원본.
- [docs/rules/ci-path-verification.md](../docs/rules/ci-path-verification.md) — 경로별 검증 계약 원본.
