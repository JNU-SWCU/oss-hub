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

## Default body

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

## Missing information

Use `미기록` when a legacy source does not contain the required fact.
Use `해당 없음` only when the fact is known not to apply.
Do not leave an angle-bracket placeholder in a published ticket.
