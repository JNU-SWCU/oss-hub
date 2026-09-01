<!--
이 PR 본문은 다음 사람·에이전트가 메신저 설명 없이 작업을 재개하기 위한 인수인계 문서다.
- PR은 Ready로 연다 — Draft는 AGENTS.md §3이 정한 스택 하위 PR 예외에서만 쓴다. 이후 push할 때마다 본문을 최신으로 유지한다.
- 작성은 2~4분 안에 끝낸다. 길게 쓰지 말고, 모르는 항목은 비우지 말고 "없음" 또는 "미확인"으로 적는다.
-->

## 1. 연결

<!-- 이 PR이 속한 Issue 번호를 적는다. 없으면 "없음" + 사유 1줄.
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
- free-role 수정(AGENTS.md §3): 대상 기능 / owner `@handle` — 해당 없으면 `N/A`. owner를 리뷰어로 지정했고, 착수 전 Issue로 선점을 선언했다.
- [ ] `submit-pr-evidence` 절차를 수행했다.

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

## 4. Frontend Before / After

<!-- 시각 UI나 상호작용이 바뀐 frontend PR은 실제 실행 화면을 첨부한다.
     촬영 조건·공개 안전 확인·첨부 방법의 원본은 skills/submit-pr-evidence/references/frontend-capture.md다 — 규칙을 여기 옮겨 적지 않는다.
     이미지는 이 표 칸에 직접 끌어다 놓아 첨부하고, 저장한 뒤 본문을 다시 열어 실제로 렌더되는지 확인한다.
     로컬 파일 경로만 적은 상태는 첨부가 아니다.
     frontend 시각 변화가 없으면 이미지를 생략하고 `N/A — <사유>`를 적는다. -->

| Before | After |
| --- | --- |
| <!-- 이미지 또는 N/A — 사유 --> | <!-- 이미지 또는 N/A — 사유 --> |

## 4b. Backend 흐름 다이어그램

<!-- backend 로직 변경(분기·상태 전이·인가 경로·비동기 retry/실패 처리·호출 순서·계층 경계)이면 mermaid 또는 DOT 다이어그램을 여기에 넣는다.
     기준과 형식의 원본은 skills/submit-pr-evidence/references/backend-diagram.md다 — 규칙을 여기 옮겨 적지 않는다.
     해당 없으면 `해당 없음` 한 줄. -->

```mermaid
%% flowchart LR 또는 stateDiagram-v2
```

## 5. 상태 변화 · 후속 Issue · blocker

<!-- 이 PR로 무엇이 어느 상태에서 어느 상태로 바뀌는지 1~2줄.
     후속 Issue는 번호로, blocker는 owner(GitHub @handle)와 due를 붙인다. 해당 없으면 "없음". -->

- 상태 변화:
- 후속 Issue:
- blocker (owner / due):

## 6. 다음 액션 1개

<!-- 다음 사람·에이전트가 이 브랜치에서 가장 먼저 할 일 하나만 적는다.
     "이어서 개발" 금지 — 첫 명령 또는 첫 수정 파일 수준으로 구체적으로. -->

-

## 7. 환경 전제

<!-- 이 브랜치를 실행하기 위한 전제. 해당 없는 항목은 지우지 말고 "불필요"로 표시한다. -->

- 의존성 설치: <!-- 예: pnpm install 필요 (lockfile 변경) / 불필요 -->
- env 변경: <!-- 예: .env.example에 신규 키 추가됨 / 없음 -->
- seed·마이그레이션: <!-- 예: migrate 후 seed 재실행 필요 / 없음 -->
- 로컬 서비스: <!-- 예: docker compose up postgres 필요 / 없음 -->

## 보안 셀프체크 (PUBLIC repo)

- [ ] 공개 금지 정보 없음 — 학번·연락처·미공지 일정·예산·실데이터 값·Notion 본문 인용이 코드·본문·스크린샷에 없다
- [ ] 시크릿 없음 — 토큰·키·비밀번호·내부 URL이 diff와 로그 출력에 없다
- [ ] 실명 없음 — 사람은 GitHub @handle로만 표기했다
