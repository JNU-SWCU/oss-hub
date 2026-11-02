# 릴리스와 자동화

사용자는 Pages를 보며 진행 상황을 확인하려고 작게 자주 배포하기를 원합니다. 마일스톤마다 한 바퀴를 돕니다.

## 마일스톤 단위

예: 소개와 시작하기, 관리자 절 한 묶음, 학생 절 한 묶음, 교직원 절 한 묶음, 윤문 반영, 시각 검수 수정. 이미지와 그것을 쓰는 본문은 같은 커밋에 넣습니다. 이미지가 인덱스에 없으면 CI 빌드가 `Shot` 오류로 실패합니다.

## 한 바퀴

1. 검수: `orchestration.md`의 오케스트레이터 검수를 마칩니다. 접촉 인쇄를 눈으로 보기 전에는 커밋하지 않습니다.
2. 스테이징: `git add <명시한 경로들>`. `git add -A`, `git add .`, 폴더 통째 추가는 쓰지 않습니다. `website/src/assets/shots/` 아래에 훅이 만든 `.omc/` 상태 파일이 생길 수 있습니다(무시되지만 습관적으로 경로를 명시합니다).
3. 이미지 인덱스 점검: `bash skills/build-user-guide-site/scripts/release-check.sh`. mdx가 참조하는 `src="role/name.webp"` 가 전부 인덱스에 있는지 봅니다. 없으면 `MISSING <파일>`을 찍고 1로 끝납니다.
4. 커밋: 한국어 Conventional Commit. 제목은 `docs(website): ...` 처럼 쓰고, 본문은 "-한다" 체로 무엇을 왜 했는지 적습니다. 마지막 줄은 세션 지침의 attribution 줄을 그대로 둡니다(`Co-Authored-By: ...`).
5. 공개 안전 점검: `scripts/check-public-safe.sh origin/main`. 주민번호, 전화번호, 일반 이메일, 개인 PC 경로, 9자리 학번 모양, 금지 파일(`.env`, 키, 인증서, `credentials/secrets/creds.*`)을 막습니다. 걸리면 고치고 다시 커밋합니다.
6. 푸시: `git push`.
7. 배포 확인: `gh run list --workflow website-pages.yml --limit 3`로 실행이 성공했는지 보고, `gh run watch <id>`로 기다립니다. 배포 주소는 `https://jnu-swcu.github.io/oss-hub/`.
8. 짧게 보고: 올린 것, Pages 링크, 남은 일 한두 줄.

## 자동화 구성 (파일에서 읽은 그대로)

`.github/workflows/website-pages.yml`
- 트리거: `main`으로의 push 중 `website/**` 또는 이 워크플로 파일이 바뀐 경우, 그리고 `workflow_dispatch`.
- 권한: `contents: read`. 동시성 그룹 `pages`(진행 중인 실행을 취소하지 않음).
- `build` 작업: 체크아웃, pnpm 설정(`website/package.json`), Node 24(pnpm 캐시 키는 `website/pnpm-lock.yaml`), configure-pages, `pnpm install --frozen-lockfile`, `pnpm build`, `website/dist` 업로드. 작업 디렉터리는 `website`.
- `deploy` 작업: `build` 뒤에 실행, `pages: write`와 `id-token: write`, 환경 `github-pages`, deploy-pages.
- 사용하는 액션은 SHA로 고정되어 있습니다.

`.github/workflows/website-check.yml`
- 트리거: `pull_request` 중 `website/**` 또는 이 워크플로 파일이 바뀐 경우. 같은 빌드 단계만 하고 배포하지 않습니다.

즉 main에 올라가면 자동으로 빌드하고 배포하며, PR에서는 빌드가 되는지만 봅니다. 가이드를 고치는 사람은 `website/`를 고치고 PR을 열기만 하면 됩니다.

## 임시 설정과 머지 전 정리

큰 작업 중에 진행을 Pages에서 보려면 아래 두 가지를 임시로 엽니다. 최종 PR을 머지하기 전에 되돌립니다.

1. `website-pages.yml`의 `branches`에 작업 브랜치를 더합니다. 되돌릴 때 지웁니다.
2. 저장소 설정의 `github-pages` 환경에 그 브랜치의 배포 정책을 더합니다. 되돌릴 때 그 정책만 지웁니다.

## 최종 PR

`submit-pr-evidence` 스킬의 형식을 따릅니다. 이 작업은 티켓이 없는 문서 PR이므로 본문의 첫 줄은 `티켓 없음 — <이유>`입니다. 본문 끝에는 세션 지침의 attribution 줄(`🤖 Generated with [Claude Code](https://claude.com/claude-code)`)을 둡니다.

PR 전 확인: `scripts/check-public-safe.sh origin/main`, `cd website && pnpm build`, 사이트 접촉 인쇄 재점검, 임시 설정 되돌림.

## 갱신 때

화면이 바뀌어도 같은 절차입니다. 바뀐 화면의 이미지만 다시 찍어 같은 파일 이름으로 덮어쓰고, 영향받는 본문과 `src/site.ts`의 `lastChecked`, `releaseVersion`을 고칩니다. 그 뒤 위 한 바퀴를 돕니다. main에 머지되면 배포는 워크플로가 합니다.
