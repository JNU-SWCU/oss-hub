# Notion QA ticket contract

## Properties

| Property | Type | Contract |
| --- | --- | --- |
| `QA 항목` | Title | `QA<number>. <관찰된 증상>` |
| `작업 유형` | Select | One of `feat`, `fix`, `refactor`, `chore` |
| `페르소나` | Multi-select | Any supported combination of `교직원`, `학생`, `관리자` |
| `상태` | Status | New tickets start at `신규` |
| `담당자` | Person | Zero or one person only |
| `완료 여부` | Checkbox | Manual and unchecked until deployed verification passes |
| `마감` | Date | Publication date plus the evidence-backed 1, 3, or 5 business-day tier |
| `요청자` | Person | Defaults to the person who creates the row |
| `요청일` | Created time | Automatic publication timestamp |
| `재현 URL` | URL | Complete safe URL when known |
| `증거` | Files | Safe evidence only, with no real data or personal information |
| `GitHub Issue` | URL | 발행된 실행 Issue의 URL, 발행 전에는 비어 있음 |

Properties are the index and assignment surface.
The page body is the execution contract.

## 데이터베이스 조회

`🐞 QA 요청`의 data source는 `collection://3b3583e4-660d-808b-aa59-000b87428b42`다.

조회에서 반복해서 걸리는 것 넷을 미리 적어 둔다.

- `notion-fetch`의 `id`는 문자열 하나다. 배열이나 `urls`로 넘기면 요청 자체가 거부된다.
- `notion-query-data-sources`는 인자를 `{"data": {"data_source_urls": [...], "query": "..."}}`로 한 겹 감싼다. 평평하게 넘기면 거부된다.
- `마감` 조건은 속성 이름만으로 걸리지 않는다. `date:마감:start`로 지정한다.
- `QA 항목` 정렬은 문자열 정렬이다. `QA99`가 `QA100`보다 뒤에 오므로 최댓값을 `ORDER BY ... DESC LIMIT n`으로 찾으면 세 자리 번호가 창 밖으로 밀려난다. 번호 범위를 `LIKE`로 좁혀 확인한다.

## Choosing the body

Use the functional-defect body when a directly observed result contradicts expected behavior.
Use the UX-improvement body when an existing flow works but is difficult, fragmented, unclear, or unnecessarily costly for the user.
When the user supplies a manually edited reference ticket, its section order and sentence density are the local style baseline.
When the user reviews UI references, keep only the approved pattern for each sub-flow and leave rejected candidates outside the final ticket.
Do not combine both bodies mechanically.
Keep only the reproduction detail needed to understand and verify the named problem.

## 여는 말

본문은 첫 heading 앞에 2~3줄의 여는 말로 시작한다.
읽는 사람이 이 화면에서 이미 겪고 있을 불편을 먼저 짚고, 이 티켓이 그중 무엇을 바꾸는지 말하고, 증거가 어디에 있는지 가리킨다.
어느 티켓에 붙여도 말이 되는 인사는 여는 말이 아니라 잉여다.
아직 하지 않은 일에 대한 칭찬도 넣지 않는다.
길이는 3줄을 넘기지 않으며, 넘칠 내용은 `문제`로 내린다.

## 영역별 증거

`영역`은 티켓이 어떤 증거를 갖춰야 하는지를 결정하며 하나만 고른다.
한 티켓이 두 영역에 걸치면 증거 계약이 둘로 갈리므로 티켓을 쪼갠다.

| 영역 | 최소 증거 | 캡처 |
| --- | --- | --- |
| `frontend` | 대상 요소의 CSS selector, DOM path, 전체 URL, 확인 시각 | 필수 — 그 요소만 잘라낸 이미지 |
| `backend` | 요청 방법과 경로, 요청 본문 요약, 응답 상태코드, 응답 본문 요약, 관련 로그 한 줄 | 로직 변경이면 필수 — [흐름 다이어그램](../../submit-pr-evidence/references/backend-diagram.md) |
| `infra` | 설정 파일 경로, 변경 대상 값의 이름, 배포 단계, 확인 명령과 그 출력 | 요구하지 않는다 |

`backend`와 `infra`의 값은 전부 합성 예시로 쓴다.
실제 토큰, 실제 호스트 주소, 개인정보, private 저장소 경로는 어느 영역에서도 넣지 않는다.
직접 실행해 관찰하지 않은 증거는 지어내지 않고 `확인 필요`로 남긴다.

### frontend 캡처 절차

캡처보다 selector가 먼저다.
브라우저에서 대상 요소를 지목해 CSS selector와 DOM path를 확정한 뒤, 그 요소의 영역만 캡처한다.
화면 전체를 찍고 캡션으로 위치를 설명하는 방식은 이 계약을 만족하지 않는다.
selector를 확정하지 못하면 `미기록`으로 넘기지 말고 캡처를 보류한 뒤 `확인 필요`로 표시한다.
같은 규칙이 `현재 화면`과 `참고 UI`의 캡처에 모두 적용된다.

## Functional defect body

```text
<이 티켓을 집을 사람에게 건네는 2~3줄 — 지금 이 화면에서 겪고 있을 불편, 이 티켓이 바꾸는 것, 증거가 어디에 있는지>

> 한 화면 또는 한 산출물 위치·한 논리 변경만 다룹니다.
> 실데이터·개인정보가 보이는 캡처는 첨부하지 않습니다.

## 문제
- 영역: <frontend | backend | infra>
- 페르소나: <교직원 | 학생 | 관리자>
- 재현 URL: <전체 URL 또는 해당 없음>
- 문제와 영향: <어떤 조건에서 무엇이 잘못됐고 누구에게 어떤 영향이 있는지 2~4문장>

## 재현
- 조건: <로그인·권한·데이터 상태>
1. <첫 동작>
2. <다음 동작>
3. <문제가 보이는 지점>
- 실제: <직접 관찰한 결과>
- 기대: <정상이라면 보여야 할 결과>
- 증거: <첨부 파일, 확인 branch@SHA·시각>

## 작업 계약
- 선행 의존성: <없음 또는 티켓>

#### 최소 요구 (기능)
- [ ] <반드시 구현할 범위>

#### 완료 조건 (기능 검증)
- [ ] <페르소나>가 <행동>하면 <확인 가능한 결과>를 본다.
- [ ] 배포 환경에서 다시 확인한다.

#### 절대 금지 (이 티켓의 경계)
- <이번 티켓에서 건드리지 않을 범위>
```

## UX or design improvement body

```text
<이 티켓을 집을 사람에게 건네는 2~3줄 — 지금 이 화면에서 겪고 있을 불편, 이 티켓이 바꾸는 것, 증거가 어디에 있는지>

## 문제
- 영역: <frontend | backend | infra>
- 페르소나: <교직원 | 학생 | 관리자>
- 재현 URL: <전체 URL 또는 해당 없음>
- <현재 흐름이나 화면에서 무엇을 이해하거나 수행하기 어려운지>
- <그 어려움이 사용자에게 만드는 판단 비용, 누락 위험, 반복 작업 또는 접근성 문제>
- <이번 티켓이 만들려는 사용자 경험과 명시적인 비목표>

## UX 방향
- <정보 구조와 주 작업을 어떻게 단순화할지>
- <저장, 취소, 오류, 빈 상태 또는 피드백을 어떻게 이해시킬지>
- <키보드와 좁은 화면에서 유지할 상호작용 원칙>

## 기대 흐름
1. <사용자가 시작하는 위치와 행동>
2. <중간에 확인하거나 입력하는 핵심 정보>
3. <저장 또는 완료 뒤 확인 가능한 결과>
4. <취소, 실패 또는 빈 상태에서의 결과>

## 참고 UI
### <제품 또는 패턴 이름>
<전체 참고 URL>
<그 패턴이 보이는 요소만 잘라낸 이미지>
- selector: <캡처한 요소의 CSS selector>
- 참고 포인트: <최종 선택한 상호작용 또는 정보 구조>
- OSS Hub 적용: <가져오지 않을 범위를 포함해 그 패턴을 이 화면에 맞게 제한하는 방법>

## 최소 요구
- [ ] <반드시 구현할 사용자 가시 범위>
- [ ] <오류, 빈 상태, 키보드 또는 반응형 요구>

## 완료 조건
- [ ] <페르소나>가 <행동>하면 <관찰 가능한 결과>를 본다.
- [ ] 실패·취소·새로고침 뒤에도 <보존되거나 되돌아가야 할 상태>가 맞다.
- [ ] 배포 환경의 키보드 조작과 390px 화면에서 다시 확인한다.

## 작업 범위
- 시작 지점: <검사로 확인한 파일 또는 화면 영역>
- 관련 계약: <완료된 이슈, 재사용 component 또는 선행 의존성>
- <변경하지 않을 인접 화면, API, schema, 저장소 lifecycle 또는 권한 경계>

## 현재 화면
<현재 화면이 무엇을 보여주며 왜 판단하기 어려운지 설명하는 캡션>
<selector로 잘라낸, 개인정보와 실데이터가 없는 이미지>
- selector: <캡처한 요소의 CSS selector>
- DOM path: <body부터 그 요소까지의 전체 경로>
- 캡처: <전체 URL> @ <확인 시각>
```

## Missing information

Use `미기록` when a legacy source does not contain the required fact.
Use `해당 없음` only when the fact is known not to apply.
Do not leave an angle-bracket placeholder in a published ticket.
