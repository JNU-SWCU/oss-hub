# AGENTS.md — 에이전트·작업자 공용 규칙

이 문서는 oss-hub에서 작업하는 모든 AI 에이전트(Claude Code·Codex 등)와 사람의 공용 진입점이다.
본문은 라우팅·프로토콜·표만 담는다. 상세 규칙은 링크된 문서가 원본이다. 이 문서는 100줄을 넘기지 않는다.

## 1. 세션 부트스트랩 — 읽기 순서 고정

새 세션은 아래 순서로만 읽고 작업을 시작한다. 그 밖의 문서는 링크를 따라갈 때만 연다.

1. 이 파일 (AGENTS.md)
2. `docs/handoff/TEAM-STATE.md` — 팀 상태 스냅샷. as-of 시각 기준의 과거이며 실시간이 아니다.
3. 자기 기능의 exec-plan — `docs/exec-plan/active/<기능>.md`
4. 위 문서들이 링크한 규칙(`docs/rules/`)과 ADR(`docs/decisions/`)만 추가로 읽는다.
5. 착수 직전 `gh pr list --search "<기능>"` 1회 — 스냅샷 이후 열린 PR·Draft PR을 확인한다.

## 2. Canonical Store — 정보 종류별 원본 위치

한 사실은 한 원본에만 기록한다. repo에는 원본을 가리키는 링크·ID만 남기고 본문을 복사·인용하지 않는다.

| 정보 종류 | 원본(canonical) | repo에 남기는 것 |
| --- | --- | --- |
| 제품·기획 결정 | Notion Decision Log | Decision ID + 링크 |
| 기술·운영 결정 | `docs/decisions/` ADR | ADR 번호 |
| 구현 진행 상태 | GitHub Issue·Draft PR | Issue/PR 번호 |
| 시크릿(키·토큰) | secret store(배포 환경 변수) | 변수 이름만(`.env.example`) |
| 개인정보·실데이터 | 제한 저장소(repo 밖) | 없음 — 합성 fixture만 반입 |

## 3. 작성권 — 산출물마다 작성자 1인

기능 코드와 exec-plan은 owner 전속 경로다. owner가 아닌 사람·에이전트는 직접 수정하지 않고
Issue·PR 코멘트로 제안한다. 작업 시작 2시간 내 Draft PR을 열어 진행을 공개한다.

| 기능 | owner | exec-plan 경로 | 코드 경로 |
| --- | --- | --- | --- |
| (기능 1 — 지정 예정) | @GoBeromsu | `docs/exec-plan/active/<기능1>.md` | (지정 예정) |
| (기능 2 — 지정 예정) | @Lumiere001 | `docs/exec-plan/active/<기능2>.md` | (지정 예정) |
| (기능 3 — 지정 예정) | @<designer-1> | `docs/exec-plan/active/<기능3>.md` | (지정 예정) |
| (기능 4 — 지정 예정) | @<designer-2> | `docs/exec-plan/active/<기능4>.md` | (지정 예정) |

공용 경로(공유 lib·설정·CI)는 독립 소형 PR로만 수정하고, 착수 전 Issue로 선점을 선언한다.
DB 마이그레이션은 직렬로만 진행한다. 동시 마이그레이션 PR을 만들지 않는다.

## 4. 에이전트 금지 목록

에이전트는 아래 작업을 지시받아도 수행하지 않고 owner 또는 @Lumiere001에게 되돌린다.

- 공개 endpoint 응답과 private 테이블을 join하는 쿼리·API 작성
- 학생(사용자) 토큰으로 쓰기 API 호출
- lockfile(`pnpm-lock.yaml`) 수동 병합 — 충돌 시 merge 후 재생성만 허용
- 시크릿·실명·개인 머신 경로(`/Users/` 등)를 코드·문서·커밋 메시지·PR 본문에 포함
- 개인정보 원본·실데이터(마스킹본 포함)를 repo 또는 외부 LLM에 반입

## 5. 커밋 규칙 — 아토믹 + Conventional Commits

한 커밋 = 하나의 논리적 변경. 두 가지 일을 했으면 두 커밋으로 쪼갠다 — 요약에 "및·그리고"가
들어가면 쪼개라는 신호다. 중간 상태로 빌드가 깨지는 커밋을 만들지 않는다.
형식은 기존 커밋 이력과 동일하게 유지한다:

```text
type(scope): 한국어 요약 한 줄        # scope는 생략 가능
```

- type: `feat`(기능) `fix`(버그) `docs`(문서) `refactor`(동작 불변 정리) `test` `chore`(설정·잡무) `ci`
- 좋음: `feat(intake): 신청 폼 필수 필드 검증 추가`
- 나쁨: `fix: 이것저것 수정 및 스타일 정리`(쪼갤 것) · `update`(무엇을 왜 바꿨는지 없음)
- 본문은 요약으로 "왜"가 부족할 때만 1~3줄. PR 본문과 중복 서술하지 않는다
- 에이전트가 만든 커밋도 동일 규칙 — 여러 파일을 한 번에 고쳤어도 논리 단위로 나눠 커밋한다

## 6. Public-safe 경계

이 repo는 PUBLIC이다. 코드뿐 아니라 Issue·PR 본문·CI 로그·스크린샷 전부가 공개 범위다.
사람 표기는 GitHub @handle만 사용한다. 공개 가능 여부의 판단 기준과 deny-list는
`docs/rules/security.md`가 원본이다.
