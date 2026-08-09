<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-30 · Updated: 2026-07-31 (합성 입력 경계 vs 실제 side-effect 경계 명확화) -->

# scripts/ — 저장소 검사·운영 보조 스크립트

## Purpose

CI와 Git 훅, 로컬 검증, 배포 보조에 필요한 실행 파일을 둔다.
스크립트는 정책 문서를 복제하지 않고 검증 가능한 계약만 코드화한다.

## Key Files

| 경로 | 역할 |
| --- | --- |
| `check-*.sh`, `check-*.mjs` | nginx·Compose·Jenkins·Docker·public-safe·TEAM-STATE 계약 검사 — 테스트는 합성 입력만 쓴다 |
| `run-backend-integration*.sh` | backend 통합 테스트 실행 경계 — 격리 컨테이너를 실제로 띄운다 |
| `docker-verify-local*.sh`, `_compose-lib.sh` | 정규 로컬 Compose 두 파일을 실제로 실행·검증한다 |
| `prune-deploy-backups*.sh` | 보존 범위 밖 백업을 실제 삭제하는 Jenkins 성공 경로 전용 스크립트(대응 `.test.sh`만 합성 임시 디렉터리 사용) |
| `check-docker-context.sh` | Docker daemon 없이 tracked build-context 계약을 정적으로 검사한다 |
| `diagnose-collection*.sh` | 수집 갱신 정지 진단 — read-only SELECT 4층(O0~O3)으로 후보 C1~C10을 1차 판정한다. 서버 안에서만 실행하고 저장소 이름·학생 식별자·자격증명을 출력하지 않는다 |
| `setup-hooks.sh`, `tidy-branches.sh` | 저장소 훅 활성화와 merge 후 브랜치 정리 |
| `dev.sh` | 호스트 hot reload 개발 실행기(`pnpm dev`) — 실제 인프라(Docker)를 기동한다 |

## For AI Agents

- 변경 경로별 검증 명령의 원본은 `docs/rules/ci-path-verification.md`다.
- 새 스크립트나 검사 범위를 추가하면 해당 매핑도 같은 변경에서 갱신한다.
- **계약 검사 테스트(`check-*.test.sh`/`check-*.test.mjs`)는 합성 입력·fixture만 쓴다** — 외부 서비스·실데이터·운영 자격증명을 참조하지 않는다.
- `team-state-check.mjs`는 GitHub 상태를 읽고, Docker·통합·개발 스크립트는 로컬 인프라를 변경한다.
- 비-test 실행 파일을 같은 이름의 test fixture와 혼동하지 않는다.
- shell은 `set -euo pipefail`과 fail-closed 오류 처리를 우선하며, Node 스크립트는 Node 24 문법 검사를 통과해야 한다.
- `prune-deploy-backups.sh`는 운영 백업을 삭제할 수 있으므로 승인된 Jenkins 성공 경로 밖에서 수동 실행하지 않는다.
- `check-jenkinsfile.sh`·`check-jenkinsfile.test.sh`는 ADR-005의 배포 계약 경로이므로 승인 계약은 루트 §3과 ADR 원문을 따른다.
- 그 밖의 배포 계약 검사 스크립트는 실제 서버를 변경하지 않는다.
- 운영 절차와 승인 경계는 `docs/deploy/server-runbook.md`·`docs/deploy/pre-deploy-verify.md`·ADR-002가 원본이다.
- public-safe 규칙은 `docs/rules/security.md`가 원본이다.
- 시크릿, 개인 경로, 실데이터를 출력하거나 fixture에 반입하지 않는다.

## Dependencies

- [루트 AGENTS.md](../AGENTS.md) — public-safe·작성권·훅 규칙
- [docs/rules/ci-path-verification.md](../docs/rules/ci-path-verification.md) — 경로별 CI 계약
- [docs/deploy/server-runbook.md](../docs/deploy/server-runbook.md), [docs/deploy/pre-deploy-verify.md](../docs/deploy/pre-deploy-verify.md) — 배포 런북
- [ADR-002](../docs/decisions/ADR-002-CI-CD-파이프라인.md) — 배포 승인·트리거·복구 계약
