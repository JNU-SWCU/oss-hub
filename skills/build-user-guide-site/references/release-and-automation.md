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
6. [localization.md](localization.md)의 명시적 언어 주소와 루트 진입 계약에 따라 두 언어의 배포 결과를 확인한다. 짧게 보고: 올린 것, 언어별 Pages 링크, 남은 일 한두 줄.

## 자동화 구성 (파일에서 읽은 그대로)

`.github/workflows/guide-pages.yml`

- 트리거: `main`으로의 push 중 `guide/**` 또는 이 워크플로 파일이 바뀐 경우, 그리고 `workflow_dispatch`.
- 권한: `contents: read`. 동시성 그룹 `pages`(진행 중인 실행을 취소하지 않음).
- `build` 작업: 체크아웃, pnpm 설정(`guide/package.json`), Node 24(pnpm 캐시 키는 `guide/pnpm-lock.yaml`), configure-pages, `pnpm install --frozen-lockfile`, `pnpm build`, `guide/dist` 업로드. 작업 디렉터리는 `guide`.
- `deploy` 작업: `main`에서만 `build` 뒤에 실행, `pages: write`와 `id-token: write`, 환경 `github-pages`, deploy-pages.
- 사용하는 액션은 SHA로 고정되어 있습니다.

`.github/workflows/guide-check.yml`

- `guide/**`나 이 워크플로 파일이 바뀐 변경이 `main`에 들어가기 전에 같은 빌드 단계만 돌립니다. 배포하지 않습니다.

즉 `guide/`의 변경이 `main`에 들어가면 자동으로 빌드하고 배포합니다. 손으로 배포하지 않습니다.

## 작업 브랜치 빌드 확인

`gh workflow run guide-pages.yml --ref <작업 브랜치>`로 Linux 빌드를 실행한다. `deploy`는 `main`에서만 실행되므로 작업 브랜치의 수동 실행은 빌드와 `github-pages` 산출물 업로드까지만 한다.

`gh run download <id> --name github-pages --dir <scratch>`로 산출물을 내려받아 로컬에서 확인할 수 있다. 정적 사이트이므로 배포 기준 경로 `/oss-hub/`를 유지해 제공한다. 빌드 산출물 다운로드는 공개 배포가 아니다.

검증 뒤 저장소 협업 절차로 `main`에 반영하면 Pages가 자동 배포한다. 미리보기를 위해 환경 보호 정책이나 배포 허용 브랜치를 늘리지 않는다.

## 갱신 때

화면이 바뀌어도 같은 절차입니다. 바뀐 화면의 이미지만 다시 찍어 같은 파일 이름으로 덮어쓰고, 영향받는 본문과 `src/site.ts`의 `lastChecked`, `releaseVersion`을 고칩니다. 그 뒤 위 한 바퀴를 돕니다.

`src/site.ts`의 `checkedCommit`은 가이드가 코드와 맞다고 확인한 마지막 `main` SHA입니다. 올리는 조건은 `SKILL.md`의 「어디서 시작할지」에 있습니다. 제품 변경과 함께 가이드를 고칠 때는 `checkedCommit`을 건드리지 않습니다. 그 시점에는 `main`의 SHA가 정해지지 않았고, 다음 `update`가 이미 맞춘 곳을 확인만 하고 지나갑니다.

## 예약 갱신

기존 자정 갱신은 매 실행 최신 `main`의 `SKILL.md`와 `references/localization.md`를 읽고 그 언어 범위 계약을 따른다. 같은 목적의 일정을 추가하지 않고, 다른 작업의 일정은 바꾸지 않는다.
