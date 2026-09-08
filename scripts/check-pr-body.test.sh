#!/usr/bin/env bash
# check-pr-body.sh 계약 픽스처. 합성 PR 본문만 사용한다.
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
checker="$script_dir/check-pr-body.sh"
fixture_dir=$(mktemp -d)
trap 'rm -rf "$fixture_dir"' EXIT

passed=0
failed=0

expect_pass() {
  local name=$1
  shift
  if bash "$checker" "$@" >/dev/null 2>&1; then
    printf 'ok - %s\n' "$name"
    passed=$((passed + 1))
  else
    printf 'not ok - %s (통과해야 하지만 실패)\n' "$name" >&2
    failed=$((failed + 1))
  fi
}

expect_fail() {
  local name=$1
  shift
  if bash "$checker" "$@" >/dev/null 2>&1; then
    printf 'not ok - %s (실패해야 하지만 통과)\n' "$name" >&2
    failed=$((failed + 1))
  else
    printf 'ok - %s\n' "$name"
    passed=$((passed + 1))
  fi
}

expect_exit() {
  local name=$1 want=$2
  shift 2
  local got=0
  bash "$checker" "$@" >/dev/null 2>&1 || got=$?
  if [[ "$got" -eq "$want" ]]; then
    printf 'ok - %s\n' "$name"
    passed=$((passed + 1))
  else
    printf 'not ok - %s (exit %s 기대, exit %s)\n' "$name" "$want" "$got" >&2
    failed=$((failed + 1))
  fi
}

# ---- 완전한 본문(통과) ---------------------------------------------------------
cat >"$fixture_dir/full-pass.md" <<'EOF'
Closes #1234

## 무엇이 좋아지나

- 제출 상태 배지가 실제 상태를 반영한다.

## 바로 확인

https://jnu-oss-hub.com/programs/42

## Before / After

| 요소 | Before | After |
| --- | --- | --- |
| `.status-badge` | <img width="480" alt="이전 배지" src="https://github.com/JNU-SWCU/oss-hub/releases/download/v0.0.0/1234-before-element-badge.png"> | <img width="480" alt="바뀐 배지" src="https://github.com/JNU-SWCU/oss-hub/releases/download/v0.0.0/1234-after-element-badge.png"> |

<sub>`.status-badge` · `body > main > .status-badge` · `/programs/42` · 1440x900 · Before `aaa1111` / After `bbb2222` · 합성 데이터</sub>

After 전체 화면: [desktop 1440x900](https://github.com/JNU-SWCU/oss-hub/releases/download/v0.0.0/1234-after-full-desktop.png) · [390x844](https://github.com/JNU-SWCU/oss-hub/releases/download/v0.0.0/1234-after-full-mobile.png)

## 이 흐름이 자연스러운가

- 자연스럽다.

## 내가 고친 UX 문제

- 배지 색과 상태 문구 불일치를 고쳤다.

## UX 안티패턴 점검

| # | 판정 | 근거 |
| --- | --- | --- |
| AP-1 중복 사실 | 자동·통과 | 콘솔 출력 |
| AP-2 겹친 용어 | 자동·통과 | 콘솔 출력 |
| AP-3 단위 혼용 | 해당 없음 | 이 화면에 수 묶음이 없다 |
| AP-4 상태 과잉표시 | 자동·통과 | 콘솔 출력 |
| AP-5 액션의 문장화 | 자동·통과 | 콘솔 출력 |
| AP-6 내부 용어 | 자동·통과 | 콘솔 출력 |
| AP-7 무력한 컨트롤 | 자동·통과 | 콘솔 출력 |
| AP-8 수 반복 | 자동·통과 | 콘솔 출력 |
| AP-9 죽은 컨트롤 | 자동·통과 | 콘솔 출력 |
| AP-10 사라진 기능의 잔상 | 해당 없음 | 이 화면이 말하는 개념이 전부 현재 제품에 있다 |
| AP-11 의미 없는 시각 | 자동·통과 | 콘솔 출력 |
| AP-12 뒤섞인 출처 | 자동·통과 | 콘솔 출력 |
| AP-13 뒤집힌 노출 | 자동·통과 | 콘솔 출력 |
| AP-14 갈라진 편집 | 자동·통과 | 콘솔 출력 |
| AP-15 어긋난 저장 범위 | 자동·통과 | 콘솔 출력 |
| AP-16 닿지 않는 본문 | 위반 → 고침 | 배지 색을 상태값과 매핑했다 |
| AP-17 컨트롤을 설명하는 문장 | 자동·통과 | 콘솔 출력 |
| AP-18 아이콘이면 끝나는 문장 | 자동·통과 | 콘솔 출력 |
| AP-19 위젯이 이미 말한 것 | 자동·통과 | 콘솔 출력 |
| AP-20 묻지 않은 질문 | 해당 없음 | 화면 존치에 대한 이견 없음 |

## 흐름 다이어그램

```mermaid
flowchart LR
  A[제출 상태 변경] --> B{상태값 매핑}
  B -->|성공| C[배지 갱신]
  B -->|실패| D[에러 배지]
```

<details><summary>상세</summary>

```mermaid
flowchart LR
  A[updateSubmissionStatus 호출] --> B[status enum 매핑]
```

</details>

## 검증

- `pnpm --filter frontend test` 통과.

## 정리

- 이번에 하지 않은 것: 없음
- 리뷰어가 결정해 줘야 하는 것: 없음
- 환경 전제: 없음
- [x] 로컬 커밋을 전부 push했다
- [x] `bash scripts/check-public-safe.sh`를 통과했고 본문·캡처에 실명·비밀값·내부 호스트·로컬 경로가 없다
- [x] `bash scripts/check-pr-body.sh <본문 파일>`을 통과했다
- [x] submit-pr-evidence 절차를 수행했다
EOF

# ---- 화면 없는 변경의 예외 문구 본문(통과) --------------------------------------
cat >"$fixture_dir/exemption-pass.md" <<'EOF'
티켓 없음 — 문서 오타

## 무엇이 좋아지나

- 오타를 고쳤다.

## 바로 확인

확인 링크 없음 — docs만 바뀜

## Before / After

Before/After 없음 — 화면 변경 없음

## 이 흐름이 자연스러운가

화면 없음 — docs만 바뀜

## 내가 고친 UX 문제

화면 없음 — docs만 바뀜

## UX 안티패턴 점검

UX 안티패턴 해당 없음 — docs만 바뀜

## 흐름 다이어그램

흐름 다이어그램 없음 — docs만 바뀜

## 검증

- 육안 확인.

## 정리

- 이번에 하지 않은 것: 없음
- 리뷰어가 결정해 줘야 하는 것: 없음
- 환경 전제: 없음
- [x] 로컬 커밋을 전부 push했다
- [x] `bash scripts/check-public-safe.sh`를 통과했고 본문·캡처에 실명·비밀값·내부 호스트·로컬 경로가 없다
- [x] `bash scripts/check-pr-body.sh <본문 파일>`을 통과했다
- [x] submit-pr-evidence 절차를 수행했다
EOF

# ---- 실패 픽스처: 완전한 본문에서 하나씩 어긋낸다 --------------------------------

# 절 하나 빠짐 — '## 검증' 절 자체를 지운다
awk '/^## 검증$/{skip=1; next} /^## 정리$/{skip=0} skip{next} {print}' "$fixture_dir/full-pass.md" >"$fixture_dir/missing-section.md"

# Closes 줄 없음
sed '1s/.*/그냥 시작/' "$fixture_dir/full-pass.md" >"$fixture_dir/no-closes.md"

# Before/After에 이미지 없고 예외 문구도 없음
awk '
  /^## Before \/ After$/ { print; print ""; skip=1; next }
  /^## 이 흐름이 자연스러운가$/ { skip=0 }
  skip { next }
  { print }
' "$fixture_dir/full-pass.md" >"$fixture_dir/before-after-empty.md"

# 이미지 있는데 요소 행 없음
awk '
  /^## Before \/ After$/ {
    print;
    print "";
    print "<img src=\"https://github.com/JNU-SWCU/oss-hub/releases/download/v0.0.0/loose.png\">";
    skip=1; next
  }
  /^## 이 흐름이 자연스러운가$/ { skip=0 }
  skip { next }
  { print }
' "$fixture_dir/full-pass.md" >"$fixture_dir/image-no-header.md"

# AP 행 19개 — AP-20 행을 지운다
grep -v '^| AP-20 ' "$fixture_dir/full-pass.md" >"$fixture_dir/ap-19-rows.md"

# 근거 없이 '통과'만 적힌 AP 행
sed 's/AP-16 닿지 않는 본문 | 위반 → 고침 | 배지 색을 상태값과 매핑했다/AP-16 닿지 않는 본문 | 통과 | /' \
  "$fixture_dir/full-pass.md" >"$fixture_dir/ap-no-evidence.md"

# 로컬 경로 이미지
sed 's#https://github.com/JNU-SWCU/oss-hub/releases/download/v0.0.0/1234-before-element-badge.png#/tmp/synthetic/badge-before.png#' \
  "$fixture_dir/full-pass.md" >"$fixture_dir/local-path-image.md"

# 자리표시자
sed 's/- 자연스럽다\./- TODO 다시 확인/' "$fixture_dir/full-pass.md" >"$fixture_dir/placeholder.md"

# 체크박스 미체크
sed 's/- \[x\] submit-pr-evidence 절차를 수행했다/- [ ] submit-pr-evidence 절차를 수행했다/' \
  "$fixture_dir/full-pass.md" >"$fixture_dir/checklist-unchecked.md"

# ---- HTML 주석이 남은 본문(통과) ------------------------------------------------
# 실제 .github/pull_request_template.md처럼 첫 줄이 주석이고, 절마다 여러 줄짜리
# 안내 주석이 실제 내용과 함께 남아있는 본문 — 사람이 GitHub 웹 UI에서 PR을 열 때 흔한 모양이다.
cat >"$fixture_dir/comments-left-in.md" <<'EOF'
<!-- 이 형식의 원본은 skills/submit-pr-evidence/SKILL.md다 — PR을 열기 전에 그 스킬 절차를 먼저 수행한다. -->

Closes #1234
<!-- 티켓이 없으면 이 줄을 `티켓 없음 — <이유 한 줄>`로 바꾼다. -->

## 무엇이 좋아지나

<!-- 한 문단, 줄글로. 이 화면을 쓰는 사람이 어떤 상황에 있었고 이번 변경 뒤 무엇을 할 수 있게 됐는지만 쓴다.
     구현 수단(컴포넌트·라이브러리 이름)은 여기 쓰지 않는다. -->

제출 상태 배지가 실제 상태를 반영한다.

## 바로 확인

<!-- 리뷰어가 그대로 눌러볼 수 있는 링크. 확인할 배포 화면이 없으면 이 절 본문을 `확인 링크 없음 — <산출물 위치 또는 이유>`로 바꾼다. -->

https://jnu-oss-hub.com/programs/42

## Before / After

<!-- 화면을 건드린 PR만 채운다. 요소 행이 먼저고 필수다. -->

| 요소 | Before | After |
| --- | --- | --- |
| `.status-badge` | <img width="480" alt="이전 배지" src="https://github.com/JNU-SWCU/oss-hub/releases/download/v0.0.0/1234-before-element-badge.png"> | <img width="480" alt="바뀐 배지" src="https://github.com/JNU-SWCU/oss-hub/releases/download/v0.0.0/1234-after-element-badge.png"> |

After 전체 화면: [desktop 1440x900](https://github.com/JNU-SWCU/oss-hub/releases/download/v0.0.0/1234-after-full-desktop.png) · [390x844](https://github.com/JNU-SWCU/oss-hub/releases/download/v0.0.0/1234-after-full-mobile.png)

## 이 흐름이 자연스러운가

<!-- 한 문단, 줄글로. 직접 눌러본 뒤 어색했던 지점과 그 판단 근거.
     화면이 없으면 이 절 본문을 `화면 없음 — <이유>`로 바꾼다. -->

자연스럽다.

## 내가 고친 UX 문제

<!-- 화면이 없으면 이 절 본문을 `화면 없음 — <이유>`로 바꾼다. -->

배지 색과 상태 문구 불일치를 고쳤다.

## UX 안티패턴 점검

<!-- skills/submit-pr-evidence/references/ux-antipatterns.md의 스무 줄 판정 표 형식 그대로 채운다. -->

| # | 판정 | 근거 |
| --- | --- | --- |
| AP-1 중복 사실 | 자동·통과 | 콘솔 출력 |
| AP-2 겹친 용어 | 자동·통과 | 콘솔 출력 |
| AP-3 단위 혼용 | 해당 없음 | 이 화면에 수 묶음이 없다 |
| AP-4 상태 과잉표시 | 자동·통과 | 콘솔 출력 |
| AP-5 액션의 문장화 | 자동·통과 | 콘솔 출력 |
| AP-6 내부 용어 | 자동·통과 | 콘솔 출력 |
| AP-7 무력한 컨트롤 | 자동·통과 | 콘솔 출력 |
| AP-8 수 반복 | 자동·통과 | 콘솔 출력 |
| AP-9 죽은 컨트롤 | 자동·통과 | 콘솔 출력 |
| AP-10 사라진 기능의 잔상 | 해당 없음 | 이 화면이 말하는 개념이 전부 현재 제품에 있다 |
| AP-11 의미 없는 시각 | 자동·통과 | 콘솔 출력 |
| AP-12 뒤섞인 출처 | 자동·통과 | 콘솔 출력 |
| AP-13 뒤집힌 노출 | 자동·통과 | 콘솔 출력 |
| AP-14 갈라진 편집 | 자동·통과 | 콘솔 출력 |
| AP-15 어긋난 저장 범위 | 자동·통과 | 콘솔 출력 |
| AP-16 닿지 않는 본문 | 위반 → 고침 | 배지 색을 상태값과 매핑했다 |
| AP-17 컨트롤을 설명하는 문장 | 자동·통과 | 콘솔 출력 |
| AP-18 아이콘이면 끝나는 문장 | 자동·통과 | 콘솔 출력 |
| AP-19 위젯이 이미 말한 것 | 자동·통과 | 콘솔 출력 |
| AP-20 묻지 않은 질문 | 해당 없음 | 화면 존치에 대한 이견 없음 |

## 흐름 다이어그램

<!-- backend 로직을 바꿨을 때만 채운다.
     첫 다이어그램은 high level(입구 → 판단 → 결과, 노드 8개 이하)로, 상세는 <details> 안에 둔다. -->

```mermaid
flowchart LR
  A[제출 상태 변경] --> B{상태값 매핑}
  B -->|성공| C[배지 갱신]
  B -->|실패| D[에러 배지]
```

<details><summary>상세</summary>

```mermaid
flowchart LR
  A[updateSubmissionStatus 호출] --> B[status enum 매핑]
```

</details>

## 검증

<!-- 다음 사람이 그대로 복사해 실행할 명령과 지금 시점의 기대 결과. -->

- `pnpm --filter frontend test` 통과.

## 정리

<!-- 이번에 하지 않은 것 / 리뷰어가 결정해 줘야 하는 것 / 환경 전제는 해당 없으면 "없음"으로 적는다. -->

- 이번에 하지 않은 것: 없음
- 리뷰어가 결정해 줘야 하는 것: 없음
- 환경 전제: 없음
- [x] 로컬 커밋을 전부 push했다
- [x] `bash scripts/check-public-safe.sh`를 통과했고 본문·캡처에 실명·비밀값·내부 호스트·로컬 경로가 없다
- [x] `bash scripts/check-pr-body.sh <본문 파일>`을 통과했다
- [x] submit-pr-evidence 절차를 수행했다
EOF

# ---- '검증' 절 본문이 HTML 주석뿐임(위반) ---------------------------------------
cat >"$fixture_dir/verification-only-comment.md" <<'EOF'
Closes #1234

## 무엇이 좋아지나

- x

## 바로 확인

https://jnu-oss-hub.com/x

## Before / After

Before/After 없음 — 화면 변경 없음

## 이 흐름이 자연스러운가

화면 없음 — x

## 내가 고친 UX 문제

화면 없음 — x

## UX 안티패턴 점검

UX 안티패턴 해당 없음 — x

## 흐름 다이어그램

흐름 다이어그램 없음 — x

## 검증

<!-- 다음 사람이 그대로 복사해 실행할 명령과 지금 시점의 기대 결과. -->

## 정리

- 이번에 하지 않은 것: 없음
- 리뷰어가 결정해 줘야 하는 것: 없음
- 환경 전제: 없음
- [x] 로컬 커밋을 전부 push했다
- [x] `bash scripts/check-public-safe.sh`를 통과했고 본문·캡처에 실명·비밀값·내부 호스트·로컬 경로가 없다
- [x] `bash scripts/check-pr-body.sh <본문 파일>`을 통과했다
- [x] submit-pr-evidence 절차를 수행했다
EOF

# ---- `<!-- 첨부 대기 -->` 주석은 다른 주석과 달리 원본에서 계속 잡힌다(위반) --------
sed 's/제출 상태 배지가 실제 상태를 반영한다\./제출 상태 배지가 실제 상태를 반영한다.\n\n<!-- 첨부 대기 -->/' \
  "$fixture_dir/comments-left-in.md" >"$fixture_dir/attachment-pending-comment.md"

# ---- '바로 확인' 절 본문이 비어있음(예외 문구 없음) -----------------------------
awk '
  /^## 바로 확인$/ { print; print ""; skip=1; next }
  /^## Before \/ After$/ { skip=0 }
  skip { next }
  { print }
' "$fixture_dir/full-pass.md" >"$fixture_dir/quick-check-empty.md"

# ---- '흐름 다이어그램' 절 본문이 비어있음(예외 문구 없음) -----------------------
awk '
  /^## 흐름 다이어그램$/ { print; print ""; skip=1; next }
  /^## 검증$/ { skip=0 }
  skip { next }
  { print }
' "$fixture_dir/full-pass.md" >"$fixture_dir/flow-diagram-empty.md"

# ---- R9: src=""가 다른 속성 뒤에 와도(alt·width가 먼저) 자리표시자로 잡힌다 -------
sed 's/- 제출 상태 배지가 실제 상태를 반영한다\./- 제출 상태 배지가 실제 상태를 반영한다.\n\n<img width="480" alt="아직" src="">/' \
  "$fixture_dir/full-pass.md" >"$fixture_dir/placeholder-img-src-empty.md"

# ---- R9: 마크다운 이미지가 alt 텍스트는 있어도 괄호가 비면 자리표시자다 ----------
sed 's/- 제출 상태 배지가 실제 상태를 반영한다\./- 제출 상태 배지가 실제 상태를 반영한다.\n\n![아직 없음]()/' \
  "$fixture_dir/full-pass.md" >"$fixture_dir/placeholder-md-image-empty.md"

# ---- R5: 근거가 있어도 판정 칸이 '통과'뿐이면 위반이다 ---------------------------
sed 's/AP-16 닿지 않는 본문 | 위반 → 고침 | 배지 색을 상태값과 매핑했다/AP-16 닿지 않는 본문 | 통과 | 봤음/' \
  "$fixture_dir/full-pass.md" >"$fixture_dir/ap-bare-pass-with-evidence.md"

# ---- R8: HTML 주석 안에 남은 로컬 경로도 원본 스캔으로 잡힌다 -------------------
sed '1s#.*#<!-- 캡처 원본: /tmp/synthetic/local-capture.png -->#' \
  "$fixture_dir/comments-left-in.md" >"$fixture_dir/local-path-in-comment.md"

# ---- R11: '이 흐름이 자연스러운가' 절이 비어있음(예외 문구 없음) ----------------
awk '
  /^## 이 흐름이 자연스러운가$/ { print; print ""; skip=1; next }
  /^## 내가 고친 UX 문제$/ { skip=0 }
  skip { next }
  { print }
' "$fixture_dir/full-pass.md" >"$fixture_dir/ux-narrative-empty.md"

# ---- R11: '화면 없음 — <이유>' 예외 문구는 유효한 내용으로 통과한다(통과) --------
sed 's/- 자연스럽다\./화면 없음 — 문서만 바뀜/' "$fixture_dir/full-pass.md" >"$fixture_dir/ux-narrative-exempt.md"

# ---- R10: 체크박스가 4개를 넘어도 전부 체크면 통과한다(통과) --------------------
sed 's/- \[x\] submit-pr-evidence 절차를 수행했다/- [x] submit-pr-evidence 절차를 수행했다\n- [x] 추가로 확인한 항목/' \
  "$fixture_dir/full-pass.md" >"$fixture_dir/checklist-five-checked.md"

expect_pass '완전한 본문' "$fixture_dir/full-pass.md"
expect_pass '화면 없는 변경의 예외 문구 본문' "$fixture_dir/exemption-pass.md"
expect_exit '절 하나 빠짐(검증)' 1 "$fixture_dir/missing-section.md"
expect_fail 'Closes 줄 없음' "$fixture_dir/no-closes.md"
expect_fail 'Before/After 이미지도 예외 문구도 없음' "$fixture_dir/before-after-empty.md"
expect_fail 'Before/After 이미지 있는데 요소 행 없음' "$fixture_dir/image-no-header.md"
expect_fail 'UX 안티패턴 AP 행 19개' "$fixture_dir/ap-19-rows.md"
expect_fail '근거 없이 통과만 적힌 AP 행' "$fixture_dir/ap-no-evidence.md"
expect_fail '로컬 경로 이미지' "$fixture_dir/local-path-image.md"
expect_fail '자리표시자(TODO) 남음' "$fixture_dir/placeholder.md"
expect_fail '정리 체크박스 미체크' "$fixture_dir/checklist-unchecked.md"
expect_exit '본문 파일 부재' 2 "$fixture_dir/does-not-exist.md"
expect_pass 'HTML 주석이 남은 본문(템플릿 안내 주석 포함)' "$fixture_dir/comments-left-in.md"
expect_fail '검증 절 본문이 HTML 주석뿐임' "$fixture_dir/verification-only-comment.md"
expect_fail '주석이 남아있어도 첨부 대기 자리표시자는 잡힌다' "$fixture_dir/attachment-pending-comment.md"
expect_fail "'바로 확인' 절 본문이 비어있음(예외 문구 없음)" "$fixture_dir/quick-check-empty.md"
expect_fail "'흐름 다이어그램' 절 본문이 비어있음(예외 문구 없음)" "$fixture_dir/flow-diagram-empty.md"
expect_fail '<img src="">가 다른 속성 뒤에 와도 자리표시자로 잡힌다' "$fixture_dir/placeholder-img-src-empty.md"
expect_fail '마크다운 이미지 괄호가 비면 alt가 있어도 자리표시자로 잡힌다' "$fixture_dir/placeholder-md-image-empty.md"
expect_fail "근거가 있어도 판정 칸이 '통과'뿐이면 위반이다" "$fixture_dir/ap-bare-pass-with-evidence.md"
expect_fail 'HTML 주석 안에 남은 로컬 경로도 원본 스캔으로 잡힌다' "$fixture_dir/local-path-in-comment.md"
expect_fail "'이 흐름이 자연스러운가' 절이 비어있다" "$fixture_dir/ux-narrative-empty.md"
expect_pass "'이 흐름이 자연스러운가' 절이 '화면 없음 — ' 예외 문구면 통과한다" "$fixture_dir/ux-narrative-exempt.md"
expect_pass "'정리' 체크박스가 4개를 넘어도 전부 체크면 통과한다" "$fixture_dir/checklist-five-checked.md"

# ---- --hook 모드 ----------------------------------------------------------------
hook_input() {
  local command=$1
  node -e '
const command = process.argv[1];
process.stdout.write(JSON.stringify({ tool_name: "Bash", tool_input: { command } }));
' "$command"
}

expect_hook_exit() {
  local name=$1 want=$2 command=$3
  local got=0
  hook_input "$command" | bash "$checker" --hook >/dev/null 2>&1 || got=$?
  if [[ "$got" -eq "$want" ]]; then
    printf 'ok - %s\n' "$name"
    passed=$((passed + 1))
  else
    printf 'not ok - %s (exit %s 기대, exit %s)\n' "$name" "$want" "$got" >&2
    failed=$((failed + 1))
  fi
}

expect_hook_exit 'hook: gh pr create --fill 은 차단된다' 2 "gh pr create --fill"
expect_hook_exit 'hook: gh pr create --body-file <통과 fixture> 는 허용된다' 0 \
  "gh pr create --title x --body-file $fixture_dir/full-pass.md"
expect_hook_exit 'hook: gh pr create --body-file <실패 fixture> 는 차단된다' 2 \
  "gh pr create --title x --body-file $fixture_dir/no-closes.md"
expect_hook_exit 'hook: gh 무관 명령은 관여하지 않는다' 0 "git status"
expect_hook_exit 'hook: gh pr edit 본문 무관 플래그는 관여하지 않는다' 0 "gh pr edit 12 --add-label x"
expect_hook_exit 'hook: gh pr edit --body-file <통과 fixture> 는 허용된다' 0 \
  "gh pr edit 12 --body-file $fixture_dir/full-pass.md"
expect_hook_exit 'hook: gh pr create --help 는 관여하지 않는다' 0 "gh pr create --help"
expect_hook_exit 'hook: gh pr create --body \"...\" 는 차단된다' 2 'gh pr create --title x --body "인라인 본문"'
expect_hook_exit 'hook: --body-file 경로가 없으면 차단된다' 2 "gh pr create --title x --body-file /nonexistent-fixture.md"
expect_hook_exit 'hook: 아무 플래그 없는 gh pr create도 차단된다' 2 "gh pr create"
expect_hook_exit 'hook: gh pr create --title x --base main 도 차단된다' 2 "gh pr create --title x --base main"
expect_hook_exit 'hook: gh pr create --draft 도 차단된다' 2 "gh pr create --draft"
expect_hook_exit 'hook: -F <통과 fixture> 는 허용된다' 0 "gh pr create --title x -F $fixture_dir/full-pass.md"
expect_hook_exit 'hook: --body-file=<통과 fixture> 는 허용된다' 0 "gh pr create --title x --body-file=$fixture_dir/full-pass.md"
expect_hook_exit 'hook: 괄호로 감싼 (gh pr create --fill)도 차단된다' 2 "(gh pr create --fill)"
expect_hook_exit 'hook: gh pr create --fill; echo done 도 차단된다' 2 "gh pr create --fill; echo done"
expect_hook_exit 'hook: du -h && gh pr create --fill 도 차단된다(du -h의 -h와 혼동하지 않는다)' 2 "du -h && gh pr create --fill"
expect_hook_exit 'hook: 커밋 메시지 문자열 속 gh pr create 언급은 관여하지 않는다' 0 'git commit -m "gh pr create"'

# ---- 공백이 든 --body-file 경로(따옴표로 감쌈) -----------------------------------
space_dir="$fixture_dir/dir with space"
mkdir -p "$space_dir"
cp "$fixture_dir/full-pass.md" "$space_dir/full-pass.md"
expect_hook_exit 'hook: 공백이 든 --body-file 경로도 따옴표로 감싸면 처리한다' 0 \
  "gh pr create --title x --body-file \"$space_dir/full-pass.md\""

# ---- JSON이 깨져도(파서 버그 대비) fail-open으로 통과시키고 stderr에 남긴다 -------
malformed_exit=0
malformed_stderr=$(printf '%s' '{"tool_name":"Bash","tool_input":{"command":"gh pr create' \
  | bash "$checker" --hook 2>&1 >/dev/null) || malformed_exit=$?
if [[ "$malformed_exit" -eq 0 ]] && grep -qF 'hook 입력 JSON을 읽지 못했다' <<<"$malformed_stderr"; then
  printf 'ok - %s\n' 'hook: 깨진 JSON은 exit 0으로 통과시키고 stderr에 기록한다'
  passed=$((passed + 1))
else
  printf 'not ok - %s (exit 0과 stderr 메시지 기대, exit %s)\n' 'hook: 깨진 JSON은 exit 0으로 통과시키고 stderr에 기록한다' "$malformed_exit" >&2
  failed=$((failed + 1))
fi

# ---- node가 PATH에 없을 때: gh 언급이 있으면 fail-closed, 없으면 그대로 통과 ------
restricted_path="/usr/bin:/bin"

no_node_gh_exit=0
printf '%s' '{"tool_name":"Bash","tool_input":{"command":"gh pr create --fill"}}' \
  | PATH="$restricted_path" bash "$checker" --hook >/dev/null 2>&1 || no_node_gh_exit=$?
if [[ "$no_node_gh_exit" -eq 2 ]]; then
  printf 'ok - %s\n' 'hook: node 없는 PATH에서 gh 명령은 fail-closed(exit 2)로 막는다'
  passed=$((passed + 1))
else
  printf 'not ok - %s (exit 2 기대, exit %s)\n' 'hook: node 없는 PATH에서 gh 명령은 fail-closed(exit 2)로 막는다' "$no_node_gh_exit" >&2
  failed=$((failed + 1))
fi

no_node_nogh_exit=0
printf '%s' '{"tool_name":"Bash","tool_input":{"command":"git status"}}' \
  | PATH="$restricted_path" bash "$checker" --hook >/dev/null 2>&1 || no_node_nogh_exit=$?
if [[ "$no_node_nogh_exit" -eq 0 ]]; then
  printf 'ok - %s\n' 'hook: node 없는 PATH라도 gh 언급이 없는 명령은 그대로 통과한다'
  passed=$((passed + 1))
else
  printf 'not ok - %s (exit 0 기대, exit %s)\n' 'hook: node 없는 PATH라도 gh 언급이 없는 명령은 그대로 통과한다' "$no_node_nogh_exit" >&2
  failed=$((failed + 1))
fi

# tool_name이 Bash가 아닌 경우는 hook_input 헬퍼가 항상 Bash를 넣으므로 JSON을 직접 구성한다.
not_bash_result=0
printf '%s' '{"tool_name":"Write","tool_input":{"command":"gh pr create --fill"}}' \
  | bash "$checker" --hook >/dev/null 2>&1 || not_bash_result=$?
if [[ "$not_bash_result" -eq 0 ]]; then
  printf 'ok - %s\n' 'hook: tool_name이 Write이면 관여하지 않는다'
  passed=$((passed + 1))
else
  printf 'not ok - %s (exit 0 기대, exit %s)\n' 'hook: tool_name이 Write이면 관여하지 않는다' "$not_bash_result" >&2
  failed=$((failed + 1))
fi

printf '%d passed, %d failed\n' "$passed" "$failed"
[[ "$failed" -eq 0 ]]
