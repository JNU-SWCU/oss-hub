# OSS Hub 디자인 라이브러리 플러그인

코드의 토큰(`docs/design-tokens/tokens.json`, 원본 `globals.css`)과 부품 스펙대로 Figma 파일에
변수(Light·Dark) · 텍스트 스타일 · 컴포넌트를 **그려 주는** 플러그인이다. 사람이 그리는 대신
코드가 그린다(design.md R-36의 연장). 값이 어긋나면 코드가 맞다.

## 실행

1. Figma 데스크톱 앱에서 대상 파일을 연다(빈 파일 권장. 다시 실행하면 컴포넌트 페이지는 비우고
   다시 그린다).
2. 메뉴 Plugins → Development → **Import plugin from manifest…** → 이 폴더의 `manifest.json`.
3. Plugins → Development → 「OSS Hub 디자인 라이브러리」 실행 → tokens.json 주소를 확인하고
   **만들기**. 기본 주소는 `main` 브랜치이며, 병합 전에는 브랜치 주소로 바꾼다.
4. 페이지 `00 Cover` ~ `08 실패 · 불러오는 중`을 연다.

폰트는 Pretendard Variable → Pretendard → Inter 순으로 있는 것을 쓴다. Pretendard가 없으면
`brew install --cask font-pretendard` 뒤 Figma를 다시 연다.

## 만드는 것

| 페이지                  | 내용                                                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 변수 컬렉션 「OSS Hub」 | `palette/*`(색 램프), `space/*`·`measure/*`·`fontSize/*`(치수), `semantic/*`(역할, Light·Dark 모드, primitive를 alias) |
| 텍스트 스타일           | `text/page` 40 · `text/section` 24 · `text/body` 16 · `text/small` 13 · `text/badge` 12 · `text/table` 14              |
| 01 Tokens               | 팔레트 견본 · 간격 척도                                                                                                |
| 02 Button               | variant 8 × size 6 × state 3 = 144 (높이 44 고정, size=content 만 예외)                                                |
| 03 Badge · 용어 사전    | StatusBadge 5 × 2 + 상태 어휘 표                                                                                       |
| 04 Filter Chip          | 기본·hover·눌림 + 예시 묶음                                                                                            |
| 05 Dialog · Form        | Dialog md(576)·lg(672)·alert(512), Form/Field, Form/Textarea, 오버레이 견본                                            |
| 06 Table                | 머리글·본문·행 제목 셀 + 학과별 활성 표 예시                                                                           |
| 07 Card                 | 머리(제목·설명·행 액션)·내용·바닥                                                                                      |
| 08 실패 · 불러오는 중   | FailureState(「다시 시도」 있는 것·없는 것) · SkeletonBlock + 뼈대 예시                                                 |

계산값(`color-mix`·`rgb(var…)`)은 흰색·기본색에 불투명도를 준 값으로 근사하고, 읽지 못한 값은
플러그인 창의 기록에 남긴다.

화면과 일부러 어긋나는 것.

- **버튼처럼 안 생긴 「누를 수 있는 면」**(표 칸·달력 날짜, 코드의 `variant="bare" size="content"`)은
  따로 만들지 않고 **기존 Button 세트를 넓혀** 같은 격자에 넣었다(7×5×3 = 105 → 8×6×3 = 144).
  격자를 채우느라 코드에 아직 없는 조합(`default × content`, `bare × icon` 등)도 함께 그린다 —
  실제로 쓰이는 것은 `bare × content` 6곳(메뉴 줄·표 칸·달력 날짜·행 선택기·표 머리글 정렬)과
  `link × content` 1곳(일정 편집의 「시간 변경」 펼치기)이다.
- **아이콘 버튼의 세 크기**(`icon-xs`·`icon-sm`·`icon-lg`)는 코드에 있지만 그리지 않는다. 셋 다
  `w-control px-0`이라 `icon`과 같은 정사각형이고 안에 들어가는 아이콘 크기만 다르다 — 격자를
  세 줄 늘려도 같은 그림이 반복될 뿐이다. 크기 6종은 Figma 가 그리는 범위이지 코드 API 전부가 아니다.
- **되돌릴 수 없는 일을 묻는 확인창**은 저장 창에 메모를 붙이지 않고 `Dialog/alert`로 **따로 그렸다**.
  폭이 512(`max-w-lg`)로 좁고, 낭독기 역할(`alertdialog`)·바깥 클릭 차단·초점이 「취소」로 가는
  것처럼 그림에 안 보이는 규칙은 컴포넌트 설명에 적어 둔다.
- **큰 배지**(StatusBadge `size=lg`)는 지금 어느 화면도 쓰지 않지만 Figma 에는 그대로 둔다
  (PM 결정, 2026-09-23). 코드에서 지울지는 별도 티켓으로 다룬다.

## 요금제 제한

Starter(무료) 요금제는 변수 컬렉션당 모드 1개, 파일당 페이지 3개까지다. 플러그인은 그 제한에
맞춰 다크 값을 「OSS Hub Dark」 컬렉션에 따로 두고, 페이지를 더 못 만들면 남은 부품을 한
페이지(「라이브러리 (OSS Hub)」)의 섹션으로 나눈다. Professional 이상에서는 같은 컬렉션의
Dark 모드와 페이지 9개로 만든다. 2026-09-19 Starter 계정에서 끝까지 실행해 확인했고, 그때
구성은 8페이지였다 — 08 페이지가 늘어난 뒤의 Starter 분기는 `pageLimit` 단위 테스트로만
확인했다.

## 검증

`pnpm --filter frontend test`가 `figma-plugin/code.test.ts`로 이 스크립트를 가짜 Figma API 위에서
끝까지 실행해 변수·스타일·컴포넌트 수를 고정한다 — 부품 14종 목록과 Button 144변형을 통째로
단언하므로 하나가 늘거나 이름이 바뀌면 깨지고, 같은 파일을 두 번 실행해 늘어나지 않는 것도 본다.
파일 하나만 돌리려면 `pnpm --filter frontend exec vitest run figma-plugin/code.test.ts` 다
(`pnpm … test -- <경로>`는 경로가 먹히지 않고 전체가 돈다). 실제 Figma에서의 시각 확인은 실행한
사람이 한다.
