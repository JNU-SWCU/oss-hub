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

Properties are the index and assignment surface.
The page body is the execution contract.

## Choosing the body

Use the functional-defect body when a directly observed result contradicts expected behavior.
Use the UX-improvement body when an existing flow works but is difficult, fragmented, unclear, or unnecessarily costly for the user.
When the user supplies a manually edited reference ticket, its section order and sentence density are the local style baseline.
When the user reviews UI references, keep only the approved pattern for each sub-flow and leave rejected candidates outside the final ticket.
Do not combine both bodies mechanically.
Keep only the reproduction detail needed to understand and verify the named problem.

## Functional defect body

```text
> 한 화면 또는 한 산출물 위치·한 논리 변경만 다룹니다.
> 실데이터·개인정보가 보이는 캡처는 첨부하지 않습니다.

## 문제
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
## 문제
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
<개인정보와 실데이터가 없는 이미지>
```

## Missing information

Use `미기록` when a legacy source does not contain the required fact.
Use `해당 없음` only when the fact is known not to apply.
Do not leave an angle-bracket placeholder in a published ticket.
