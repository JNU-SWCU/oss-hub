# TEAM-STATE·exec-plan GitHub drift 검사

`TEAM-STATE.md`와 `docs/exec-plan/active/*.md`가 생성된 뒤 GitHub 상태가 바뀌어도
새 작업자가 종료된 일을 진행 중으로 오인하지 않도록 사실 불일치를 보고한다.
검사기는 문서를 자동 수정하지 않고 사람이 확인할 증거와 다음 행동만 출력한다.

## 실행

필요 환경은 Node.js 24, pnpm, 인증된 GitHub CLI(`gh auth status`)다. CI에서는
repository-scoped `github.token`을 `GH_TOKEN`으로 주입한다.

```bash
pnpm run team-state:check:test
pnpm run team-state:check
```

`team-state:check:test`는 합성 Markdown·Issue·PR fixture만 사용한다. 토큰·실제 GitHub
응답·실데이터를 테스트에 저장하지 않는다.
새 worktree처럼 의존성을 설치하지 않은 환경에서는 같은 스크립트를
`node scripts/team-state-check.mjs`로 직접 실행할 수 있다.

## 검사 범위

- TEAM-STATE의 `review`·`active`·`blocked` 기능에 연결된 Issue·PR이 GitHub에서
  종료·병합됐는지
- `#<PR> merge 후 base 전환` blocker의 의존 PR이 병합됐고 현재 PR base가
  `main`으로 바뀌었는지
- active exec-plan의 parent Issue가 종료됐는지
- active exec-plan의 branch와 같은 head를 쓴 PR이 `main`에 병합됐는지
- `generated_at`이 48시간을 넘겼는지
- `source_commit`이 `origin/main`의 ancestor인지와 이후 material change가 있는지

검사기는 `source_commit`을 비교하기 직전에 원격 `main`을 명시적으로 fetch해
`origin/main`을 갱신한다. fetch가 실패하거나 30초의 subprocess 제한 시간을 넘기면
기존 로컬 ref를 사실로 사용하지 않고 freshness를 `unknown`으로 보고한다.

`source_commit`이 TEAM-STATE 파일 추가·갱신 commit 하나 때문에만 main보다 뒤에
있는 경우는 스냅샷이 병합되자마자 stale이 되는 자기 참조 오탐을 막기 위해
허용한다. 그 외 파일의 commit이 하나라도 사이에 있으면 stale로 보고한다.

active exec-plan branch의 PR 목록은 생성 시각 기준 최신순으로 조회한다. 같은 branch를
재사용했으면 가장 최근 PR을 현재 구현 PR로 판단할 수 있도록 하기 위함이다.

## 출력·exit code

| 분류 | exit code | 의미 |
| --- | --- | --- |
| `clean` | 0 | 검사한 범위에서 사실 불일치가 없음 |
| `stale` | 1 | 문서 상태·blocker·freshness가 GitHub·main 사실과 다름 |
| `unknown` | 2 | GitHub 조회 실패, 권한 부족, Git 이력 부족, 미지원 문서 형식 |

각 finding은 `source`, `evidence`, `action`을 포함한다. `unknown`을 `clean`으로
간주하지 않으며, 오류에 토큰·응답 본문·로컬 절대 경로를 출력하지 않는다.

## CI 정책

`ci` required job은 모든 PR에서 검사기 단위테스트를 Node.js 24로 실행한다.
실제 GitHub 비교는 `team-state-drift (advisory)` job이 같은
`scripts/team-state-check.mjs`를 직접 실행한다. 수동 `pnpm run team-state:check`과
같은 검사 경로다. drift·unknown은 non-zero로 보고하지만 1차 도입에서는
`continue-on-error: true`로 required `ci`와 merge를 차단하지 않는다.
advisory job은 5분, 각 Git·GitHub CLI subprocess는 30초로 제한한다. GitHub 토큰
권한은 이 job에만 `contents: read`, `issues: read`, `pull-requests: read`로 부여한다.

hard gate 전환은 오탐·GitHub API 안정성을 확인한 뒤 owner가 별도로 결정한다.

## 수동 후속 원칙

1. 보고서의 GitHub Issue·PR·main 상태를 사람이 재확인한다.
2. TEAM-STATE 상태·blocker 또는 exec-plan checklist·archive 여부를 owner가 수동 판단한다.
3. 수정이 필요하면 별도 문서 PR로 증거와 수정 이유를 남긴다.

검사기는 owner·우선순위·ADR·exec-plan·Issue·PR을 자동 변경하지 않는다.
