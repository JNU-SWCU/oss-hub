<!--
이 PR 본문은 다음 사람·에이전트가 메신저 설명 없이 작업을 재개하기 위한 인수인계 문서다.
- 2시간 초과 예상 또는 요구사항·설계·위험이 불확실하면 초기에 Draft로 열고, 작고 명확해 2시간 안에
  구현·검증을 마친 변경은 바로 Ready로 열 수 있다. 이후 push할 때마다 본문을 최신으로 유지한다.
- 작성은 2~4분 안에 끝낸다. 길게 쓰지 말고, 모르는 항목은 비우지 말고 "없음" 또는 "미확인"으로 적는다.
-->

## 1. 연결

<!-- 이 PR이 속한 Issue 번호와 exec-plan 경로를 적는다. 둘 다 없으면 "없음" + 사유 1줄.
- 작업 Issue는 `Closes #N` — merge 시 GitHub이 자동으로 닫는다.
- 논의·proposal Issue는 `Refs #N` — 참조만 하고 닫지 않는다.
- 여러 개면 키워드를 반복한다: `Closes #1, closes #2`.
- stacked PR은 다음 순서를 지킨다:
  1. parent PR 병합 확인
  2. child를 default branch로 retarget 또는 rebase
  3. child diff가 child 고유 범위만 포함하는지 확인
  4. Development의 closing Issue 링크 확인
  5. required checks·review·mergeability 통과 후 merge -->

- Closes #
- exec-plan: `docs/exec-plan/active/<기능>.md`

## 2. push 완결 선언

<!-- 마지막 push가 전부다 — 미푸시 로컬 작업은 존재하지 않는 것으로 간주한다.
     체크할 수 없으면 로컬에 무엇이 남았는지 1줄로 적는다. -->

- [ ] 이 작업과 관련된 로컬 변경을 전부 push했다. 이 브랜치의 마지막 커밋이 작업의 전부다.

## 3. 검증 명령 + 현재 기대 결과

<!-- 다음 사람이 그대로 복사해 실행할 명령과, "지금 시점"의 기대 결과를 적는다.
     전부 통과만 정답이 아니다 — 의도적으로 실패 상태인 것이 있으면 반드시 명시한다. -->

```bash
# 예: pnpm test --filter users
```

- 기대 결과: <!-- 예: 12개 통과, users.api.spec 2개는 API 미구현으로 의도된 실패 -->

## 4. 상태 변화 · 후속 Issue · blocker

<!-- 이 PR로 무엇이 어느 상태에서 어느 상태로 바뀌는지 1~2줄.
     후속 Issue는 번호로, blocker는 owner(GitHub @handle)와 due를 붙인다. 해당 없으면 "없음". -->

- 상태 변화:
- 후속 Issue:
- blocker (owner / due):

## 5. 다음 액션 1개

<!-- 다음 사람·에이전트가 이 브랜치에서 가장 먼저 할 일 하나만 적는다.
     "이어서 개발" 금지 — 첫 명령 또는 첫 수정 파일 수준으로 구체적으로. -->

-

## 6. 환경 전제

<!-- 이 브랜치를 실행하기 위한 전제. 해당 없는 항목은 지우지 말고 "불필요"로 표시한다. -->

- 의존성 설치: <!-- 예: pnpm install 필요 (lockfile 변경) / 불필요 -->
- env 변경: <!-- 예: .env.example에 신규 키 추가됨 / 없음 -->
- seed·마이그레이션: <!-- 예: migrate 후 seed 재실행 필요 / 없음 -->
- 로컬 서비스: <!-- 예: docker compose up postgres 필요 / 없음 -->

## 보안 셀프체크 (PUBLIC repo)

- [ ] 공개 금지 정보 없음 — 학번·연락처·미공지 일정·예산·실데이터 값·Notion 본문 인용이 코드·본문·스크린샷에 없다
- [ ] 시크릿 없음 — 토큰·키·비밀번호·내부 URL이 diff와 로그 출력에 없다
- [ ] 실명 없음 — 사람은 GitHub @handle로만 표기했다

## 병합 판정 증거

<!-- ADR-005 기준. head가 바뀌면 아래 증거를 모두 현재 full SHA로 다시 받는다. -->

- risk: `GENERAL | HIGH_RISK`
- head full SHA:
- `MERGE_READY` 댓글 URL:
- 실제 UI/API QA 증거 URL 또는 N/A 사유:
- `RISK_ACCEPT role=PM head=<full-sha> risk=GENERAL` 댓글 URL: `CODEOWNERS 후보를 GENERAL로 낮출 때만`
- `RISK_ACCEPT role=TECH_LEAD head=<full-sha> risk=GENERAL` 댓글 URL: `CODEOWNERS 후보를 GENERAL로 낮출 때만`
- `PM_ACCEPT head=<full-sha>` 댓글 URL: `HIGH_RISK만, 일반 PR은 N/A`
- `TECH_LEAD_ACCEPT head=<full-sha>` 댓글 URL: `HIGH_RISK만, 일반 PR은 N/A`
