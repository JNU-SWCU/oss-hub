# 릴리스와 자동화

사용자는 Pages를 보며 진행 상황을 확인하려고 작게 자주 배포하기를 원합니다. 마일스톤마다 한 바퀴를 돕니다. 이 문서는 `guide/`가 Pages에 올라가는 길만 다룹니다. 그 밖의 저장소 절차는 이 스킬의 범위가 아닙니다.

## 마일스톤 단위

예: 소개와 시작하기, 관리자 절 한 묶음, 학생 절 한 묶음, 교직원 절 한 묶음, 윤문 반영, 시각 검수 수정. 이미지와 그것을 쓰는 본문은 같은 커밋에 넣습니다. 이미지가 인덱스에 없으면 빌드가 `Shot` 오류로 실패합니다.

## 한 바퀴

1. 검수: `orchestration.md`의 오케스트레이터 검수를 마칩니다. 접촉 인쇄를 눈으로 보기 전에는 커밋하지 않습니다.
2. 스테이징: 눈으로 본 이미지와 본문만 경로를 적어 올립니다. 폴더 통째로 올리면 검수하지 않은 이미지까지 공개됩니다.
3. 이미지 인덱스 점검: `bash skills/build-user-guide-site/scripts/release-check.sh`. mdx가 참조하는 `src="role/name.webp"` 가 전부 인덱스에 있는지 봅니다. 없으면 `MISSING <파일>`을 찍고 1로 끝납니다.
4. 커밋과 푸시.
5. 배포 확인: `gh run list --workflow guide-pages.yml --limit 3`로 실행이 성공했는지 보고, `gh run watch <id>`로 기다립니다. 배포 주소는 `https://jnu-swcu.github.io/oss-hub/`.
6. 짧게 보고: 올린 것, Pages 링크, 남은 일 한두 줄.

## 자동화 구성 (파일에서 읽은 그대로)

`.github/workflows/guide-pages.yml`

- 트리거: `main`으로의 push 중 `guide/**` 또는 이 워크플로 파일이 바뀐 경우, 그리고 `workflow_dispatch`.
- 권한: `contents: read`. 동시성 그룹 `pages`(진행 중인 실행을 취소하지 않음).
- `build` 작업: 체크아웃, pnpm 설정(`guide/package.json`), Node 24(pnpm 캐시 키는 `guide/pnpm-lock.yaml`), configure-pages, `pnpm install --frozen-lockfile`, `pnpm build`, `guide/dist` 업로드. 작업 디렉터리는 `guide`.
- `deploy` 작업: `build` 뒤에 실행, `pages: write`와 `id-token: write`, 환경 `github-pages`, deploy-pages.
- 사용하는 액션은 SHA로 고정되어 있습니다.

`.github/workflows/guide-check.yml`

- `guide/**`나 이 워크플로 파일이 바뀐 변경이 `main`에 들어가기 전에 같은 빌드 단계만 돌립니다. 배포하지 않습니다.

즉 `guide/`의 변경이 `main`에 들어가면 자동으로 빌드하고 배포합니다. 손으로 배포하지 않습니다.

## 작업 브랜치에서 미리 배포하기

큰 작업 중에 진행을 Pages에서 보려면 아래 두 가지를 임시로 엽니다. 변경을 `main`에 넣기 전에 되돌립니다.

1. `guide-pages.yml`의 `branches`에 작업 브랜치를 더합니다. 되돌릴 때 지웁니다.
2. 저장소 설정의 `github-pages` 환경에 그 브랜치의 배포 정책을 더합니다. 되돌릴 때 그 정책만 지웁니다.

둘 다 되돌린 뒤에는 브랜치에 푸시해도 사이트가 바뀌지 않습니다. 사이트는 마지막 배포본을 유지하다가 `main` 배포로 넘어갑니다.

## 갱신 때

화면이 바뀌어도 같은 절차입니다. 바뀐 화면의 이미지만 다시 찍어 같은 파일 이름으로 덮어쓰고, 영향받는 본문과 `src/site.ts`의 `lastChecked`, `releaseVersion`을 고칩니다. 그 뒤 위 한 바퀴를 돕니다.
