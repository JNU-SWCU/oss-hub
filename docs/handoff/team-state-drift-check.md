# TEAM-STATE 저널 GitHub drift 검사

작성자 저널(`docs/handoff/team-state/*.md`)이
GitHub 사실과 어긋나면 보고한다. 검사기는 문서를 고치지 않는다.
쓰기 규칙은 루트 AGENTS.md §3이 원본이다.

## 실행

```bash
pnpm run team-state:check:test
pnpm run team-state:check
```

`team-state:check:test`는 합성 Markdown·Issue·PR fixture만 사용한다.
의존성을 설치하지 않은 환경에서는 `node scripts/team-state-check.mjs`로 실행한다.

## 검사 범위

- 저널에서 Issue/PR(없으면 제목)당 **마지막 항목만** 본다
- 그 항목의 `review`·`active`·`blocked`가 GitHub에서 이미 종료·병합됐는지
- `#<PR> merge 후 base 전환` blocker가 이미 해소됐는지

인덱스(`TEAM-STATE.md`)와 archive는 검사하지 않는다.
스냅샷 freshness(`generated_at` 48시간, `source_commit`)는 두지 않는다.

## 출력·exit code

| 분류 | exit code | 의미 |
| --- | --- | --- |
| `clean` | 0 | 검사한 범위에서 사실 불일치가 없음 |
| `stale` | 1 | 마지막 저널 항목·blocker가 GitHub 사실과 다름 |
| `unknown` | 2 | GitHub 조회 실패, 권한 부족, 미지원 문서 형식 |

`unknown`을 `clean`으로 간주하지 않는다. 오류에 토큰·응답 본문·로컬 절대 경로를 출력하지 않는다.

## CI 정책

`ci` required job은 검사기 단위테스트를 Node.js 24로 실행한다.
실제 GitHub 비교는 `team-state-drift (advisory)` job이며 `continue-on-error: true`라 merge를 막지 않는다.

## 로컬 pre-push 가드

`.githooks/pre-push`는 `origin/main` 대비 `docs/handoff/team-state/*.md`가 바뀌었는지만 본다.
인덱스만 고친 것으로는 통과하지 않는다. 사실 일치는 advisory job의 역할이다.

활성화는 `bash scripts/setup-hooks.sh`다. 다른 `core.hooksPath`를 쓰면 이 훅은 비활성이다.
`main` direct push와 브랜치 삭제는 제외한다.
사소한 변경이면 `TEAM_STATE_SKIP=1 git push`로 우회하고 사유를 PR 본문에 남긴다.

## 수동 후속

1. 보고서의 GitHub 상태를 사람이 재확인한다.
2. 맞추려면 자기 저널 **끝에 새 항목**을 붙인다. 옛 항목은 고치지 않는다.
3. 검사기는 owner·ADR·Issue·PR을 자동 변경하지 않는다.
