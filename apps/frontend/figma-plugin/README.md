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
4. 페이지 `00 Cover` ~ `07 Card`를 연다.

폰트는 Pretendard Variable → Pretendard → Inter 순으로 있는 것을 쓴다. Pretendard가 없으면
`brew install --cask font-pretendard` 뒤 Figma를 다시 연다.

## 만드는 것

| 페이지                  | 내용                                                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 변수 컬렉션 「OSS Hub」 | `palette/*`(색 램프), `space/*`·`measure/*`·`fontSize/*`(치수), `semantic/*`(역할, Light·Dark 모드, primitive를 alias) |
| 텍스트 스타일           | `text/page` 40 · `text/section` 24 · `text/body` 16 · `text/small` 13 · `text/badge` 12 · `text/table` 14              |
| 01 Tokens               | 팔레트 견본 · 간격 척도                                                                                                |
| 02 Button               | variant 7 × size 5 × state 3 (높이 44 고정)                                                                            |
| 03 Badge · 용어 사전    | StatusBadge 5 × 2 + 상태 어휘 표                                                                                       |
| 04 Filter Chip          | 기본·hover·눌림 + 예시 묶음                                                                                            |
| 05 Dialog · Form        | Dialog md(576)·lg(672), Form/Field, 오버레이 견본                                                                      |
| 06 Table                | 머리글·본문·행 제목 셀 + 학과별 활성 표 예시                                                                           |
| 07 Card                 | 머리(제목·설명·행 액션)·내용·바닥                                                                                      |

계산값(`color-mix`·`rgb(var…)`)은 흰색·기본색에 불투명도를 준 값으로 근사하고, 읽지 못한 값은
플러그인 창의 기록에 남긴다.

## 검증

`pnpm --filter frontend test`가 `figma-plugin/code.test.ts`로 이 스크립트를 가짜 Figma API 위에서
끝까지 실행해 변수·스타일·컴포넌트 수를 고정한다. 실제 Figma에서의 시각 확인은 실행한 사람이 한다.
